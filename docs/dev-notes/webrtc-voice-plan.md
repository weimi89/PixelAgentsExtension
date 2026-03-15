# WebRTC Voice Chat Architecture Proposal

Task 7.7: Voice/Video Communication in Virtual Office

## Overview

Add spatial voice chat to the virtual office, where audio volume and panning are determined by character proximity on the pixel map. Users can talk to each other while watching their AI agents work.

## Architecture

```
Browser A                              Browser B
  |                                      |
  v                                      v
Microphone → MediaStream ──── WebRTC Peer Connection ──── MediaStream → Speakers
  |              |                                           |
  v              v                                           v
Gain Node   Spatial Audio                               Spatial Audio
(mute/vol)  (panner based on                            (panner based on
             character positions)                         character positions)
```

### Signaling Flow

1. User A clicks "Enable Microphone" in toolbar
2. Browser captures microphone via `getUserMedia()`
3. Client sends `voiceJoin` message to server via Socket.IO
4. Server broadcasts peer list to all voice participants on same floor
5. Each pair of participants exchanges SDP offers/answers via Socket.IO relay
6. WebRTC peer connections established directly between browsers
7. Audio streams flow peer-to-peer (no server relay)

## Server-Side (Signaling Only)

```typescript
// New Socket.IO messages for voice signaling
type VoiceMessage =
  | { type: 'voiceJoin'; floorId: string }
  | { type: 'voiceLeave' }
  | { type: 'voiceOffer'; targetSocketId: string; sdp: RTCSessionDescriptionInit }
  | { type: 'voiceAnswer'; targetSocketId: string; sdp: RTCSessionDescriptionInit }
  | { type: 'voiceIceCandidate'; targetSocketId: string; candidate: RTCIceCandidateInit }
  | { type: 'voicePeers'; peers: Array<{ socketId: string; nickname: string }> };
```

The server acts only as a signaling relay. No audio data passes through the server.

## Client-Side Components

### 1. VoiceManager (new module)

```typescript
class VoiceManager {
  private localStream: MediaStream | null;
  private peers: Map<string, RTCPeerConnection>;
  private audioContext: AudioContext;

  join(floorId: string): Promise<void>;
  leave(): void;
  setMuted(muted: boolean): void;
  setVolume(volume: number): void;

  // Called every frame to update spatial audio
  updatePositions(
    myPosition: { x: number; y: number },
    peerPositions: Map<string, { x: number; y: number }>
  ): void;
}
```

### 2. Spatial Audio Engine

- Uses Web Audio API `PannerNode` for each remote peer
- Position updates every render tick (synced with character positions)
- Distance-based attenuation:
  - < 3 tiles: full volume
  - 3-10 tiles: linear falloff
  - > 10 tiles: silent
- Stereo panning based on relative X position

```typescript
function updatePeerAudio(
  panner: PannerNode,
  myPos: { x: number; y: number },
  peerPos: { x: number; y: number },
  tileSize: number,
): void {
  const dx = (peerPos.x - myPos.x) / tileSize;
  const dy = (peerPos.y - myPos.y) / tileSize;
  // PannerNode uses 3D coordinates; we map 2D to XZ plane
  panner.positionX.value = dx;
  panner.positionZ.value = dy;
  panner.positionY.value = 0;
}
```

### 3. UI Components

- **Microphone Toggle** - In BottomToolbar, pixel-art microphone icon
  - Green: active
  - Red: muted
  - Gray: not connected
- **Volume Indicators** - Small animated bars above characters who are speaking
  - Detect voice activity via `AnalyserNode` on each peer stream
  - Render 3-bar level indicator above character sprite
- **Voice Settings** - In SettingsModal
  - Input device selection
  - Output volume slider
  - Spatial audio toggle (on/off)
  - Voice activity threshold

## Floor Isolation

- Voice chat is scoped to the current floor (same as visual agents)
- Switching floors disconnects from current voice room and joins new one
- Server tracks which sockets are in voice chat per floor

## Quality Settings

| Setting | Value | Notes |
|---------|-------|-------|
| Codec | Opus | Built into WebRTC, excellent for voice |
| Sample rate | 48kHz | Opus default |
| Bitrate | 32kbps per peer | Sufficient for voice |
| Channels | Mono capture, stereo output | Spatial audio handles stereo |
| Echo cancellation | Enabled | Browser built-in |
| Noise suppression | Enabled | Browser built-in |

## Scalability Considerations

### Mesh Topology (default)

- Each participant connects to every other participant
- Works well for up to ~6-8 peers
- Bandwidth: N-1 upstream + N-1 downstream per participant
- CPU: N-1 decode operations per participant

### SFU Topology (future, >8 peers)

- Selective Forwarding Unit relays streams
- Each participant sends 1 upstream, receives N-1 downstream
- Requires server-side media processing (mediasoup, Janus)
- Significantly more complex to implement

### Recommended Limits

- Mesh mode: max 8 voice participants per floor
- SFU mode: max 25 voice participants per floor (future)
- Show warning when approaching limits

## Implementation Phases

### Phase 1: Basic Voice Chat

1. Add `getUserMedia` capture with mute toggle
2. Implement Socket.IO signaling relay on server
3. Establish WebRTC peer connections between browsers
4. Basic volume-only spatial audio (no panning)
5. Speaking indicator above characters

### Phase 2: Spatial Audio

1. Web Audio API spatial processing
2. PannerNode per peer, updated per frame
3. Distance-based volume rolloff
4. Stereo panning
5. Audio settings UI

### Phase 3: Quality of Life

1. Push-to-talk option (keybind)
2. Voice activity detection (auto-mute when silent)
3. Noise gate
4. Per-peer volume control
5. Audio device hot-swap

### Phase 4: Video (Optional)

1. Optional webcam sharing
2. Small video pip above character or in detail panel
3. Video-only mode (no spatial audio)
4. Screen sharing for debugging collaboration

## Dependencies

- WebRTC API: native browser support, no library needed
- Web Audio API: native browser support
- STUN server: `stun:stun.l.google.com:19302`
- Optional TURN: for restrictive networks (Twilio, Xirsys)
- No server-side audio processing required (mesh mode)

## Privacy & Security

- Audio is peer-to-peer, encrypted via DTLS-SRTP
- Server never receives audio data
- Microphone requires explicit user permission (browser prompt)
- Mute state is local (audio stops at source)
- No recording capability by default
