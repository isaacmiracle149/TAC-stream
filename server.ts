// Standalone server entrypoint. Run with: npm run server (see package.json).
// This is what actually listens on a port and dispatches HTTP requests to the
// route table defined in index.ts — replacing whatever AppDeploy's own runtime did.

import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import http from 'http';
import { handler } from './index';
import { runRoute, sendResult, type RouteContext } from './http';
import { getUserFromRequest, setSessionCookie, clearSessionCookie } from './auth';
import { attachWebSocketServer } from './realtime-ws';

const PORT = Number(process.env.PORT) || 8787;
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';

const app = express();
app.use(cors({ origin: CORS_ORIGIN === '*' ? true : CORS_ORIGIN.split(','), credentials: true }));
app.use(cookieParser());
app.use(express.json({ limit: '10mb' }));

// Build an Express route for every entry in the router's table.
// Table keys look like "POST /api/pairings/:code/join" — split on the first space.
for (const [routeKey, definition] of Object.entries(handler.routes)) {
    const spaceIdx = routeKey.indexOf(' ');
    const method = routeKey.slice(0, spaceIdx).toLowerCase();
    const routePath = routeKey.slice(spaceIdx + 1);
    const expressMethod = (app as any)[method];
    if (typeof expressMethod !== 'function') {
        console.warn(`Unsupported HTTP method in route "${routeKey}", skipping.`);
        continue;
    }
    expressMethod.call(app, routePath, async (req: express.Request, res: express.Response) => {
        const ctx: RouteContext = {
            body: req.body,
            params: req.params as Record<string, string>,
            query: req.query as Record<string, string>,
            user: getUserFromRequest(req),
            req,
        };
        try {
            const result = await runRoute(definition, ctx);
            if (result.cookie?.action === 'set' && result.cookie.userId) {
                setSessionCookie(res, result.cookie.userId);
            } else if (result.cookie?.action === 'clear') {
                clearSessionCookie(res);
            }
            sendResult(res, result);
        } catch (err) {
            console.error(`route_error ${routeKey}`, err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });
}

const httpServer = http.createServer(app);
attachWebSocketServer(httpServer);

httpServer.listen(PORT, () => {
    console.log(`TAC Stream backend listening on port ${PORT}`);
    console.log(`WebSocket endpoint: ws://localhost:${PORT}/ws`);
    if (!process.env.GEMINI_API_KEY) console.warn('GEMINI_API_KEY not set — Bible detection will fail.');
    if (!process.env.API_BIBLE_KEY) console.warn('API_BIBLE_KEY not set — verse lookups will fail.');
});
