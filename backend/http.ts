// Replacements for AppDeploy's json()/error()/router() response & routing helpers.
// Built on plain Express so this backend can run anywhere Node.js runs.

import type { Request, Response } from 'express';

export interface RouteResult {
    status: number;
    body: unknown;
    cookie?: { action: 'set' | 'clear'; userId?: string };
}

export function json(body: unknown, status = 200): RouteResult {
    return { status, body };
}

export function error(message: string, status = 400): RouteResult {
    return { status, body: { error: message } };
}

export interface RouteContext {
    body: unknown;
    params: Record<string, string>;
    query: Record<string, string>;
    user?: { userId: string; name?: string } | null;
    req: Request;
}

export type RouteHandler = (ctx: RouteContext) => Promise<RouteResult>;
export type Middleware = (ctx: RouteContext) => Promise<RouteResult | null>;
export type RouteDefinition = (Middleware | RouteHandler)[];

// routes: { "METHOD /path/:param": [ ...optionalMiddleware, handler ] }
export function router(routes: Record<string, RouteDefinition>) {
    return { routes };
}

export async function runRoute(definition: RouteDefinition, ctx: RouteContext): Promise<RouteResult> {
    const steps = definition;
    for (let i = 0; i < steps.length - 1; i++) {
        const middleware = steps[i] as Middleware;
        const result = await middleware(ctx);
        if (result) return result; // middleware short-circuited (e.g. auth failure)
    }
    const handler = steps[steps.length - 1] as RouteHandler;
    return handler(ctx);
}

export function sendResult(res: Response, result: RouteResult) {
    res.status(result.status).json(result.body);
}
