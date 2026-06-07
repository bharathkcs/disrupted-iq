# DisruptIQ — WebSocket Events Reference

> Complete WebSocket event types, payload structures, and client-side handling.


---

## Connection Setup

### Client Connection

```javascript
const socket = io('http://localhost:8000', {
  auth: { token: <JWT_TOKEN> }
});

socket.on('connect', () => {
  // Socket joined room: client_<client_id>
});

socket.on('disconnect', () => {
  // Auto-reconnect triggered
});
```

### Backend: Authentication

```
Client sends JWT in auth
  ↓
Backend verifies + extracts client_id
  ↓
socket.join(f"client_{client_id}")
  ↓
All emits to this room only
```

---

## Live Swarm Events

### Event: `swarm_update`

Emitted during swarm execution. One per agent completion.

```javascript
{
  event_id: "event-uuid-abc",
  agent: "Forecast",
  status: "complete",
  timestamp_utc: "2026-05-22T14:00:25Z",
  payload: {
    demand_shift_percentage: -15,
    demand_shift_confidence: "high",
    narrative: "Port disruption..."
  }
}
```

**Agent Sequence:**
Monitor → SwarmMemory → Forecast + Risk (parallel) → CascadeDetect → Action → Validator → Simulation → HIL Gates

---

## Notification Events

### Event: `notification`

```javascript
{
  notification_id: "notif-uuid-1",
  type: "event_alert",
  title: "Port Strike Detected",
  message: "Requires review",
  severity: "critical",
  created_at: "2026-05-22T14:00:00Z"
}
```

---

## Dashboard Updates

### Event: `dashboard_update`

```javascript
{
  data_type: "supplier_health",
  timestamp_utc: "2026-05-22T14:30:00Z",
  data: {
    suppliers: [
      { id: "supplier-1", health_score: 82 }
    ]
  }
}
```

---

## Error Events

### Event: `error`

```javascript
{
  code: "LLM_API_ERROR",
  message: "Rate limit exceeded",
  event_id: "event-uuid-abc",
  fallback_used: true
}
```

---

## Frontend Handler Example

```javascript
socket.on('swarm_update', (data) => {
  setSwarmFeed(prev => [...prev, data]);
  
  switch (data.agent) {
    case 'Forecast':
      setForecast(data.payload);
      break;
    case 'Risk':
      setRisk(data.payload);
      break;
    case 'Action':
      setActions(data.payload.options);
      break;
    case 'Simulation':
      setSimulation(data.payload);
      break;
  }
});

socket.on('notification', (data) => {
  setNotifications(prev => [data, ...prev]);
  if (data.severity === 'critical') {
    showCriticalAlert(data.title);
  }
});
```

---

## Debugging

```javascript
console.log('Socket ID:', socket.id);
console.log('Connected:', socket.connected);
console.log('Rooms:', socket.rooms);

socket.onAny((event, data) => {
  console.log(`Event: ${event}`, data);
});
```

**Browser DevTools:** Network → WS filter → Messages tab

---

## Summary

| Event | Frequency | Scope |
|-------|-----------|-------|
| `swarm_update` | ~10/swarm | Client room |
| `notification` | On demand | Client room |
| `dashboard_update` | Every 5-30s | Client room |
| `error` | On failure | Client room |

**All events scoped to client room for strict isolation.**

---

*End of WEBSOCKET_EVENTS.md*
