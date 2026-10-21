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

  const sql = postgres(url, {
    // Small on purpose: with prepared statements, parallel reads pipeline on few connections, and each
    // new connection must prepare every statement once (slow to a far-away database).
    max: 4,
    // Use Supabase's session pooler (port 5432); parallel queries hang on the transaction pooler (6543).
    // Prepared statements stay on (the session pooler supports them): without them every parameterised
    // query costs an extra round trip and stops pipelining, which is ~10× slower to a far-away database.
    prepare: true,
    // Close idle connections after 20 s and give up connecting after 15 s: the pooler / network drops idle
    // sockets, and a dead pooled connection otherwise hangs a request until the OS read timeout.
    idle_timeout: 20,
    connect_timeout: 15,
  });

  globalForDb.pharmaosSql = sql;
  return sql;
}
