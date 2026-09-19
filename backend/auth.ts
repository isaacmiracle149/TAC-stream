// Replacement for AppDeploy's requireAuth(). Minimal email+password auth with a signed
// session cookie. Good enough for a small trial; can be swapped for something more
// full-featured later without touching the routes that call requireAuth().

import { randomUUID, createHmac, timingSafeEqual, scryptSync, randomBytes } from 'crypto';
import type { Request, Response } from 'express';
import { db } from './db';
import type { RouteContext, RouteResult, RouteDefinition } from './http';
import { error } from './http';

const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-only-insecure-secret-change-me';
const COOKIE_NAME = 'tac_session';
const SESSION_DAYS = 30;

interface UserRecord {
    id: string;
    email: string;
    name?: string;
    password_hash: string;
    created_at: string;
}

function hashPassword(password: string): string {
    const salt = randomBytes(16).toString('hex');
    const hash = scryptSync(password, salt, 64).toString('hex');
    return `${salt}:${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
    const [salt, hash] = stored.split(':');
    if (!salt || !hash) return false;
    const check = scryptSync(password, salt, 64);
    const original = Buffer.from(hash, 'hex');
    return check.length === original.length && timingSafeEqual(check, original);
}

function sign(value: string): string {
    return createHmac('sha256', SESSION_SECRET).update(value).digest('hex');
}

function makeToken(userId: string): string {
    const payload = `${userId}.${Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000}`;
    return `${payload}.${sign(payload)}`;
}

function readToken(token: string | undefined): { userId: string } | null {
    if (!token) return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [userId, expiresAtRaw, sig] = parts;
    const payload = `${userId}.${expiresAtRaw}`;
    if (sign(payload) !== sig) return null;
    const expiresAt = Number(expiresAtRaw);
    if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) return null;
    return { userId };
}

export function getUserFromRequest(req: Request): { userId: string; name?: string } | null {
    const token = req.cookies?.[COOKIE_NAME];
    const session = readToken(token);
    return session ? { userId: session.userId } : null;
}

export function setSessionCookie(res: Response, userId: string) {
    res.cookie(COOKIE_NAME, makeToken(userId), {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000,
    });
}

export function clearSessionCookie(res: Response) {
    res.clearCookie(COOKIE_NAME);
}

export function requireAuth() {
    return async (ctx: RouteContext): Promise<RouteResult | null> => {
        if (!ctx.user) return error('Authentication required', 401);
        return null;
    };
}

export const authRoutes: Record<string, RouteDefinition> = {
    'POST /api/auth/signup': [
        async ({ body, req }: RouteContext) => {
            const input = (body || {}) as { email?: string; password?: string; name?: string };
            const email = input.email?.trim().toLowerCase();
            const password = input.password;
            if (!email || !password || password.length < 8) {
                return error('A valid email and a password of at least 8 characters are required', 400);
            }
            const { items: existing } = await db.list<UserRecord>('users', { filter: { email }, limit: 1 });
            if (existing.length) return error('An account with that email already exists', 409);
            const [id] = await db.add('users', [
                {
                    email,
                    name: input.name?.trim() || '',
                    password_hash: hashPassword(password),
                    created_at: new Date().toISOString(),
                },
            ]);
            if (!id) return error('Could not create account', 500);
            return { status: 201, body: { user: { userId: id, email, name: input.name || '' } }, cookie: { action: 'set', userId: id } };
        },
    ],
    'POST /api/auth/login': [
        async ({ body }: RouteContext) => {
            const input = (body || {}) as { email?: string; password?: string };
            const email = input.email?.trim().toLowerCase();
            if (!email || !input.password) return error('Email and password are required', 400);
            const { items } = await db.list<UserRecord>('users', { filter: { email }, limit: 1 });
            const user = items[0];
            if (!user || !verifyPassword(input.password, user.password_hash)) {
                return error('Invalid email or password', 401);
            }
            return { status: 200, body: { user: { userId: user.id, email: user.email, name: user.name || '' } }, cookie: { action: 'set', userId: user.id } };
        },
    ],
    'POST /api/auth/logout': [
        async () => ({ status: 200, body: { ok: true }, cookie: { action: 'clear' } }),
    ],
};
