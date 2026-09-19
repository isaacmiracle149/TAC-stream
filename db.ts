// Replacement for AppDeploy's `db` (list/add/get/update/delete).
// Backed by a local SQLite file (via better-sqlite3) instead of AppDeploy's hosted database.
//
// Storage model: one physical SQLite table ("records") holds every logical "table" as
// (table_name, id, data JSON). This keeps the exact same schemaless list/filter/get/update/delete
// API the routes already call, without having to define a SQL schema per entity.

import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import path from 'path';
import fs from 'fs';

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = path.join(DATA_DIR, 'tac-stream.sqlite');

const sqlite = new Database(DB_PATH);
sqlite.pragma('journal_mode = WAL');
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS records (
    table_name TEXT NOT NULL,
    id TEXT NOT NULL,
    data TEXT NOT NULL,
    PRIMARY KEY (table_name, id)
  );
`);

const selectAllStmt = sqlite.prepare('SELECT id, data FROM records WHERE table_name = ?');
const selectOneStmt = sqlite.prepare('SELECT id, data FROM records WHERE table_name = ? AND id = ?');
const insertStmt = sqlite.prepare('INSERT INTO records (table_name, id, data) VALUES (?, ?, ?)');
const updateStmt = sqlite.prepare('UPDATE records SET data = ? WHERE table_name = ? AND id = ?');
const deleteStmt = sqlite.prepare('DELETE FROM records WHERE table_name = ? AND id = ?');

function rowToRecord<T>(row: { id: string; data: string }): T {
    return { ...JSON.parse(row.data), id: row.id } as T;
}

export interface ListOptions {
    filter?: Record<string, unknown>;
    limit?: number;
}

export const db = {
    async list<T = any>(table: string, options: ListOptions = {}): Promise<{ items: T[] }> {
        const rows = selectAllStmt.all(table) as { id: string; data: string }[];
        let items = rows.map(row => rowToRecord<T>(row));
        if (options.filter) {
            const filter = options.filter;
            items = items.filter(item =>
                Object.entries(filter).every(([key, value]) => (item as any)[key] === value)
            );
        }
        if (options.limit) items = items.slice(0, options.limit);
        return { items };
    },

    async get<T = any>(table: string, ids: string[]): Promise<(T | undefined)[]> {
        return ids.map(id => {
            const row = selectOneStmt.get(table, id) as { id: string; data: string } | undefined;
            return row ? rowToRecord<T>(row) : undefined;
        });
    },

    async add(table: string, records: Record<string, unknown>[]): Promise<(string | undefined)[]> {
        const ids: (string | undefined)[] = [];
        for (const record of records) {
            const id = randomUUID();
            try {
                insertStmt.run(table, id, JSON.stringify(record));
                ids.push(id);
            } catch (err) {
                console.error('db_add_failed', table, err);
                ids.push(undefined);
            }
        }
        return ids;
    },

    async update(table: string, updates: { id: string; record: Record<string, unknown> }[]): Promise<boolean[]> {
        return updates.map(({ id, record }) => {
            try {
                const { id: _drop, ...rest } = record as any;
                const result = updateStmt.run(JSON.stringify(rest), table, id);
                return result.changes > 0;
            } catch (err) {
                console.error('db_update_failed', table, id, err);
                return false;
            }
        });
    },

    async delete(table: string, ids: string[]): Promise<boolean[]> {
        return ids.map(id => {
            try {
                const result = deleteStmt.run(table, id);
                return result.changes > 0;
            } catch (err) {
                console.error('db_delete_failed', table, id, err);
                return false;
            }
        });
    },
};
