import postgres from "postgres";

// One shared connection pool per server process. In dev, Next.js hot reload
// re-imports modules, so the pool is cached on globalThis to avoid leaks.
type Sql = ReturnType<typeof postgres>;

const globalForDb = globalThis as unknown as { pharmaosSql?: Sql };

export function getSql(): Sql {
  if (globalForDb.pharmaosSql) return globalForDb.pharmaosSql;

  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.");
  }

  // Supabase's session pooler (port 5432) gives each app connection its own database client and allows only
  // pool_size of them at once (15 on the free tier). A long-lived local server keeps 4. On Vercel every
  // function instance has its own pool, so each keeps at most 2 and lets idle ones go after 5 s and every
  // one go after a minute; otherwise a few instances fill the pooler (EMAXCONNSESSION) and pages fail.
  // Do not use the transaction pooler (port 6543): postgres.js queries get stuck on it mid-query.
  // Prepared statements stay on: without them every parameterised query costs an extra round trip.
  const serverless = Boolean(process.env.VERCEL);
  const sql = postgres(url, {
    max: serverless ? 2 : 4,
    prepare: true,
    idle_timeout: serverless ? 5 : 20,
    ...(serverless ? { max_lifetime: 60 } : {}),
    // Give up connecting after 15 s, so a dead pooled connection never hangs a request.
    connect_timeout: 15,
  });

  globalForDb.pharmaosSql = sql;
  return sql;
}
