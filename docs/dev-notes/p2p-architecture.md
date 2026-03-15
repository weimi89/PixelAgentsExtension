# P2P Mode Architecture Proposal

Task 7.6: Peer-to-Peer Mode (Documentation)

## Overview

P2P mode allows multiple Pixel Agents instances to share agent visibility without a central server. Each participant runs a local server and directly connects to peers via WebRTC data channels.

## Architecture

```
Browser A ──── Local Server A ──── WebRTC Data Channel ──── Local Server B ──── Browser B
                  |                                              |
              JSONL Watcher                                  JSONL Watcher
              (local agents)                                 (local agents)
```

### Variant 1: Browser-to-Browser (Pure P2P)

- Each browser acts as both client and relay
- WebRTC data channels between browser tabs directly
- No server coordination needed after signaling
- Limitation: requires all browsers to be online simultaneously

### Variant 2: Server-to-Server (Hybrid P2P)

- Local servers connect to each other via WebRTC or plain WebSocket
- LAN discovery (existing `lanDiscovery.ts`) for automatic peer finding
- Servers relay agent events to connected browsers
- Advantage: servers can run headlessly

## Signaling

WebRTC requires a signaling mechanism for initial connection establishment.

### Options

1. **LAN Multicast (UDP)** - Already implemented via `lanDiscovery.ts` (port 47800)
   - Extend heartbeat messages to include WebRTC SDP offers
   - Works only on local network
   - No external dependency

2. **Manual Exchange** - Users paste connection tokens
   - Generate SDP offer as base64-encoded string
   - Other party pastes it into their UI
   - Works across networks but manual

3. **Lightweight Signaling Server** - Minimal relay
   - Only handles SDP exchange, no persistent state
   - Can be deployed as a free-tier service
   - Required for internet-based P2P

## Data Channel Protocol

```typescript
// P2P message types
type P2PMessage =
  | { type: 'hello'; serverId: string; agentCount: number }
  | { type: 'agentCreated'; agent: ShadowAgentInfo }
  | { type: 'agentRemoved'; agentId: number }
  | { type: 'agentToolStart'; agentId: number; toolId: string; status: string }
  | { type: 'agentToolDone'; agentId: number; toolId: string }
  | { type: 'agentStatus'; agentId: number; status: string }
  | { type: 'ping' }
  | { type: 'pong' };
```

## Challenges

### NAT Traversal

- WebRTC uses ICE (STUN/TURN) for NAT traversal
- STUN servers are free and widely available (Google, Twilio)
- TURN servers needed for symmetric NAT (more expensive)
- Fallback: direct WebSocket connection if both parties are on same LAN

### State Synchronization

- No single source of truth - each peer maintains local state
- Conflict resolution: last-writer-wins with vector clocks
- Agent ID collision: prefix with serverId to ensure uniqueness
- Late joiners: full state snapshot on connection

### Reliability

- WebRTC data channels are unreliable by default (can configure reliable mode)
- Use reliable ordered mode for agent create/remove events
- Use unreliable mode for frequent status updates (tool progress)
- Heartbeat-based peer liveness detection

### Security

- WebRTC connections are encrypted (DTLS)
- Optional: shared secret for peer authentication
- Each peer controls what data to share (privacy boundary)

## Implementation Plan

### Phase 1: LAN P2P (via existing infrastructure)

1. Extend `lanDiscovery.ts` to exchange agent summaries
2. On peer discovery, establish WebSocket connection (not WebRTC - simpler for LAN)
3. Relay agent events between connected servers
4. Display remote agents as shadow agents (same as cluster mode)

### Phase 2: Internet P2P (WebRTC)

1. Add WebRTC data channel support (via `wrtc` npm package for Node.js)
2. Build signaling exchange UI in settings panel
3. Implement SDP offer/answer flow
4. Replace WebSocket relay with data channel relay

### Phase 3: Mesh Network

1. Support 3+ peers in mesh topology
2. Gossip protocol for peer discovery
3. Efficient broadcast (avoid duplicate messages)
4. Graceful mesh partition handling

## Dependencies

- `wrtc` (Node.js WebRTC): for server-side data channels
- Browser WebRTC API: native, no dependency needed
- STUN servers: `stun:stun.l.google.com:19302` (free)

## Trade-offs vs Client-Server

| Aspect | P2P | Client-Server (Current) |
|--------|-----|------------------------|
| Setup complexity | Lower (no central server) | Higher (need Redis + server) |
| Scalability | Limited (mesh O(n^2)) | Better (centralized) |
| Reliability | Lower (depends on peers) | Higher (dedicated server) |
| Privacy | Better (data stays local) | Lower (central aggregation) |
| Latency | Varies (direct or relayed) | Consistent |
| Offline support | Partial (local always works) | None |
