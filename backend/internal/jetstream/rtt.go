package jetstream

import (
	"context"
	"fmt"
	"strings"

	"github.com/Himanshuplace/nats-ui/pkg/types"
)

// RTTProbe measures round-trip latency to every server in the cluster's
// configured URL list (nats rtt, per server).
func (ins *Inspector) RTTProbe(_ context.Context, clusterID string) ([]types.RTTResult, error) {
	mc, ok := ins.pool.Get(clusterID)
	if !ok {
		return nil, fmt.Errorf("cluster %s not connected", clusterID)
	}
	urls := strings.Split(mc.Profile.URL, ",")
	out := make([]types.RTTResult, 0, len(urls))
	for _, u := range urls {
		u = strings.TrimSpace(u)
		if u == "" {
			continue
		}
		out = append(out, ins.pool.ProbeRTT(clusterID, u, 5))
	}
	return out, nil
}
