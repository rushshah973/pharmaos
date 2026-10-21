// Applies db/migrations/*.sql in filename order, once each.
//   npm run db:migrate          apply pending migrations
//   npm run db:reset            drop everything in the public schema, then migrate
import { config } from "dotenv";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";

config({ path: ".env.local" });
config();

const MIGRATIONS_DIR = path.resolve(process.cwd(), "db/migrations");

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (.env.local).");

  const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
  try {
    if (process.argv.includes("--reset")) {
      console.log("Resetting public schema...");
      await sql.unsafe(`
        drop schema if exists public cascade;
        create schema public;
        do $$
        begin
          if exists (select 1 from pg_roles where rolname = 'postgres') then
            grant all on schema public to postgres;
          end if;
          if exists (select 1 from pg_roles where rolname = 'service_role') then
            grant all on schema public to service_role;
          end if;
        end $$;
      `);
    }

    await sql.unsafe(`
      create table if not exists schema_migrations (
        name text primary key,
        applied_at timestamptz not null default now()
      );
    `);

    const applied = new Set(
      (await sql<{ name: string }[]>`select name from schema_migrations`).map((r) => r.name),
    );
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();

    for (const file of files) {
      if (applied.has(file)) continue;
      const body = readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
      await sql.begin(async (tx) => {
        await tx.unsafe(body);
        await tx`insert into schema_migrations (name) values (${file})`;
      });
      console.log(`Applied ${file}`);
    }
    console.log("Migrations up to date.");
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
