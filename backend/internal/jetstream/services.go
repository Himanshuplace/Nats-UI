package jetstream

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"time"

	natsgo "github.com/nats-io/nats.go"

	"github.com/Himanshuplace/nats-ui/pkg/types"
)

// NATS micro Services discovery subjects (NATS 2.10+). A single request fans
// out to every running service instance, which each reply — so we collect all
// responses within a short window (scatter-gather) rather than a single reply.
const (
	srvStats = "$SRV.STATS"
	srvPing  = "$SRV.PING"

	srvCollectWindow = 1500 * time.Millisecond
	srvPingWindow    = 1000 * time.Millisecond
)

// collectSRV publishes a request to a $SRV subject and gathers every reply that
// arrives before the window closes, along with each reply's round-trip time.
func collectSRV(nc *natsgo.Conn, subject string, window time.Duration) ([][]byte, []float64, error) {
	inbox := nc.NewRespInbox()
	sub, err := nc.SubscribeSync(inbox)
	if err != nil {
		return nil, nil, err
	}
	defer sub.Unsubscribe()

	start := time.Now()
	if err := nc.PublishRequest(subject, inbox, nil); err != nil {
		return nil, nil, err
	}
	_ = nc.Flush()

	var datas [][]byte
	var rtts []float64
	deadline := start.Add(window)
	for {
		remaining := time.Until(deadline)
		if remaining <= 0 {
			break
		}
		msg, err := sub.NextMsg(remaining)
		if err != nil {
			break // timeout → window closed
		}
		datas = append(datas, msg.Data)
		rtts = append(rtts, float64(time.Since(start).Microseconds())/1000.0)
	}
	return datas, rtts, nil
}

// microStatsResp mirrors the io.nats.micro.v1.stats_response schema.
type microStatsResp struct {
	Name      string `json:"name"`
	ID        string `json:"id"`
	Version   string `json:"version"`
	Started   string `json:"started"`
	Endpoints []struct {
		Name                  string `json:"name"`
		Subject               string `json:"subject"`
		QueueGroup            string `json:"queue_group"`
		NumRequests           int64  `json:"num_requests"`
		NumErrors             int64  `json:"num_errors"`
		LastError             string `json:"last_error"`
		ProcessingTime        int64  `json:"processing_time"`
		AverageProcessingTime int64  `json:"average_processing_time"`
	} `json:"endpoints"`
}

// ListServices discovers running NATS micro services and aggregates their
// per-endpoint stats across all instances of each service name.
func (ins *Inspector) ListServices(_ context.Context, clusterID string) ([]types.ServiceInfo, error) {
	mc, ok := ins.pool.Get(clusterID)
	if !ok {
		return nil, fmt.Errorf("cluster %s not connected", clusterID)
	}

	datas, _, err := collectSRV(mc.NC, srvStats, srvCollectWindow)
	if err != nil {
		return nil, fmt.Errorf("discover services: %w", err)
	}

	type agg struct {
		info types.ServiceInfo
		eps  map[string]*types.ServiceEndpointStat
	}
	byName := map[string]*agg{}
	var order []string

	for _, d := range datas {
		var r microStatsResp
		if json.Unmarshal(d, &r) != nil || r.Name == "" {
			continue
		}
		a, ok := byName[r.Name]
		if !ok {
			a = &agg{
				info: types.ServiceInfo{Name: r.Name, Version: r.Version},
				eps:  map[string]*types.ServiceEndpointStat{},
			}
			byName[r.Name] = a
			order = append(order, r.Name)
		}
		a.info.Instances++
		for _, e := range r.Endpoints {
			a.info.NumRequests += e.NumRequests
			a.info.NumErrors += e.NumErrors
			ep, ok := a.eps[e.Name]
			if !ok {
				ep = &types.ServiceEndpointStat{Name: e.Name, Subject: e.Subject, QueueGroup: e.QueueGroup}
				a.eps[e.Name] = ep
			}
			ep.NumRequests += e.NumRequests
			ep.NumErrors += e.NumErrors
			ep.ProcessingTimeNs += e.ProcessingTime
			if e.LastError != "" {
				ep.LastError = e.LastError
			}
		}
	}

	out := make([]types.ServiceInfo, 0, len(order))
	for _, name := range order {
		a := byName[name]
		for _, ep := range a.eps {
			if ep.NumRequests > 0 {
				ep.AvgProcessingNs = ep.ProcessingTimeNs / ep.NumRequests
			}
			a.info.Endpoints = append(a.info.Endpoints, *ep)
		}
		sort.Slice(a.info.Endpoints, func(i, j int) bool { return a.info.Endpoints[i].Name < a.info.Endpoints[j].Name })
		out = append(out, a.info)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out, nil
}

// PingServices pings all running services and reports how many responded plus
// the min/avg/max round-trip time.
func (ins *Inspector) PingServices(_ context.Context, clusterID string) (*types.ServicePingResult, error) {
	mc, ok := ins.pool.Get(clusterID)
	if !ok {
		return nil, fmt.Errorf("cluster %s not connected", clusterID)
	}

	_, rtts, err := collectSRV(mc.NC, srvPing, srvPingWindow)
	if err != nil {
		return nil, fmt.Errorf("ping services: %w", err)
	}

	res := &types.ServicePingResult{Instances: len(rtts)}
	if len(rtts) > 0 {
		min, max, sum := rtts[0], rtts[0], 0.0
		for _, r := range rtts {
			if r < min {
				min = r
			}
			if r > max {
				max = r
			}
			sum += r
		}
		res.MinMs = min
		res.MaxMs = max
		res.AvgMs = sum / float64(len(rtts))
	}
	return res, nil
}
