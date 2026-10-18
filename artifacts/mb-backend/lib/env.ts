import type { Sql } from "postgres";
import { assertDatabaseUrl } from "@/lib/config";

// Postgres (Supabase) behind the small statement API the app uses:
//   env.DB.prepare(sql).bind(...args).first() / .all() / .run(), and env.DB.batch([...]).
// SQL uses `?` placeholders; they are rewritten to $1..$n. Dates, timestamps, and jsonb come
// back as text (YYYY-MM-DD, ISO 8601, raw JSON) so callers handle plain strings.
// Automated tests use DATABASE_URL=pglite:memory. The dev server and production use a Postgres URL.

type Row = Record<string, unknown>;
type Args = unknown[];

interface Driver {
  query(sql: string, args: Args): Promise<{ rows: Row[]; changes: number }>;
  transaction(statements: { sql: string; args: Args }[]): Promise<Row[][]>;
}

const OID = { date: 1082, timestamp: 1114, timestamptz: 1184, json: 114, jsonb: 3802 };
// "2026-10-08 03:47:41.648+00" -> "2026-10-08T03:47:41.648Z"
export const iso = (v: string) => {
  let s = v.trim().replace(" ", "T");
  if (/[+-]\d{2}$/.test(s)) s += ":00";
  else if (!/(Z|[+-]\d{2}:?\d{2})$/.test(s)) s += "Z";
  return new Date(s).toISOString();
};

export const toPgPlaceholders = (sql: string) => {
  let n = 0;
  return sql.replace(/\?/g, () => `$${++n}`);
};

function postgresDriver(url: string): Driver {
  let client: Sql | undefined;
  const sql = async () => {
    if (client) return client;
    const { default: postgres } = await import("postgres");
    const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
    client = postgres(url, {
      prepare: false, // required for Supabase's transaction pooler
      ssl: local ? false : "require",
      max: 3,
      idle_timeout: 20,
      types: {
        dateText: { to: OID.date, from: [OID.date], serialize: (x: string) => x, parse: (x: string) => x },
        stamp: { to: OID.timestamptz, from: [OID.timestamp, OID.timestamptz], serialize: (x: string) => x, parse: iso },
        jsonText: { to: OID.jsonb, from: [OID.json, OID.jsonb], serialize: (x: string) => x, parse: (x: string) => x },
      },
    });
    return client;
  };
  const params = (args: Args) => args.map((a) => (a === undefined ? null : a)) as never[];
  return {
    async query(text, args) {
      const result = await (await sql()).unsafe(toPgPlaceholders(text), params(args));
      return { rows: [...result] as Row[], changes: result.count ?? 0 };
    },
    async transaction(statements) {
      return (await sql()).begin(async (tx) => {
        const out: Row[][] = [];
        for (const s of statements) out.push([...(await tx.unsafe(toPgPlaceholders(s.sql), params(s.args)))] as Row[]);
        return out;
      }) as Promise<Row[][]>;
    },
  };
}

// Test databases only. `pglite:memory` applies migrations on startup and survives hot reloads;
// it resets when that test process exits. The dev server must use Postgres instead.
function pgliteDriver(dataDir: string): Driver {
  type Lite = {
    query: (sql: string, args?: Args) => Promise<{ rows: Row[]; affectedRows?: number }>;
    exec: (sql: string) => Promise<unknown>;
    transaction: <T>(fn: (tx: Lite) => Promise<T>) => Promise<T>;
  };
  const memory = dataDir === "memory";
  const cache = globalThis as unknown as { __mbPglite?: Map<string, Promise<Lite>> };
  const opened = (cache.__mbPglite ??= new Map());
  const open = (): Promise<Lite> => {
    const existing = opened.get(dataDir);
    if (existing) return existing;
    const ready = (async () => {
      const mod = "@electric-sql/pglite";
      const { PGlite } = (await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ mod)) as { PGlite: new (dir: string, opts: unknown) => Lite };
      const db = new PGlite(memory ? "memory://" : dataDir, {
        parsers: { [OID.date]: (x: string) => x, [OID.timestamp]: iso, [OID.timestamptz]: iso, [OID.json]: (x: string) => x, [OID.jsonb]: (x: string) => x },
      });
      if (memory) {
        const { readdirSync, readFileSync } = await import("node:fs");
        const { join } = await import("node:path");
        const dir = join(process.cwd(), "db", "migrations");
        await db.exec("CREATE TABLE IF NOT EXISTS _migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
        for (const file of readdirSync(dir).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort()) {
          await db.exec(readFileSync(join(dir, file), "utf8"));
          await db.query("INSERT INTO _migrations (name) VALUES ($1)", [file]);
        }
      }
      return db;
    })();
    opened.set(dataDir, ready);
    return ready;
  };
  return {
    async query(text, args) {
      const r = await (await open()).query(toPgPlaceholders(text), args.map((a) => (a === undefined ? null : a)));
      return { rows: r.rows, changes: r.affectedRows ?? 0 };
    },
    async transaction(statements) {
      return (await open()).transaction(async (tx: Lite) => {
        const out: Row[][] = [];
        for (const s of statements) out.push((await tx.query(toPgPlaceholders(s.sql), s.args.map((a) => (a === undefined ? null : a)))).rows);
        return out;
      });
    },
  };
}

export class Statement {
  private driver: Driver;
  readonly sql: string;
  readonly args: Args;
  constructor(driver: Driver, sql: string, args: Args = []) {
    this.driver = driver;
    this.sql = sql;
    this.args = args;
  }

  bind(...args: unknown[]) {
    return new Statement(this.driver, this.sql, args);
  }

  async all<T = Row>() {
    const { rows } = await this.driver.query(this.sql, this.args);
    return { results: rows as T[], success: true };
  }

  async first<T = Row>() {
    const { rows } = await this.driver.query(this.sql, this.args);
    return (rows[0] ?? null) as T | null;
  }

  async run() {
    const { changes } = await this.driver.query(this.sql, this.args);
    return { success: true, meta: { changes } };
  }
}

export class Database {
  private driver: Driver;
  constructor(driver: Driver) {
    this.driver = driver;
  }

  prepare(sql: string) {
    return new Statement(this.driver, sql);
  }

  // Runs statements atomically in one transaction.
  async batch(statements: Statement[]) {
    const results = await this.driver.transaction(statements.map((s) => ({ sql: s.sql, args: s.args })));
    return results.map((rows) => ({ results: rows, success: true }));
  }
}

export function databaseUrl() {
  return process.env.DATABASE_URL || process.env.POSTGRES_URL || "";
}

let database: Database | undefined;

export function getDatabase(): Database | undefined {
  if (database) return database;
  const url = databaseUrl();
  if (!url) return undefined;
  assertDatabaseUrl(url);
  database = new Database(url.startsWith("pglite:") ? pgliteDriver(url.slice("pglite:".length)) : postgresDriver(url));
  return database;
}

// env.DB is the database; any other key reads process.env.
export const env = new Proxy({} as Record<string, string | undefined> & { DB?: Database }, {
  get(_target, key: string) {
    return key === "DB" ? getDatabase() : process.env[key];
  },
});
