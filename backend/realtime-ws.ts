// Replacement for AppDeploy's `ws` (WebSocket push). Plain 'ws' package server.

import { WebSocketServer, WebSocket } from 'ws';
import type { Server as HttpServer } from 'http';
import { randomUUID } from 'crypto';
import { removeSubscriptionsByConnection } from './realtime-subscribers';

const connections = new Map<string, WebSocket>();

export function attachWebSocketServer(httpServer: HttpServer) {
    const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

    wss.on('connection', socket => {
        const connectionId = randomUUID();
        connections.set(connectionId, socket);

        socket.send(
            JSON.stringify({
                v: 1,
                type: 'system.connected',
                payload: { connection_id: connectionId },
            })
        );

        socket.on('close', () => {
            connections.delete(connectionId);
            void removeSubscriptionsByConnection(connectionId);
        });

        socket.on('error', () => {
            connections.delete(connectionId);
        });
    });

    return wss;
}

export const ws = {
    async send(connectionIds: string[], message: unknown) {
        const payload = JSON.stringify(message);
        for (const id of connectionIds) {
            const socket = connections.get(id);
            if (socket && socket.readyState === WebSocket.OPEN) {
                socket.send(payload);
            }
        }
    },
};
