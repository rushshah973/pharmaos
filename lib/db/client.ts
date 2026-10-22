import postgres from "postgres";

// One shared connection pool per server process. In dev, Next.js hot reload
// re-imports modules, so the pool is cached on globalThis to avoid leaks.
type Sql = ReturnType<typeof postgres>;

const globalForDb = globalThis as unknown as { pharmaosSql?: Sql };

export function getSql(): Sql {
  if (globalForDb.pharmaosSql) return globalForDb.pharmaosSql;

  const raw = process.env.DATABASE_URL;
  if (!raw) {
    throw new Error("DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.");
  }

  // Supabase's session pooler (port 5432) gives each app connection its own database client and allows only
  // pool_size of them at once (15 on the free tier). That suits a long-lived local server (4 connections) and
  // the scripts, with prepared statements on (each parameterised query is one round trip).
  // On Vercel it does not: Vercel freezes idle function instances, so idle_timeout never fires and their
  // connections stay pinned until the pooler is full (EMAXCONNSESSION, 22 Oct). There the app uses the
  // transaction pooler instead (same host, port 6543), which holds a database client only for the length of
  // a transaction; it needs prepare: false. Set DATABASE_POOLER=session to opt out.
  const serverless = Boolean(process.env.VERCEL);
  const url = serverless && process.env.DATABASE_POOLER !== "session" ? transactionPoolerUrl(raw) : raw;
  const transactionMode = /:6543(\/|$)/.test(url);
  const options = {
    max: transactionMode ? 10 : serverless ? 2 : 4,
    prepare: !transactionMode,
    idle_timeout: serverless ? 5 : 20,
    ...(serverless ? { max_lifetime: 60 } : {}),
    // Give up connecting after 15 s, so a dead pooled connection never hangs a request.
    connect_timeout: 15,
  };
  // One query in flight per connection on the transaction pooler: Supavisor can hand the next autocommit query
  // to another database client, so a query pipelined behind a running one never gets its answer and the request
  // hangs (seen 22 Oct under parallel page loads). In postgres.js 3.4, max_pipeline 1 still lets a second query
  // in behind the running one; 0 means none. But with 0, sql.begin never reserves its connection (BEGIN fails
  // with UNSAFE_TRANSACTION), so transactions go through a second pool with the default pipeline: inside a
  // transaction Supavisor keeps the same database client, so pipelining there is safe.
  // max_pipeline is a real option that postgres.js leaves out of its types.
  const sql = postgres(url, transactionMode ? ({ ...options, max_pipeline: 0 } as typeof options) : options);
  if (transactionMode) {
    const tx = postgres(url, { ...options, max: 5 });
    sql.begin = tx.begin;
    const end = sql.end;
    sql.end = (opts) => Promise.all([end(opts), tx.end(opts)]).then(() => undefined);
  }

  globalForDb.pharmaosSql = sql;
  return sql;
}

/** The Supabase pooler URL on the transaction port (6543); any other URL is returned unchanged. */
export function transactionPoolerUrl(raw: string): string {
  try {
    const u = new URL(raw);
    if (!u.hostname.endsWith(".pooler.supabase.com") || (u.port || "5432") !== "5432") return raw;
    u.port = "6543";
    return u.toString();
  } catch {
    return raw;
  }
}
