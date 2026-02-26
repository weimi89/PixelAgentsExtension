import { io } from 'socket.io-client'
import type { Socket } from 'socket.io-client'

const socket: Socket = io(window.location.origin, {
  transports: ['websocket', 'polling'],
})

// Expose same interface as vscodeApi.ts so all existing code works with minimal changes
export const vscode = {
  postMessage(msg: unknown): void {
    socket.emit('message', msg)
  },
}

/**
 * Listen for messages from the server.
 * Returns an unsubscribe function.
 */
export function onServerMessage(handler: (data: unknown) => void): () => void {
  socket.on('message', handler)
  return () => { socket.off('message', handler) }
}
