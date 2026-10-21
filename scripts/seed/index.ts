// npm run seed — the whole seed pipeline (implementationplan.md §5.8):
// profile.json → generate → inject demo cases → validate (exit 1 on failure) → write.
import { config } from "dotenv";
import { parse } from "csv-parse/sync";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { generate, type Profile } from "./generate-synthetic";
import { injectDemoCases } from "./inject-demo-cases";
import { validate } from "./validate";
import { writeDataset, writeSnapshots, type SourceEntry } from "./write";

config({ path: ".env.local", quiet: true });
config({ quiet: true });

const SEED = 42;
const REF_DIR = path.resolve(process.cwd(), "data/reference");
const OUT_DIR = path.resolve(process.cwd(), "data/synthetic");

type SourceWithColumns = SourceEntry & { file: string; columns: Record<string, string> };

/** Lower-case brand, manufacturer and distributor names from the reference files (for the no-copy rule). */
function loadReferenceNames(sources: SourceWithColumns[]): Set<string> | null {
  const names = new Set<string>();
  let anyFile = false;
  const fields = ["name", "manufacturer", "distributor"];
  for (const src of sources) {
    const file = path.join(REF_DIR, src.file);
    if (!existsSync(file)) continue;
    anyFile = true;
    const rows = parse(readFileSync(file), { columns: true, trim: true, skip_empty_lines: true, bom: true }) as Record<string, string>[];
    for (const field of fields) {
      const col = src.columns[field];
      if (!col) continue;
      for (const r of rows) if (r[col]) names.add(r[col].trim().toLowerCase());
    }
  }
  return anyFile ? names : null;
}

async function main() {
  const asOf = process.env.DEMO_AS_OF_DATE?.trim() || new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) throw new Error(`DEMO_AS_OF_DATE must be YYYY-MM-DD, got "${asOf}"`);
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (.env.local).");

  const sources = JSON.parse(readFileSync(path.join(REF_DIR, "sources.json"), "utf8")) as SourceWithColumns[];
  const profilePath = path.join(REF_DIR, "profile.json");
  let profile: Profile = {};
  if (existsSync(profilePath)) profile = JSON.parse(readFileSync(profilePath, "utf8")) as Profile;
  else console.warn("profile.json not found: using generator defaults.");

  const referenceNames = loadReferenceNames(sources);
  console.log(`Seeding: as-of ${asOf}, seed ${SEED}`);

  const data = generate(profile, asOf, SEED, { forbiddenNames: referenceNames ?? undefined });
  const cases = injectDemoCases(data, SEED);
  const { failures, notes } = validate(data, cases, { referenceNames, sourceIds: sources.map((s) => s.id) });
  for (const n of notes) console.log(`  · ${n}`);
  if (failures.length) {
    console.error(`\nValidation FAILED (${failures.length}):`);
    for (const f of failures.slice(0, 50)) console.error(`  ✗ ${f}`);
    process.exit(1);
  }
  console.log("Validation passed.");

  const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
  try {
    const counts = await writeDataset(sql, data, sources);
    writeSnapshots(OUT_DIR, data);
    writeFileSync(path.join(OUT_DIR, "demo-cases.json"), JSON.stringify({ asOf, seed: SEED, ...cases }, null, 2) + "\n");
    console.log("\nRows written:");
    console.table(Object.entries(counts).map(([table, rows]) => ({ table, rows })));
    console.log(`Snapshots and demo-cases.json written to ${path.relative(process.cwd(), OUT_DIR)}/`);
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
