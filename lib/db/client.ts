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
    max: 5,
    // Use Supabase's session pooler (port 5432); parallel queries hang on the transaction pooler (6543).
    // Prepared statements are off so the same client also works through any pooler.
    prepare: false,
  });

  globalForDb.pharmaosSql = sql;
  return sql;
}
