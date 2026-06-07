package jetstream

import (
	"context"
	"errors"
	"fmt"
	"time"

	natsgo "github.com/nats-io/nats.go"

	"github.com/Himanshuplace/nats-ui/pkg/types"
)

const (
	defaultRequestTimeout = 2 * time.Second
	maxRequestTimeout     = 30 * time.Second
)

// RequestReply sends a core NATS request and waits for a single reply.
//
// This is the request-reply half of NATS that the fire-and-forget Publisher
// can't exercise — it's how you poke a running microservice and see its
// response + round-trip time. TimedOut and NoResponders are normal request
// outcomes (returned with a nil error) rather than transport failures.
func (ins *Inspector) RequestReply(_ context.Context, clusterID string, req types.RequestReplyRequest) (*types.RequestReplyResult, error) {
	mc, ok := ins.pool.Get(clusterID)
	if !ok {
		return nil, fmt.Errorf("cluster %s not connected", clusterID)
	}
	if req.Subject == "" {
		return nil, fmt.Errorf("subject is required")
	}

	timeout := time.Duration(req.TimeoutMs) * time.Millisecond
	if timeout <= 0 {
		timeout = defaultRequestTimeout
	}
	if timeout > maxRequestTimeout {
		timeout = maxRequestTimeout
	}

	msg := natsgo.NewMsg(req.Subject)
	msg.Data = []byte(req.Payload)
	for k, v := range req.Headers {
		msg.Header.Set(k, v)
	}

	start := time.Now()
	reply, err := mc.NC.RequestMsg(msg, timeout)
	rttMs := float64(time.Since(start).Microseconds()) / 1000.0

	if err != nil {
		switch {
		case errors.Is(err, natsgo.ErrNoResponders):
			return &types.RequestReplyResult{NoResponders: true, RTTms: rttMs}, nil
		case errors.Is(err, natsgo.ErrTimeout):
			return &types.RequestReplyResult{TimedOut: true, RTTms: float64(timeout.Milliseconds())}, nil
		default:
			return nil, fmt.Errorf("request %q: %w", req.Subject, err)
		}
	}

	headers := map[string]string{}
	for k, v := range reply.Header {
		if len(v) > 0 {
			headers[k] = v[0]
		}
	}
	if len(headers) == 0 {
		headers = nil
	}

	return &types.RequestReplyResult{
		Subject: reply.Subject,
		Payload: string(reply.Data),
		Headers: headers,
		Size:    len(reply.Data),
		RTTms:   rttMs,
	}, nil
}
