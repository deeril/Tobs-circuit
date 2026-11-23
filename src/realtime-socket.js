import { io } from 'socket.io-client';

const socketUrl = import.meta.env.VITE_SOCKET_URL
  || import.meta.env.VITE_API_BASE_URL
  || (import.meta.env.DEV ? window.location.origin : '');
const socketPath = import.meta.env.VITE_SOCKET_PATH
  || (import.meta.env.PROD && !import.meta.env.VITE_SOCKET_URL
    ? '/api/socket'
    : '/socket.io');

export function createRealtimeSocket() {
  return io(socketUrl, {
    path: socketPath,
    withCredentials: true,
    transports: ['websocket'],
    reconnection: true
  });
}
