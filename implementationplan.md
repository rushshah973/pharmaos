# PharmaOS — Implementation Plan

> Web-based dashboard · solo builder · 30 hours · Next.js 16 + Supabase Postgres + Gemini
> Read `problemstatement.md` first. This file is the build source of truth: follow it stage by stage, in order. Do not add modules that are not in it.

---

## 0. How to use this plan

1. Work **one stage at a time** (section 15). Each stage lists its files, exact behaviour, and a "Verify" block. Do not start the next stage until its Verify block passes.
2. When an AI coding assistant writes the code, use the ready-made prompts in `prompts.md` (P00–P28), or give it this file plus the stage number. Tell it: *"Implement stage N exactly as written in implementationplan.md. Do not invent features, tables or endpoints."*
3. After every stage: `npm run check` (typecheck + lint + unit tests), then commit: `git add -A && git commit -m "stage N: <name>"`.
4. Every number shown in the UI must come from the database or from `lib/business-logic`. No hard-coded dashboard values.
5. If something in this plan turns out to be wrong while building, fix the plan in the same commit so the plan and code never disagree.

### 0.1 Rules the code must always follow

| # | Rule |
|---|---|
| R1 | All arithmetic for quantities, prices, totals and scores lives in `lib/business-logic/*` (pure functions, unit-tested). Routes, UI and the LLM never compute them. |
| R2 | Money uses `lib/money.ts` (decimal.js). Never use JS floats for rupees. DB money columns are `numeric`; postgres.js returns them as strings — pass strings into `dec()`. |
| R3 | Every quantity is an integer number of **packs**. |
| R4 | The browser is never the source of truth for totals. The server recomputes on every edit and on approval. |
| R5 | Only the approve endpoint creates purchase orders, inside one DB transaction, idempotently. The LLM has no tool that creates or approves POs. |
| R6 | Nothing is sent to suppliers. Statuses "sent", "ordered" or "confirmed" never appear. |
| R7 | Every mutation writes an `audit_logs` row (section 13). |
| R8 | Every screen shows the data-source badge ("Synthetic demo data"), and detail views show each record's `data_source` label. Never call generated data real, and never present a supplier price as a real quote. |
| R9 | The dashboard must work fully with `GEMINI_API_KEY` empty: only chat/explanations switch to the deterministic text. |
| R10 | No secrets in client code. DB and Gemini clients are imported only from server files (`lib/db`, `lib/services`, `lib/agents`, `app/api`). |

---

## 1. Locked decisions

| Area | Decision | Why |
|---|---|---|
| Product type | **Web-based dashboard** opened in a desktop browser (latest Chrome or Edge; designed for 1280 px and wider, usable on a tablet). No mobile or desktop app | Team decision; one codebase, nothing to install |
| Framework | Next.js **16.4.2** (App Router, Turbopack, `cacheComponents: true`), React 19.3, TypeScript strict | Installed by `create-next-app`; read `node_modules/next/dist/docs/` before using an unfamiliar API (see `AGENTS.md`) |
| UI kit | Tailwind v4 + shadcn/ui, style **base-nova** (built on **Base UI**, not Radix) | Installed. Base UI components compose with the `render` prop, not `asChild` — read the file in `components/ui/` before using a component |
| Icons | lucide-react | Installed |
| Charts | Recharts 3 | Only on Recommendation Detail (demand history) and the ROI model |
| 3D | three 0.186 + @react-three/fiber 9 + @react-three/drei 10 | Installed |
| Database | Supabase Postgres (or any Postgres 15+) via **postgres.js** with `DATABASE_URL` | Real transactions for approval; no Supabase SDK needed |
| Migrations | Plain SQL in `db/migrations/`, applied by `npm run db:migrate` | Already written: `001_init.sql` |
| Validation | Zod 4 | API inputs, tool inputs, seed rows |
| Money | decimal.js via `lib/money.ts` | Already written and tested |
| AI | Google Gemini via `@google/genai` 2.30 (TypeScript), model from `GEMINI_MODEL`, default `gemini-flash-latest`. Manual function-calling loop, mode `AUTO`, automatic function calling disabled | Team choice; explicit workflow; no agent framework |
| Tests | Vitest 5 (`tests/**/*.test.ts`) | Already configured: `vitest.config.mts` |
| Scripts | tsx for seed and migration scripts | Installed |
| Synthetic data | `@faker-js/faker` with a fixed seed (42) + a seeded PRNG for demand | Reproducible demo |
| CSV | `csv-parse` for reading reference datasets (profiling only) | Installed |
| Auth | None. Approver name comes from `DEMO_USER` | Demo scope |
| Deploy | Vercel + Supabase (optional); demo runs locally with `npm run dev` | Keys server-side only |
| "Today" | `as_of_date` = `DEMO_AS_OF_DATE` if set, else `app_state.as_of_date` if set, else max(`sales_history.sale_date`) | Reproducible numbers on demo day |

### 1.1 Next.js 16 rules that affect this project

- **Dynamic params are Promises.** Pages: `export default async function Page(props: PageProps<'/procurement/[planId]'>) { const { planId } = await props.params; }`. Route handlers: `export async function GET(req: NextRequest, ctx: RouteContext<'/api/purchase-plans/[id]'>) { const { id } = await ctx.params; }`. `PageProps`, `LayoutProps`, `RouteContext` are global types generated by `next typegen` (run by `npm run typecheck` and by `next dev`).
- **Cache Components is on.** Any server component that reads the database must sit inside a `<Suspense>` boundary, and should call `await connection()` (from `next/server`) before its first query so it always renders at request time. Pattern for every page:
  ```tsx
  export default function Page() {
    return (
      <Suspense fallback={<PageSkeleton />}>
        <CommandCenterView />   {/* async server component: await connection(); then query */}
      </Suspense>
    );
  }
  ```
  Without this, `next build` fails with a "blocking-route" error.
- **Route handlers** (`app/api/**/route.ts`) that read the DB are dynamic automatically. Never put a `route.ts` and a `page.tsx` in the same folder.
- `app/page.tsx` (the starter page) **conflicts** with `app/(dashboard)/page.tsx` (both are `/`). Delete `app/page.tsx` in stage 1.
- `next/dynamic` with `{ ssr: false }` is allowed only inside a client component. The 3D scene is loaded that way.

---

## 2. Repository layout

Already created (folders contain `.gitkeep` until filled). `✅` = file exists now.

```
pharmaos/
├── AGENTS.md                          ✅ Next.js agent rules + project rules
├── problemstatement.md                ✅
├── architecture.md                   ✅ layers, flows, data model, decisions
├── prompts.md                        ✅ build prompts P00–P28, run one by one
├── implementationplan.md              ✅ this file
├── .env.example                       ✅ copy to .env.local
├── package.json                       ✅ scripts: dev, build, lint, typecheck, test, check, db:migrate, db:reset, seed
├── vitest.config.mts                  ✅
├── db/migrations/001_init.sql         ✅ full schema + default scenarios + app_state
├── data/
│   ├── reference/                     ✅ reference datasets (git-ignored) + sources.json + profile.json
│   └── synthetic/                     generated CSV snapshots for inspection (git-ignored)
├── scripts/
│   ├── db/migrate.ts                  ✅ applies migrations; --reset drops the public schema first
│   └── seed/
│       ├── index.ts                   orchestrates the whole seed (stage 1)
│       ├── prng.ts                    seeded random helpers (mulberry32, poisson, pick, weighted)
│       ├── profile-reference.ts       reads data/reference/* and writes profile.json (aggregates only)
│       ├── generate-synthetic.ts      fills every gap in the schema
│       ├── inject-demo-cases.ts       guarantees the required demo cases
│       ├── validate.ts                integrity checks; fails loudly
│       └── write.ts                   inserts rows in FK order + writes CSV snapshots
├── lib/
│   ├── money.ts                       ✅ decimal helpers + INR formatting
│   ├── utils.ts                       ✅ shadcn cn()
│   ├── db/
│   │   ├── client.ts                  ✅ getSql() shared pool
│   │   └── queries/                   typed read queries per table group (stage 2)
│   ├── validation/
│   │   ├── tool-contract.ts           ✅ ToolResult type, toolOk(), toolError()
│   │   └── api.ts                     Zod schemas for every API body/query (stage 3)
│   ├── business-logic/                PURE functions only. No DB, no fetch.
│   │   ├── config.ts                  ✅ every tunable constant
│   │   ├── dates.ts                   daysBetween, addDays (UTC, date-only)
│   │   ├── types.ts                   engine input/output types
│   │   ├── demand.ts                  demand baseline + flags
│   │   ├── expiry.ts                  FEFO sell-through + at-risk value
│   │   ├── inventory.ts               stock position, cover, ROP, target, status
│   │   ├── ordering.ts                raw qty, pack/MOQ rounding, scheme decision
│   │   ├── supplier-scoring.ts        eligibility filter, effective cost, score
│   │   ├── totals.ts                  line and plan totals
│   │   ├── priority.ts                loss prevented per rupee
│   │   ├── basket.ts                  greedy budget basket + second pass
│   │   ├── impact.ts                  Plan Impact Card values
│   │   ├── validation.ts              hard stops + soft warnings
│   │   ├── heatmap.ts                 per-bin status
│   │   ├── putaway.ts                 candidate bin selection
│   │   └── engine.ts                  analyseSku() + buildPlan(): composes the above
│   ├── services/                      DB + business logic. Server only.
│   │   ├── context.ts                 loadPlanningContext(): one read of everything the engine needs
│   │   ├── as-of.ts                   resolveAsOfDate()
│   │   ├── dashboard.ts               Command Center metrics
│   │   ├── plans.ts                   createPlan, getPlan, editLine, recalculatePlan, rejectPlan
│   │   ├── approval.ts                approveLines() — the only PO writer
│   │   ├── purchase-orders.ts         list/get/export
│   │   ├── warehouse.ts               layout, heatmap, bin details, candidate bin
│   │   ├── scenarios.ts               list, run, reset
│   │   ├── audit.ts                   writeAudit(), listAudit()
│   │   └── explain.ts                 deterministic explanation text from evidence_json
│   ├── agents/
│   │   ├── tools.ts                   tool definitions (name, description, Zod schema, handler)
│   │   ├── prompts.ts                 system prompt
│   │   └── orchestrator.ts            runAgent(): manual tool loop + fallback
│   ├── scenarios/apply.ts             applies scenario params to the planning context in memory
│   └── warehouse/geometry.ts          bin layout helpers shared by 2D and 3D
├── app/
│   ├── layout.tsx                     ✅ (edit in stage 3: dark theme, fonts, Toaster)
│   ├── globals.css                    ✅ (edit in stage 3: PharmaOS tokens)
│   ├── (dashboard)/
│   │   ├── layout.tsx                 sidebar + top bar
│   │   ├── page.tsx                   Command Center  (/)
│   │   ├── procurement/page.tsx       plan list + Create Purchase Plan
│   │   ├── procurement/[planId]/page.tsx   plan screen (+ ?line= drawer)
│   │   ├── warehouse/page.tsx         3D/2D warehouse (?mode= ?sku= ?bin=)
│   │   ├── purchase-orders/page.tsx   PO list
│   │   ├── purchase-orders/[poId]/page.tsx  PO detail + print/export
│   │   ├── activity/page.tsx          audit log
│   │   └── data/page.tsx              Data & Scenarios + ROI model
│   └── api/                           route handlers (section 8)
├── components/
│   ├── ui/                            ✅ shadcn components (button, card, table, badge, dialog, sheet, input,
│   │                                     select, tabs, tooltip, separator, skeleton, sonner, dropdown-menu,
│   │                                     scroll-area, slider, label, textarea, alert, checkbox)
│   ├── layout/                        Sidebar, TopBar, DataSourceBadge, PageHeader
│   ├── dashboard/                     KpiTile, CriticalSkuList, PendingApprovals
│   ├── procurement/                   PlanTable, ImpactCard, LineDrawer, EditLineDialog, DeferredList,
│   │                                     SupplierComparison, DemandChart, FormulaPanel, AskPanel
│   ├── purchase-orders/               PoTable, PoDocument
│   ├── warehouse3d/                   WarehouseView (client), Scene3D, Grid2D, BinPanel, Legend, ModeSelect
│   ├── audit/                         AuditTable
│   └── scenarios/                     ScenarioCards, RoiModel
└── tests/
    ├── unit/                          engine tests (✅ money.test.ts)
    ├── fixtures/                      hand-computed engine fixtures
    └── integration/                   approval + idempotency against a test DB (optional)
```

---

## 3. Environment and setup

### 3.1 Already done (stage 0)

- [x] `create-next-app` (TypeScript, Tailwind, ESLint, App Router, Turbopack, `@/*` alias).
- [x] Dependencies installed: `@google/genai zod postgres decimal.js three @react-three/fiber @react-three/drei recharts lucide-react clsx tailwind-merge class-variance-authority`; dev: `vitest tsx @types/three @types/node@24 dotenv @faker-js/faker csv-parse`.
- [x] npm install scripts approved for `esbuild` and `unrs-resolver` (needed by tsx/vitest).
- [x] shadcn initialised (`components.json`, `lib/utils.ts`) and 20 components added.
- [x] Folder tree, schema, migration runner, DB client, money helpers, engine config, tool contract, Vitest config, `.env.example`.
- [x] `npm run typecheck`, `npm run lint`, `npm run test`, `npm run build` all pass.

### 3.2 You do once (15 minutes, start of stage 1)

1. Create a Supabase project (free tier). Region: Mumbai (`ap-south-1`) for latency.
2. Project Settings → Database → Connection string → **Transaction pooler** (port 6543). Copy it.
3. `cp .env.example .env.local` and set `DATABASE_URL` (replace `[YOUR-PASSWORD]`).
4. Set `GEMINI_API_KEY` if you have one (from Google AI Studio, aistudio.google.com/apikey; optional until stage 6).
5. `npm run db:migrate` → expect `Applied 001_init.sql` and `Migrations up to date.`
6. Supabase → Table editor: confirm the tables exist and `scenarios` has 5 rows.

Local Postgres alternative: `brew install postgresql@16 && brew services start postgresql@16 && createdb pharmaos`, then `DATABASE_URL=postgres://localhost:5432/pharmaos`.

### 3.3 Command cheat sheet

| Command | What it does |
|---|---|
| `npm run dev` | Dev server at http://localhost:3000 |
| `npm run check` | typegen + typecheck + lint + unit tests |
| `npm run build` | Production build (run before the demo) |
| `npm run db:migrate` | Apply pending migrations |
| `npm run db:reset` | Drop everything, re-migrate (then run `npm run seed`) |
| `npm run seed` | Read `profile.json` + generate synthetic data + inject demo cases + validate + insert |
| `npm run test:watch` | Vitest watch mode while writing the engine |

---

## 4. Data model

The full schema is `db/migrations/001_init.sql`. Key rules:

| Table | Purpose | Rules that matter |
|---|---|---|
| `data_sources` | Reference datasets used to shape synthetic data | One row per `sources.json` entry; shown on Data & Scenarios |
| `products` | SKU master | `sku` unique; exact identity = brand + generic + strength + form + pack; `criticality` and `unit_margin` feed the priority score; `shelf_life_days` feeds the scheme check |
| `suppliers` | Supplier master | Only `approved_status = 'approved'` can be selected; null `reliability_score` / `payment_terms_days` score 0, never 100 |
| `supplier_offers` | Quotes | `price_type = 'supplier_quote'`; per-pack price before GST; `moq` and `pack_multiple` in packs; scheme = `scheme_paid_qty + scheme_free_qty` ("10+1"), both null or both set; stale if `quoted_at` older than 14 days; expired if `valid_until` < as-of |
| `sales_history` | Daily packs sold | One row per product per day; a missing day = 0 sold |
| `inventory_locations` | Bins | Hierarchy warehouse → zone → aisle → rack → shelf → bin; stable `bin_code`; x/y/z for 3D; `capacity_units` is a demo proxy in packs |
| `batches` | Lots | `expiry_date`, `quality_status` (`released` is the only sellable status), `unit_cost` per pack for at-risk value |
| `inventory_balances` | Stock by batch and bin | `location_id` null = unmapped stock; `reserved_qty ≤ on_hand_qty`; unique per batch + location |
| `scenarios`, `app_state` | Demo control | `app_state` is a singleton row: active scenario, default budget, optional as-of date |
| `purchase_plans` | One planning run | `proposed_total ≤ budget_limit` enforced by a DB check; `impact_json` stores the Impact Card |
| `purchase_recommendations` | One line per SKU in a plan | `in_basket` = inside the budget; `status` lifecycle in section 7.4; `evidence_json` holds every input and intermediate value |
| `purchase_orders` | POs | `open` = seeded confirmed incoming PO (counts as incoming stock); `draft` = created by PharmaOS on approval (never counts as incoming); `unique (idempotency_key, supplier_id)` |
| `purchase_order_lines` | PO lines | `recommendation_id` unique → a recommendation can become a PO line only once, ever |
| `approvals` | Decisions | One row per approve / reject / defer |
| `audit_logs` | History | Append-only (a trigger blocks update/delete) |
| `warehouse_movements` | Simulated moves | Only `*_simulated` types |

`data_source` exists on every master and transaction table: `synthetic_demo` for all hackathon rows; `public_reference`, `unverified_sample` and `verified_customer_data` are reserved for later phases. `supplier_offers.price_type` is `supplier_quote` (never MRP or an NPPA ceiling price).

---

## 5. Data plan: reference datasets → synthetic demo data

**Principle.** The datasets the team provides, and the public sources in *PharmaOS — Public Data Sources & Data Acquisition Plan*, are **reference material only**. Scripts read them to learn patterns (distributions, ranges, shapes). No row, brand name, manufacturer name, price or quantity is copied into the app's tables. Every row in the database is `data_source = 'synthetic_demo'`, and every reference used is recorded in the `data_sources` table. The dashboard labels all data "Synthetic demo data".

**Phase-wise.** Data work happens in the phases below, in stage 1 of the build. Nothing is generated before then.

### 5.1 Reference sources and how each may be used

| Id | Source | Provenance label | May inform | Must never be used for |
|---|---|---|---|---|
| `indian_pharmacy_catalogue` | Indian Pharmacy Analytics catalogue (github.com/JohnnyWilson16/indian-pharmacy-analytics), ~254k rows | `public_reference` (check licence and upstream provenance first) | Mix of dosage forms, pack-size label patterns, composition styles, number of manufacturers per category, listed-price ranges per category | Copying brand names, manufacturers or prices; its sales/inventory/supplier tables (they are synthetic too) |
| `nppa_sahi_daam` | NPPA Pharma Sahi Daam (nppaipdms.gov.in) | `public_reference` | Sanity check that generated price ranges are plausible for a category | Supplier purchase prices (a ceiling/retail price is not a quote); bulk scraping |
| `nppa_reports` | NPPA reports (nppa.gov.in/en/reports) | `public_reference` | Context and citations in the pitch | Any SKU-level number |
| `pharma_sales_github` | pharma_sales.csv (github.com/laxmikantpendam/pharma-sales-analytics), ~2k rows | `unverified_sample` | Shape of demand per order, expiry-days-left distribution, share of expired stock | Distributor names, any row presented as real |
| `kaggle_pharma_sales` | Kaggle pharma sales 2014–2019 (milanzdravkovic/pharma-sales-data) | `unverified_sample` (not India, not distributor) | Day-of-week and seasonality shape; testing the demand baseline | Indian demand levels |
| `team_dataset_*` | Datasets the team provides | Labelled per file in `sources.json` | Same as above: aggregate patterns only | Direct loading of rows |

### 5.2 Phases

| Phase | When | Output | Done when |
|---|---|---|---|
| D0 | Done | Schema with provenance (`data_source`, `data_sources`, `price_type`), `data/reference/` folder, this plan | ✅ |
| D1 — Register and profile | Stage 1, hour 0–1 | `data/reference/sources.json` (one entry per file) and `data/reference/profile.json` (aggregates only) | The user has reviewed `profile.json` |
| D2 — Generate | Stage 1, hour 1–3 | Synthetic tables generated from `profile.json` + defaults, demo cases injected, validated, inserted | `npm run seed` passes validation |
| D3 — Customer data | After the hackathon (pilot) | Importer for an anonymised stockist export, labelled `verified_customer_data` | Out of hackathon scope |

### 5.3 D1 — `data/reference/sources.json`

One entry per reference file, mirrored into the `data_sources` table by the seed:

```json
[
  {
    "id": "indian_pharmacy_catalogue",
    "file": "indian_medicine_data.csv",
    "name": "Indian Pharmacy Analytics — medicine catalogue",
    "url": "https://github.com/JohnnyWilson16/indian-pharmacy-analytics",
    "source_type": "public_reference",
    "licence_note": "Check repository licence before redistribution",
    "retrieved_at": "2026-10-21",
    "used_for": "products: dosage-form mix, pack-size patterns, price ranges per category",
    "columns": { "name": "name", "price": "price(₹)", "manufacturer": "manufacturer_name", "type": "type", "pack": "pack_size_label", "composition": "short_composition1" }
  }
]
```
`columns` maps the profile script's field names to the file's actual headers. The headers above are examples; replace them with the real ones when the files arrive.

### 5.4 D1 — `profile-reference.ts` (aggregates only)

Reads each file in `sources.json` with `csv-parse` (`columns: true, trim: true, skip_empty_lines: true, bom: true`), coerces numbers (strip `₹`, commas) and dates, and writes `data/reference/profile.json` containing **only statistics**:

| Profile field | From | Used by the generator for |
|---|---|---|
| `dosageFormShare` (tablet, capsule, syrup, injection…) | catalogue | product forms |
| `packSizePatterns` (e.g. "strip of 10 tablets": share) | catalogue | `pack_size` and display labels |
| `categoryShare` and `priceQuantilesByCategory` (p10, p50, p90 of the **PTR estimate**, see below) | catalogue | product mix and `ptr` ranges |
| `manufacturersPerCategory` (count only) | catalogue | how many fictional manufacturers to create |
| `compositionCountShare` (single vs combination) | catalogue | generic-name combos |
| `dailyDemandQuantiles`, `zeroDayShare` | sales samples | demand profiles |
| `weekdayFactors`, `monthlyFactors` | Kaggle | weekly/seasonal shape |
| `expiryDaysLeftQuantiles`, `expiredShare` | pharma_sales.csv | batch expiry spread |

It must not write any name, ID or individual row. If a file is missing, the profile records `"missing": true` for its fields and the generator uses the defaults in 5.5.

**Two derivations (the catalogue has no category column, and its price is a listed retail price):**

1. **Therapeutic category from composition.** `scripts/seed/catalog.ts` exports `CATEGORY_KEYWORDS`: a case-insensitive keyword map from generic names in `short_composition1` (then `short_composition2`) to the eight plan categories, e.g. amoxycillin/amoxicillin, azithromycin, cefixime, ciprofloxacin → `antibiotic`; paracetamol, diclofenac, ibuprofen, aceclofenac → `analgesic`; metformin, glimepiride, sitagliptin, insulin → `antidiabetic`; amlodipine, telmisartan, atorvastatin, metoprolol → `cardiac`; pantoprazole, rabeprazole, omeprazole, domperidone → `gastro`; montelukast, levocetirizine, ambroxol, salbutamol → `respiratory`; vitamin, folic acid, calcium, zinc → `vitamins`; clotrimazole, mupirocin, clobetasol, ketoconazole → `dermatology`. First match wins (composition1 before composition2, map order as written). No match → `other`. The profile reports the matched share and the `other` share; the generator draws only from the eight plan categories, using `categoryShare` renormalised without `other`.
2. **PTR from listed price.** The catalogue `price(₹)` is a listed retail price (like MRP), not the price to retailer. Before computing quantiles, convert each row: `ptrEstimate = listedPrice × 0.80` (approximate 20% retailer margin; constant `PTR_FROM_LISTED_FACTOR = 0.80` in `catalog.ts`, labelled as an assumption in `profile.json`). Rows with price ≤ 0 or discontinued (`Is_discontinued = TRUE`) are excluded from price statistics. The listed price itself is never stored or used as a purchase price.

### 5.5 D2 — `generate-synthetic.ts`

Use `faker.seed(42)` and `prng.ts` (`mulberry32(42)`) everywhere; never `Math.random()`. The seed number is stored in `app_state.synthetic_seed`.

**No-copy rules:** brand names are built from syllables (`Paracip 650`, `Azitro 500`) and must not equal any brand in the reference catalogue (checked in 5.7); manufacturer and supplier names are fictional (`Nirvaan Pharma`, `Shreeji Distributors`); generic compositions come from a short list of common generic names in `scripts/seed/catalog.ts`; prices are sampled from the profile's quantiles and then perturbed, never taken from a reference row.

| Table | Target size | How rows are generated |
|---|---|---|
| products | 500 SKUs (`PRODUCT_COUNT`) | Forms, pack patterns and category mix from the profile (defaults: tablet, capsule, syrup, injection, ointment, drops; analgesic, antibiotic, antidiabetic, cardiac, gastro, respiratory, vitamins, dermatology); 10% `cool`, 5% `cold_chain`; criticality 10% life_saving, 30% chronic, 45% acute, 15% otc; `ptr` sampled from the category's **PTR-estimate** quantiles (listed price × 0.80, section 5.4; default ₹15–₹900); category assigned from the profile's `categoryShare` (composition keyword map, `other` excluded); `unit_margin` = 8–10% of ptr; `shelf_life_days` 540–1095; GST 5% or 12% |
| suppliers | 8 (`SUP-01`…`SUP-08`) | 6 approved, 1 `pending`, 1 `blocked`; lead time 1–10 days; reliability 60–98; payment terms 15, 21, 30, 45 or 60 days; one approved supplier with null reliability (tests "missing data scores 0") |
| supplier_offers | 1–3 per SKU | `price_type = 'supplier_quote'`; `unit_price` = ptr × 0.78–0.90 (stockist buys below PTR); MOQ ∈ {1, 5, 10, 20}; pack_multiple ∈ {1, 5, 10}; available 50–2,000; lead time = supplier default ± 1 (min 1); freight ₹0–₹1.50 per pack; schemes on ~15% of offers (`10+1`, `20+3`, `5+1`); `quoted_at` = as-of − 1…20 days (≈10% older than 14 days = stale); `valid_until` = `quoted_at` + 7…30 days (≈5% already expired) |
| sales_history | 90 days ending on as-of, every product (zero days included as rows) | Demand **shape** from `dailyDemandQuantiles` (its spread relative to its median), **rescaled** so each SKU's base demand sits at a stockist level: median 4 packs/day, clamped to 0.5–30 packs/day (the sample's absolute level comes from 5 drugs across 5 states and an unknown unit, so it is not used). Weekly shape from `weekdayFactors` (flat if missing). Profile per SKU: 40% stable (Poisson), 20% intermittent (zero-day share from the profile, default 60%), 15% growing (+1%/day), 15% declining (−1%/day), 10% spike (last 5 days × 3) |
| inventory_locations | 240 bins | Aisles A–E; each aisle has a left and right rack row; 6 racks per row; 4 shelves per rack (5 × 2 × 6 × 4 = 240). `bin_code` = `A-L-03-2` (aisle-side-rack-shelf). Coordinates: `x = aisleIndex × 4 + (side === 'L' ? -1 : 1)`, `z = rackIndex × 1.2`, `y = (shelf − 1) × 0.7`. Aisle E = `cold_chain` + `cool`; the rest `ambient`. Capacity 250–1,000 packs (demo proxy, sized so 500 SKUs fit at ~70% fill). 4 bins `inactive` |
| batches | 1–3 per SKU | `batch_number` = `B` + 6 chars; `received_date` 10–300 days before as-of; `expiry_date`: a **short-dated share** = the profile's share of `expiryDaysLeftQuantiles` below the 90-day risk window, capped at 15% (default 10%), gets 60–150 days after as-of; all other batches get 151–900 days (the sample's 23–358-day range is too short to use directly); `unit_cost` = offer price ± 3%; quality: 3 `quarantine`, 1 `recalled`, 2 already expired, rest `released`; return policy 40% returnable, 30% non-returnable, 30% unknown |
| inventory_balances | Each batch in 1–2 bins of a matching storage class (ambient → aisles A–D, cool → E right, cold_chain → E left; never an inactive bin) | `on_hand_qty` sized so days of cover spreads from 0 to 90 days, capped so no bin exceeds `capacity_units`; `reserved_qty` 0–10% of on hand; 3 balances with `location_id = null` (unmapped) |
| purchase_orders + lines | 15 `open`, 1 `received`, 1 `cancelled` | `open` POs have `expected_delivery_date` = as-of + 1…20 days (some beyond the 14-day horizon, to test exclusion); `po_number` = `EXT-0001`… |

### 5.6 `inject-demo-cases.ts` — guaranteed cases

After generation, adjust specific SKUs so these counts hold exactly, and record which SKUs are which in `data/synthetic/demo-cases.json` (used by the demo script and tests):

| Case | Count | How it is forced |
|---|---|---|
| Stockout risk (cover < fastest eligible lead time) | ≥ 10 | Reduce on-hand of fast movers |
| Expiry-risk batches (projected unsold before risk window) | ≥ 8 | Move expiry to as-of + 95…150 days on slow movers with large qty |
| Excess stock (position > 1.5 × target) | ≥ 5 | Increase on-hand of slow movers |
| Supplier price anomaly (offer > 1.2 × median of other offers) | 3 | Inflate one offer price |
| Capacity warning (no bin can take the proposed qty) | 2 | Fill all matching bins of a storage class |
| Cheapest supplier too slow (cheapest lead time > cover) | 3 | Cheapest offer gets lead time 9–10 days on stockout SKUs |
| Scheme that should be skipped (slow mover with `20+3`) | 2 | Add a scheme to a slow mover whose extra qty would expire |
| Stale quote on an otherwise best offer | 2 | `quoted_at` = as-of − 20 days |
| Unmapped stock | 3 | `location_id = null` |
| Demand spike flag | ≥ 2 | Spike profile |

### 5.7 `validate.ts` — fail loudly

The seed aborts (non-zero exit) if any check fails:
- every FK resolves; every SKU has ≥ 1 offer from an approved supplier (except 1 deliberate "no eligible offer" SKU);
- no balance has `reserved_qty > on_hand_qty`; no bin exceeds capacity except the 2 capacity cases;
- every sales row is ≤ as-of date and ≥ 0;
- the counts in 5.6 hold;
- default plan at ₹2,00,000 has at least 15 candidate lines and its candidates' total exceeds ₹2,00,000 (so the budget binds), while the ₹1,00,000 scenario still fits ≥ 5 lines;
- **no-copy checks:** every row has `data_source = 'synthetic_demo'`; no generated `brand_name`, manufacturer or supplier name equals a name in any reference file (case-insensitive); every `supplier_offers.price_type` is `supplier_quote`; `data_sources` has one row per entry in `sources.json`.

### 5.8 `write.ts` and `index.ts`

`npm run seed` = truncate all data tables (keep `scenarios`, reset `app_state`) → read `profile.json` (missing → defaults + a warning) → generate → inject → validate → insert in FK order (data_sources, suppliers, products, offers, sales, locations, batches, balances, POs, lines) using `sql.begin()` and batched inserts (`sql\`insert into t ${sql(rows)}\``, 1,000 rows per batch) → set `app_state.synthetic_seed` and `seeded_at` → write CSV snapshots to `data/synthetic/` → print a summary (rows per table) → audit `seed.completed`.

---

## 6. Decision engine (`lib/business-logic/`)

Pure TypeScript. Inputs are plain objects (strings for money). No DB access. Every function has unit tests with hand-computed fixtures (section 14). Keep fractional values (Decimal) through intermediate steps; round only where stated.

### 6.1 Dates (`dates.ts`)

All dates are `YYYY-MM-DD` strings treated as UTC calendar dates. `daysBetween(a, b)` = whole days from a to b (`Date.UTC` arithmetic; never local-time getters). `addDays(date, n)`.

### 6.2 Demand baseline (`demand.ts`)

```
d7  = (sum of units sold on days (asOf − 6) … asOf) / 7          missing day = 0
d28 = (sum of units sold on days (asOf − 27) … asOf) / 28
avgDailyDemand d̄ = 0.6 × d7 + 0.4 × d28
```

Flags (returned as warnings):
- `NO_DEMAND`: d̄ = 0 → no order, cover shows "No reliable demand estimate".
- `LOW_HISTORY`: first sale date is fewer than 28 days before as-of.
- `DEMAND_SPIKE`: d28 > 0 and d7 / d28 ≥ 2.

Return `{ d7, d28, avgDailyDemand, windowDays: { short: 7, long: 28 }, flags, dailySeries }` (`dailySeries` = last 28 days for the chart).

### 6.3 Expiry and eligible stock (`expiry.ts`)

Per SKU, take balances whose batch is `released` and not expired (`expiry_date > asOf`). Ineligible stock (quarantine, rejected, recalled, expired) is listed separately and never counted.

For each eligible batch: `available = on_hand − reserved` (summed over its bins). Sell-by date = `expiry_date − 90 days` (risk window). `sellableDays = max(0, daysBetween(asOf, sellBy))`.

FEFO projection (batches sorted by expiry ascending, then batch_number):
```
consumed = 0
for each batch in FEFO order:
    capacity       = max(0, d̄ × sellableDays − consumed)
    projectedSold  = min(available, capacity)
    atRiskQty      = available − projectedSold
    atRiskValue    = atRiskQty × unit_cost            (roundMoney)
    consumed      += projectedSold
eligibleAvailable = Σ projectedSold
```
A batch is **at risk** if `atRiskQty > 0`. If d̄ = 0 every eligible batch is fully at risk (flag `NO_DEMAND`).

Return per batch: `{ batchId, batchNumber, expiryDate, daysToExpiry, sellableDays, available, projectedSold, atRiskQty, atRiskValue, returnPolicy }` plus totals and the ineligible list.

### 6.4 Stock position, cover, ROP, target, status (`inventory.ts`)

```
confirmedIncoming = Σ quantity_packs (+ free_qty) of lines on POs with status 'open'
                    and expected_delivery_date ≤ asOf + 14 days
stockPosition     = eligibleAvailable + confirmedIncoming
```
(Reserved stock is subtracted once, inside `available`. Draft POs created by PharmaOS are never incoming.)

For a given lead time L (days) and review period R = 7:
```
cover   = stockPosition / d̄                         only if d̄ > 0
safety  = max(2, d̄ × 3)
ROP     = d̄ × L + safety
target  = d̄ × (L + R) + safety
```
Status per SKU, using L = lead time of the fastest eligible offer (or the supplier default if no offer):
| Status | Condition (first match wins) |
|---|---|
| `NO_DEMAND` | d̄ = 0 |
| `STOCKOUT_RISK` | cover < L |
| `BELOW_ROP` | stockPosition < ROP |
| `EXCESS` | stockPosition > 1.5 × target |
| `HEALTHY` | otherwise |

### 6.5 Order quantity, rounding and schemes (`ordering.ts`)

A SKU becomes a **candidate line** only if d̄ > 0 and `stockPosition < ROP(L_fastest)`, where `L_fastest` is the lead time of the fastest eligible offer (if even the fastest supplier does not need an order yet, the SKU can wait for the next review). Quantities are then computed **per offer** with that offer's own L, MOQ and pack multiple:

```
qRaw = max(0, target(L_offer) − stockPosition)
if the SKU has at-risk batches: qRaw = max(0, ROP(L_offer) − stockPosition)   reason EXPIRY_REDUCED_QTY
q    = ceil(qRaw / pack_multiple) × pack_multiple
q    = max(q, moq)                                                       only when qRaw > 0
```

Scheme decision (offer has `scheme_paid_qty = P`, `scheme_free_qty = F`):
```
qScheme   = max(q, ceil(P / pack_multiple) × pack_multiple)
free      = floor(qScheme / P) × F
received  = qScheme + free
daysToSell = (stockPosition + received) / d̄
take scheme if daysToSell < shelf_life_days − 90            reason SCHEME_TAKEN, use qScheme and free
else if q ≥ P (free goods arrive anyway):                   keep q, free = floor(q / P) × F, warning SCHEME_EXCESS_RISK
else:                                                        keep q, free = 0, reason SCHEME_SKIPPED_EXPIRY
```
`expiryAvoidedValue` for `SCHEME_SKIPPED_EXPIRY` = `(qScheme − q) × effective unit cost` (the stock not bought).

### 6.6 Supplier eligibility, effective cost and score (`supplier-scoring.ts`)

**Hard filter** — an offer is ineligible, with a code, if any of:
`SUPPLIER_NOT_APPROVED` · `QUOTE_EXPIRED` (`valid_until < asOf`) · `QUOTE_STALE` (`quoted_at` older than 14 days) · `MISSING_PRICE` · `OFFER_INACTIVE` · `PRODUCT_MISMATCH` (offer product ≠ SKU) · `INSUFFICIENT_AVAILABILITY` (`available_qty < q` for this offer) · `INVALID_PACK_RULES` (`moq` or `pack_multiple` ≤ 0).
Excluded offers are returned with their code so the detail drawer can show "why not".

**Effective landed cost per received pack:**
```
grossPerPack   = unit_price × (1 + tax_rate / 100)
paidShare      = scheme taken ? P / (P + F) : 1
effectiveCost  = grossPerPack × paidShare + freight_per_pack          (roundUnit)
```

**Urgency rule:** if at least one eligible offer has `lead_time_days ≤ cover`, drop offers with `lead_time_days > cover` (reason on the dropped offer: `TOO_SLOW_FOR_COVER`; if the dropped one was the cheapest, add `CHEAPER_OFFER_TOO_SLOW` to the line). If no offer is fast enough, keep only the fastest offer(s) and add `STOCKOUT_BEFORE_DELIVERY`.

**Score** (factors 0–100, computed across the remaining offers for the SKU):
```
C_cost        = 100 × (maxCost − cost) / (maxCost − minCost)        all equal → 100
C_lead        = 100 × (maxLead − lead) / (maxLead − minLead)        all equal → 100
C_reliability = supplier.reliability_score                           null → 0
C_terms       = 100 × min(payment_terms_days, 45) / 45               null → 0
score         = 0.45 C_cost + 0.25 C_lead + 0.20 C_reliability + 0.10 C_terms
```
Highest score wins; ties → lower effective cost, then shorter lead time, then supplier_code. Return every offer with its factor values and score.

**Price anomaly** warning `PRICE_ANOMALY` when an offer's unit price > 1.2 × median unit price of the SKU's other offers.

Note on order: q depends on the offer (its L, MOQ, pack multiple), so `analyseSku` computes q **per offer**, filters, scores, and the winner's q becomes the line.

### 6.7 Totals (`totals.ts`)

One function, used for recommendations, edits, approval and PO lines:
```
lineSubtotal = roundMoney(q × unit_price)
lineTax      = roundMoney(lineSubtotal × tax_rate / 100)
lineFreight  = roundMoney(q × freight_per_pack)
lineTotal    = lineSubtotal + lineTax + lineFreight
planTotal    = Σ lineTotal of lines with in_basket = true and status in ('proposed','edited','approved_for_po')
budgetRemaining = budgetLimit − planTotal                 never negative (basket guarantees it)
```
Free goods are a separate quantity at ₹0; percentage-discount schemes are not modelled (state this in the UI assumptions).

### 6.8 Priority: loss prevented per rupee (`priority.ts`)

```
shortfallDays  = max(0, L − cover)
lossPrevented  = shortfallDays × d̄ × unit_margin × w_crit       w_crit: life_saving 2, chronic 1.5, acute 1, otc 0.7
priority       = lossPrevented / lineTotal                       lineTotal > 0
```
Sort key (deterministic): priority desc → cover asc → w_crit desc → sku asc. Lines with priority 0 (below ROP but not urgent) therefore follow urgent lines in order of lowest cover.

### 6.9 Budget basket (`basket.ts`)

```
remaining = budget
pass 1: for each candidate in sort order:
          if lineTotal ≤ remaining: in_basket = true; remaining −= lineTotal
          else: in_basket = false; reason BUDGET_DEFERRED
pass 2: for each deferred line with priority > 0, in sort order:
          a) try the next-best eligible offer whose lineTotal ≤ remaining     reason ALT_OFFER_FOR_BUDGET
          b) else the largest q' = k × pack_multiple with q' ≥ moq and lineTotal(q') ≤ remaining
             reason PARTIAL_QTY_BUDGET
          if either fits: in_basket = true; remaining −= lineTotal
```
Guarantee (tested): Σ in-basket lineTotal ≤ budget. Documented as a heuristic, not an optimum.

### 6.10 Plan Impact Card (`impact.ts`)

| Field | Definition |
|---|---|
| `skusAtRisk` | count of SKUs with status `STOCKOUT_RISK` (whole catalogue) |
| `stockoutsCovered` | in-basket lines whose SKU status is `STOCKOUT_RISK` |
| `marginProtected` | Σ lossPrevented of in-basket lines |
| `expiryExposure` | Σ atRiskValue of all batches (current stock) |
| `expiryAvoided` | Σ expiryAvoidedValue of lines with `SCHEME_SKIPPED_EXPIRY` or `EXPIRY_REDUCED_QTY` (for the latter: `(qFull − qReduced) × effectiveCost`) |
| `cashCommitted` | planTotal |
| `budgetRemaining` | budget − planTotal |
| `deferredCount`, `deferredRisk` | count and Σ lossPrevented of deferred lines |
| `lossPreventedPerRupee` | (marginProtected + expiryAvoided) / planTotal; null when planTotal = 0 |

### 6.11 Validation (`validation.ts`)

**Hard stops** (approval of a line is refused; plan approval refused if any selected line has one):
`INVALID_SKU` · `SUPPLIER_NOT_APPROVED` · `QUOTE_EXPIRED` · `QUOTE_STALE` · `MISSING_PRICE` · `INVALID_PACK_MULTIPLE` (q % pack_multiple ≠ 0) · `BELOW_MOQ` · `ABOVE_AVAILABILITY` · `NON_POSITIVE_QTY` · `OVER_BUDGET` · `INVALID_BUDGET` (≤ 0) · `PRODUCT_RECALLED` (any batch of the SKU is `recalled` → human review).

**Soft warnings** (allowed; overriding them requires a note): `AT_RISK_BATCHES` · `NOT_TOP_SUPPLIER` · `LOW_HISTORY` · `DEMAND_SPIKE` · `SCHEME_EXCESS_RISK` · `PRICE_ANOMALY` · `CAPACITY_REVIEW`.

### 6.12 `engine.ts`

- `analyseSku(input, config) → SkuAnalysis` — demand, expiry, stock position, every offer evaluated (eligibility, q, effective cost, factors, score), chosen offer, line totals, priority, reasons, warnings, status, and `evidence` (all inputs and intermediates, ready for `evidence_json`).
- `buildPlan(context, budget, config) → PlanResult` — runs `analyseSku` for every active SKU, keeps candidates, sorts, runs the basket, computes impact, assigns `rank` (1 = top).
- Pure and deterministic: same input → byte-identical output (tested).

### 6.13 Heatmap and put-away (`heatmap.ts`, `putaway.ts`)

Per bin, from the SKUs and batches it holds:
| Mode | Bin is highlighted when | Value shown |
|---|---|---|
| `stockout` | any SKU in the bin has status `STOCKOUT_RISK` | lowest cover (days) |
| `expiry` | any batch in the bin has `atRiskQty > 0` or is expired | earliest expiry, at-risk qty |
| `excess` | any SKU in the bin has status `EXCESS` | stock ÷ target |
| `normal` | — | fill % = on hand ÷ capacity |
| `proposed` | bin is the candidate put-away bin of an in-basket line | proposed packs (paid + free) |

Each bin also gets a severity 0–3 so the legend and colour never carry meaning alone (text label in the panel).

Candidate bin (deterministic): active bins with matching `storage_class` and `capacity_units − Σ on_hand ≥ proposed packs`; prefer (1) a bin already holding the SKU, (2) the same aisle as existing stock, (3) lowest `bin_code`. None fits → `CAPACITY_REVIEW`, no location invented.

---

## 7. Services (`lib/services/`)

### 7.1 `loadPlanningContext(sql, asOf, scenarioId)`

One function that reads, with a fixed set of queries, everything the engine needs: active products, approved/pending/blocked suppliers, active offers, the last 28 days of sales (plus first-sale date per SKU), released and non-released batches with balances, open POs within the horizon. Then `applyScenario(context, scenario)` (section 12) modifies it **in memory**. Returns plain objects (money as strings).

### 7.2 `createPlan(budget)`

1. Validate budget > 0.
2. `asOf = resolveAsOfDate()`; scenario = `app_state.active_scenario_id`.
3. `result = buildPlan(context, budget)`.
4. In one transaction: insert `purchase_plans` (totals, `assumptions_json` = ENGINE_CONFIG + asOf + scenario, `impact_json`), insert all recommendation rows, write audit `plan.created`.
5. Return the plan id. Target: < 3 s for 500 SKUs.

### 7.3 `editLine(planId, lineId, change, { preview })`

`change` = one of: `{ qty }`, `{ offerId }`, `{ status: 'deferred' | 'rejected', reason }`, `{ status: 'proposed' }` (restore), `{ note }`.
1. Load plan + line; refuse if plan `rejected`/`approved` or line `approved_for_po` (409 `LINE_LOCKED`).
2. Rebuild that SKU's analysis from fresh context; apply the change; validate (qty multiple of pack_multiple, ≥ MOQ, ≤ available; offer must be eligible for the same product).
3. Recompute line totals and plan total. If the new plan total > budget → 409 `OVER_BUDGET` with `{ overBy }` (no silent overspend).
4. `preview: true` → return before/after without saving (used to show the new total before saving).
5. Else save (status → `edited`, or the requested status), update plan totals + impact, audit `line.edited` / `line.deferred` / `line.rejected` with before/after.

### 7.4 Status lifecycles

- Recommendation: `proposed → edited → approved_for_po`; `proposed|edited → deferred | rejected`; `deferred|rejected → proposed` (restore).
- Plan: `draft → partially_approved → approved`; `draft|partially_approved → rejected`. Rejected creates no POs.
- PO: `draft → approved_draft → exported` (exported only when the CSV/print file is actually generated). Seeded external POs: `open | received | cancelled`.

### 7.5 `recalculatePlan(planId, { budget? })`

Rebuild the basket for the same plan with fresh context and the active scenario. Lines `approved_for_po` are frozen and their totals count first; `rejected` lines stay rejected; `edited` lines keep the user's qty/offer and are placed first if they fit (else `deferred` with `OVER_BUDGET`); all other lines are recomputed. Audit `plan.recalculated` with before/after totals and the list of lines that changed basket membership.

### 7.6 `approveLines(planId, lineIds, idempotencyKey, userId)` — the only PO writer

In **one transaction**:
1. `select … from purchase_plans where id = $1 for update`.
2. If any `purchase_orders` row has this `idempotency_key` → return those POs with `alreadyProcessed: true` (no new rows).
3. Load the selected lines; each must be `in_basket`, status `proposed` or `edited`, not already linked to a PO line.
4. Re-run the SKU analysis and **all hard stops** with fresh data; any failure → abort with 422 and the list of `{ lineId, codes[] }`.
5. Group lines by supplier. For each supplier insert a `purchase_orders` row: `po_number = 'PO-' || to_char(now(),'YYYYMMDD') || '-' || nextval('po_number_seq')`, status `draft`, totals = Σ line amounts (same totals function), `expected_delivery_date = asOf + max lead time of its lines`, `source_plan_id`, `idempotency_key`, `approved_by`, `approved_at`.
6. Insert PO lines (copy qty, free qty, price, tax, amounts, `recommendation_id`).
7. Update recommendations → `approved_for_po`; insert `approvals`; update plan status; audit `po.draft_created` per PO and `plan.lines_approved`.
8. Return the POs. A second identical request returns the same POs (unique constraints are the final guard).

### 7.7 Other services

- `rejectPlan(planId, reason)`: status `rejected`, `reject_reason`, approval row, audit. No POs.
- `dashboard.getCommandCenter()`: budget (app_state default), latest plan's proposed spend, count `STOCKOUT_RISK`, Σ expiry exposure, pending approvals (in-basket lines not yet approved on non-rejected plans), top 8 critical SKUs.
- `purchase-orders.exportPo(poId)`: builds CSV, sets status `exported`, audit. Print view uses the same data.
- `explain.explainLine(evidence)`: deterministic sentences, e.g. *"Ordering 90 packs from SUP-03 because stock covers 4.3 days and SUP-03 delivers in 2 days. SUP-01 is 6% cheaper but takes 7 days, which is after the projected stockout."*

---

## 8. API (route handlers)

All bodies validated with Zod (`lib/validation/api.ts`). Errors return `{ error: { code, message, details? } }` with the status below. Success returns JSON.

| Method & path | Body / query | Success | Errors |
|---|---|---|---|
| `GET /api/dashboard` | — | Command Center metrics | 500 |
| `POST /api/procurement/analyze` | `{ budget: number>0, priorities?: string }` | `{ planId }` (201) | 400 `INVALID_BUDGET` |
| `GET /api/purchase-plans/[id]` | — | plan + lines + impact | 404 |
| `PATCH /api/purchase-plans/[id]/lines/[lineId]` | `{ qty? , offerId?, status?, reason?, note?, preview?: boolean }` (exactly one change) | `{ before, after, plan }` | 400 validation codes, 409 `LINE_LOCKED` / `OVER_BUDGET`, 404 |
| `POST /api/purchase-plans/[id]/recalculate` | `{ budget?: number>0 }` | plan | 400, 404, 409 plan locked |
| `POST /api/purchase-plans/[id]/approve` | `{ lineIds: uuid[] (≥1), idempotencyKey: uuid }` | `{ purchaseOrders, alreadyProcessed }` | 422 hard stops, 409 locked |
| `POST /api/purchase-plans/[id]/reject` | `{ reason: string (≥3) }` | plan | 409 |
| `POST /api/purchase-plans/[id]/lines/[lineId]/explain` | — | `{ text, source: 'agent' | 'deterministic' }` | 404 |
| `GET /api/purchase-orders` / `GET /api/purchase-orders/[id]` | — | POs / PO with lines | 404 |
| `POST /api/purchase-orders/[id]/export` | — | `text/csv` download | 404 |
| `GET /api/warehouse/layout` | — | bins with geometry | — |
| `GET /api/warehouse/heatmap?mode=` | `mode ∈ stockout|expiry|excess|normal|proposed`, `planId?` | `{ bins: [{ binId, severity, label, value }] }` | 400 |
| `GET /api/warehouse/bins/[id]` | — | bin + balances + batches + SKU status | 404 |
| `GET /api/products/search?q=` | `q` ≥ 2 chars | up to 20 SKUs with their bins | 400 |
| `GET /api/scenarios` · `POST /api/scenarios/[id]/run` · `POST /api/scenarios/reset` | — | active scenario | 404 |
| `POST /api/agent/chat` | `{ message: string (1–2000), planId?: uuid }` | `{ reply, toolCalls: [{ name, ok }], references: [{ type, id, label }], source }` | 503 never — falls back |
| `GET /api/audit?limit=&before=` | pagination | audit rows | — |

UI reads go through server components calling services directly; UI mutations call these routes then `router.refresh()`.

---

## 9. AI orchestrator (`lib/agents/`)

### 9.1 Where the AI shows up (dashboard, not chatbot)

1. **Create Purchase Plan** — the plan is built deterministically; if the key is set, the agent then writes a 3–5 sentence plan summary from the plan's tool output (stored in `assumptions_json.summary`).
2. **Why?** on each line → `/explain` → agent explanation grounded in that line's evidence; deterministic text if the LLM fails.
3. **Ask PharmaOS** side panel on the plan screen: requests such as "reduce the budget to ₹1,00,000 and tell me what was deferred", "why Supplier B instead of A for Paracip 650?", "show where this SKU is stored".

### 9.2 Tools exposed to the model

All tools return the `ToolResult` contract (`lib/validation/tool-contract.ts`). Input schemas in Zod, converted to JSON Schema with `z.toJSONSchema()` and passed to Gemini as `parametersJsonSchema` on each `FunctionDeclaration`. Validate every `functionCall.args` with Zod again before running the handler.

| Tool | Input | Returns |
|---|---|---|
| `search_products` | `{ query }` | matching SKUs (exact identity fields) — the model must use this to resolve names; ambiguous → ask the user |
| `get_sales_history` | `{ sku, days ≤ 90 }` | daily series |
| `get_inventory_position` | `{ sku }` | eligible available, reserved, incoming, stock position, status |
| `forecast_demand` | `{ sku }` | d7, d28, d̄, flags |
| `calculate_reorder_qty` | `{ sku }` | ROP, target, qRaw, q, rounding steps |
| `get_batches` | `{ sku }` | batches with FEFO projection |
| `calculate_expiry_exposure` | `{ sku? }` | at-risk batches and value (one SKU or top 20) |
| `get_return_policy` | `{ sku }` | return policy per batch |
| `get_supplier_offers` | `{ sku }` | offers incl. excluded ones with codes |
| `compare_supplier_offers` | `{ sku }` | factors and scores, winner, reasons |
| `get_price_history` | `{ sku }` | past offer prices and batch costs |
| `get_budget` | `{ planId? }` | budget, plan total, remaining |
| `get_plan` | `{ planId }` | lines (rank, sku, qty, supplier, total, status, reasons) + impact |
| `build_purchase_basket` | `{ budget }` | **preview only** (not saved) of a plan at that budget |
| `recalculate_plan` | `{ planId, budget }` | runs `recalculatePlan` (a saved, audited change, actor `agent`) |
| `validate_po` | `{ planId, lineIds }` | hard stops / warnings per line (no writes) |
| `get_bin_details` | `{ binCode }` | bin contents |
| `get_heatmap_metrics` | `{ mode }` | top 20 highlighted bins |
| `suggest_candidate_bin` | `{ sku, packs }` | candidate bin or `CAPACITY_REVIEW` |

Not exposed, by design: approve, reject, create/update PO, any SQL. `create_draft_po` / `update_po_draft` from the v1 spec exist only as service functions called by the approve endpoint after a human click.

### 9.3 System prompt (`prompts.ts`)

```
You are PharmaOS, a procurement assistant for an Indian pharmaceutical stockist.
You help the purchase manager understand and adjust today's purchase plan.

Rules:
- Every number you state must come from a tool result in this conversation. Never calculate,
  estimate or invent prices, quantities, totals, scores or dates. If a number is not in a tool
  result, call a tool or say you do not have it.
- Use search_products to resolve product names. If more than one product matches, list them and
  ask which one; never assume a strength, form or pack size.
- You cannot approve, reject or send purchase orders. If asked, explain that the user approves
  lines with the Approve button, and that nothing is sent to suppliers in this demo.
- Never suggest substituting one medicine for another. Quality, recall and safety questions go
  to a human reviewer.
- When a tool fails, say what information is missing.
- Write for a busy business owner: short sentences, rupees as ₹ with Indian digit grouping as
  returned by the tools, mention SKU names and supplier codes.
- All data is synthetic demo data shaped by public reference datasets; say so if asked whether it is live or real.
```
Pass it as `config.systemInstruction`. Keep the text stable across requests; put the plan id / as-of date in the user message, not in the system prompt.

### 9.4 Loop (`orchestrator.ts`) — Gemini via `@google/genai`

```ts
import { GoogleGenAI, ApiError, FinishReason, FunctionCallingConfigMode,
         type Content, type FunctionDeclaration, type Part } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });   // server only
const MODEL = process.env.GEMINI_MODEL ?? "gemini-flash-latest";

// contents: Content[] — start with [{ role: "user", parts: [{ text: userMessage + "\n\nContext: planId=…, asOf=…" }] }]
for (let turn = 0; turn < 8; turn++) {
  const response = await ai.models.generateContent({
    model: MODEL,
    contents,
    config: {
      systemInstruction: SYSTEM_PROMPT,
      tools: [{ functionDeclarations: FUNCTION_DECLARATIONS }],      // FunctionDeclaration[] (parametersJsonSchema)
      toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.AUTO } },
      automaticFunctionCalling: { disable: true },                   // WE run tools: allow-list + Zod
      maxOutputTokens: 8192,
      httpOptions: { timeout: 15000 },                               // ms
    },
  });
  const candidate = response.candidates?.[0];
  const finish = candidate?.finishReason;
  if (!candidate?.content || (finish && finish !== FinishReason.STOP)) → fallback
      // MAX_TOKENS, SAFETY, PROHIBITED_CONTENT, MALFORMED_FUNCTION_CALL, UNEXPECTED_TOOL_CALL, TOO_MANY_TOOL_CALLS, …
  const calls = response.functionCalls ?? [];
  if (calls.length === 0) → return response.text ?? fallback
  contents.push(candidate.content);              // append the model turn EXACTLY as returned (keeps thoughtSignature parts)
  const parts: Part[] = [];
  for (const call of calls) {
    // look up call.name in the allow-list; validate call.args with the tool's Zod schema;
    // unknown tool or invalid args → result = toolError("INVALID_TOOL_INPUT", …)
    parts.push({ functionResponse: { id: call.id, name: call.name, response: result } });  // result = ToolResult
  }
  contents.push({ role: "user", parts });        // ALL function responses in ONE user turn, same order as the calls
}
→ after 8 turns: fallback
```
Notes:
- Tool declarations: `{ name, description, parametersJsonSchema: z.toJSONSchema(schema) }`. Keep schemas simple (object, string, number, integer, boolean, enum, array; no `oneOf`/recursion) so Gemini accepts them. Zod re-validates every `call.args` before the handler runs, because the model's arguments are untrusted.
- **Automatic function calling is disabled** so no tool ever runs outside our allow-list and validation.
- **Never rebuild the model turn** from `response.text` / `functionCalls`: push `candidate.content` unchanged, or Gemini loses its thought signatures and multi-step tool use degrades.
- Do not set `toolConfig` mode `ANY` (forces a call every turn) and do not hard-code `thinkingConfig`; model defaults are fine. Pin `GEMINI_MODEL` to a specific model name on demo day if `gemini-flash-latest` changes behaviour.
- Errors: catch `ApiError` (has `status`: 429 rate limit, 5xx) and network/timeout errors. Any failure, missing `GEMINI_API_KEY`, a non-`STOP` finish reason or a timeout → deterministic fallback (`explain.ts`) with `source: 'deterministic'`. The UI shows a small "AI unavailable — showing calculated explanation" note.
- Log each tool call (name, ok, ms) to `audit_logs` with actor `agent` only for mutating tools (`recalculate_plan`); read-only calls go to the response's `toolCalls` list for display.
- Exact type names come from `node_modules/@google/genai/dist/genai.d.ts` (installed version 2.30.0); check there rather than guessing.

---

## 10. UI

PharmaOS is a web dashboard: a left sidebar, a top bar and data-dense screens (tables, cards, a 3D panel) laid out for desktop browsers. Build every screen for 1280 px and wider first, and make sure it still works at tablet width (≥ 768 px: the sidebar collapses to icons, wide tables scroll horizontally inside their card). Phone layouts are out of scope.

### 10.1 Design system

- Dark by default: `<html className="dark">`. Palette as CSS variables in `app/globals.css` (map to shadcn tokens):

| Token | Value | Use |
|---|---|---|
| background | `#0B1220` | page |
| card | `#111A2E` | panels, tables |
| border | `#1F2A44` | dividers |
| primary (teal) | `#14B8A6` | primary buttons, focus, selected |
| stockout | `#EF4444` | stockout risk |
| expiry | `#F59E0B` | expiry risk |
| excess | `#8B5CF6` | excess stock |
| healthy | `#64748B` | normal |
| proposed | `#22D3EE` at 35% opacity | ghost / proposed stock |

- Font: Geist (already loaded). Numbers in tables: `tabular-nums`, right-aligned, INR via `formatINR()`.
- Every status uses colour **plus** a text badge. Every screen has loading (Skeleton), empty, stale-data and error states. No inert buttons.

### 10.2 Shell (`app/(dashboard)/layout.tsx`)

- Left sidebar (lucide icons): Command Center `/`, Procurement `/procurement`, 3D Warehouse `/warehouse`, Purchase Orders `/purchase-orders`, Activity Log `/activity`, Data & Scenarios `/data`.
- Top bar: "PharmaOS" wordmark, `DataSourceBadge` ("Synthetic demo data"), active scenario chip (if not baseline), default budget, as-of date, demo user.
- `<Toaster />` (sonner) in the root layout.

### 10.3 Screens

**Command Center (`/`)**
- KPI tiles: Available budget · Proposed spend (latest plan) · SKUs at stockout risk · ₹ expiry exposure · Pending approvals.
- Critical SKUs list (top 8 by status/cover): SKU, cover days, lead time, status badge, "Open in plan" / "Locate" links.
- Primary CTA **Create Purchase Plan** → dialog (budget input prefilled ₹2,00,000, optional priority text) → `POST /api/procurement/analyze` → navigate to the plan.

**Procurement list (`/procurement`)**: table of plans (created, budget, total, status, scenario) + Create button.

**Procurement Plan (`/procurement/[planId]`)**
- Top: **Plan Impact Card** (section 6.10 fields, large numbers, one line of explanation each) + budget bar (committed vs remaining).
- Plan table (sorted by rank): checkbox, rank, SKU (brand, strength, pack), status badge, cover (days), qty (+ free), supplier code, effective cost/pack, lead time, line total, flags (icons with tooltips), reason (short), actions (Why?, Edit, Defer, Reject).
- Deferred lines section below with reason and ₹ risk; "Restore" action.
- Footer bar: selected count and total → **Approve selected** (generates a fresh `idempotencyKey` with `crypto.randomUUID()` when the dialog opens; button disabled while the request runs) → confirmation dialog listing POs per supplier → success toast with links.
- **Reject plan** (reason required).
- **Recalculate** with a budget input.
- **Ask PharmaOS** side panel (Sheet): message box, replies with references rendered as links.
- Line drawer (`?line=<id>`, Sheet): product identity; demand chart (28 days, Recharts) with d7/d28/d̄; stock breakdown (available, reserved, incoming, ineligible); cover, ROP, target; batches table with FEFO projection; supplier comparison table (all offers incl. excluded with reason codes, factor scores, winner highlighted); formulas with the actual values substituted; quote timestamps; data-source labels; Edit controls (qty stepper by pack multiple, offer select) with live **preview** (PATCH `preview: true`) before Save; "Locate in warehouse" → `/warehouse?sku=<sku>`.

**3D Warehouse (`/warehouse`)** — section 11.

**Purchase Orders (`/purchase-orders`, `/purchase-orders/[poId]`)**: list (PO number, supplier, lines, grand total, status, source plan, created); detail = printable PO document (supplier, SKU, manufacturer, pack, qty, free qty, price, GST, freight, totals, expected delivery, approver, "DRAFT — not sent to supplier" watermark), **Export CSV**, **Print** (`window.print()` with print CSS).

**Activity & Audit (`/activity`)**: table (time, actor type/id, action, entity, before → after summary, reason), filter by action/entity, "Load more".

**Data & Scenarios (`/data`)**: data summary (rows per table, as-of date, seed) and the **Data sources** list from `data_sources` (name, link, label, what it informed); scenario cards (5) with Run / Reset; default budget input; **ROI model** (section 11 of `problemstatement.md`) with sliders for each assumption and live totals, labelled "Illustrative model — edit the assumptions".

---

## 11. Warehouse view (`components/warehouse3d/`)

- `WarehouseView` (client component): fetches `/api/warehouse/layout` once and `/api/warehouse/heatmap?mode=` on mode change; holds `selectedBinId`, `mode`, `search`.
- Loads `Scene3D` with `next/dynamic(() => import("./Scene3D"), { ssr: false })`. If WebGL is unavailable (`document.createElement('canvas').getContext('webgl2')` is null) or the scene throws (error boundary), render `Grid2D` instead. A toggle lets the user switch to 2D anytime; a table view is available for accessibility.
- `Scene3D`: `<Canvas camera={{ position: [24, 18, 24], fov: 45 }}>`, floor plane, aisle labels, racks as thin frames, bins as **one `InstancedMesh`** (shared box geometry and material; per-instance colour from heatmap severity; `onClick` → `event.instanceId` → bin id; `onPointerMove` → hover tooltip with bin code + status). Drei `OrbitControls` (with reset), `Html` label only for the selected bin. Proposed stock: a second instanced mesh of semi-transparent cartons on candidate bins, labelled "Proposed — not received".
- `?sku=` highlights all bins holding that SKU and flies the camera to the first one; `?bin=` selects a bin; plan lines link here.
- `BinPanel`: location path, capacity and fill, each balance (SKU, batch, expiry, days left, qty, reserved, status, data source). Unmapped stock appears in a separate "Unmapped" list, never placed in a random bin.
- `Legend` with colour + text per mode; `ModeSelect` (Stockout Risk, Expiry Risk, Excess Stock, Normal, Proposed Replenishment).
- Performance: 240 bins + ≤ 100 ghost cartons; `frameloop="demand"`.

---

## 12. Scenarios (`lib/scenarios/apply.ts`, `lib/services/scenarios.ts`)

Running a scenario sets `app_state.active_scenario_id` (audited) and its effects apply **in memory** in `loadPlanningContext`, so Reset is instant and the seed is never corrupted. After Run, the UI offers "Recalculate current plan" (calls recalculate) — the change in numbers is real because the engine reruns on the modified context.

| Scenario | In-memory change | Expected visible result |
|---|---|---|
| `demand_spike` | Multiply the last 5 days of sales × 3 for the 3 SKUs listed in `demo-cases.json` (`spike`) | Higher d̄, lower cover, larger qty, higher rank; `DEMAND_SPIKE` flag |
| `supplier_delay` | Preferred supplier (most wins in the baseline plan) lead time + 5 days, its prices + 8% | Re-ranked suppliers; urgent lines move to a faster supplier |
| `budget_cut` | Budget for new/recalculated plans = ₹1,00,000 | Lowest-priority lines deferred with reasons; total ≤ ₹1,00,000 |
| `expiry_risk` | One large batch of a SKU in `demo-cases.json` (`expiry`) gets expiry = as-of + 60 days | At-risk value appears, reorder reduced or blocked, bin turns amber |
| `baseline` | none | — |

---

## 13. Audit log catalogue

Every row: `actor_type` (`user` | `system` | `agent` | `tool`), `actor_id` (DEMO_USER, `seed`, `orchestrator`), `action`, `entity_type`, `entity_id`, `before_json`, `after_json`, `reason`.

| Action | When |
|---|---|
| `seed.completed` | end of `npm run seed` (row counts) |
| `plan.created` | createPlan |
| `plan.recalculated` | recalculatePlan (before/after totals, changed lines) |
| `line.edited` · `line.deferred` · `line.rejected` · `line.restored` | editLine |
| `plan.lines_approved` | approveLines (line ids) |
| `po.draft_created` | per PO |
| `po.exported` | export |
| `plan.rejected` | rejectPlan |
| `scenario.run` · `scenario.reset` | scenarios |
| `settings.budget_changed` | default budget edit |

---

## 14. Testing

### 14.1 Unit fixtures (hand-computed — these numbers must match exactly)

**F1 Demand and quantity.** Last 7 days sold `[10, 12, 8, 10, 10, 14, 6]` (sum 70); last 28 days sum 224. Offer: L = 4, pack_multiple = 10, MOQ = 20. Stock position = 40.
- d7 = 10, d28 = 8, d̄ = 0.6 × 10 + 0.4 × 8 = **9.2**
- safety = max(2, 27.6) = **27.6**; ROP = 9.2 × 4 + 27.6 = **64.4**; target = 9.2 × 11 + 27.6 = **128.8**
- 40 < 64.4 → candidate; qRaw = 88.8 → ceil(8.88) × 10 = **90**; max(90, 20) = **90**
- cover = 40 / 9.2 = **4.3478…** days

**F2 Effective cost with scheme.** price ₹20, GST 12%, freight ₹0.50, scheme 10+1 taken: 20 × 1.12 × 10/11 + 0.50 = **₹20.8636** (4 dp). Without scheme: **₹22.9000**.

**F3 Totals.** q = 90, price ₹20, GST 12%, freight ₹0.50 → subtotal **1800.00**, tax **216.00**, freight **45.00**, total **2061.00**.

**F4 FEFO expiry.** as-of 2026-10-21, d̄ = 2, risk window 90.
- Batch A: 100 packs, expiry 2027-01-29 (100 days) → sellable 10 days → capacity 20 → sold **20**, at risk **80**.
- Batch B: 50 packs, expiry 2027-10-21 (365 days) → sellable 275 → capacity 550 − 20 = 530 → sold **50**, at risk **0**.
- eligibleAvailable = **70**; with unit_cost ₹12, at-risk value = **₹960.00**.

**F5 Supplier score.** Offer A: cost 20, lead 7, reliability 90, terms 30. Offer B: cost 22, lead 2, reliability 80, terms 45.
- cover = 20 (both fast enough): A: C_cost 100, C_lead 0, C_rel 90, C_terms 66.667 → **69.6667**; B: 0, 100, 80, 100 → **51.0000** → **A wins**.
- cover = 4: A (L 7 > 4) is dropped (`TOO_SLOW_FOR_COVER`, line gets `CHEAPER_OFFER_TOO_SLOW`) → **B wins**.
- Supplier with null reliability → C_rel = 0 (not 100).

**F6 Basket.** Budget ₹5,000; candidates in order: L1 ₹3,000 (p 5), L2 ₹2,500 (p 4), L3 ₹1,500 (p 3).
Pass 1: L1 in (rem 2,000), L2 deferred, L3 in (rem 500). Pass 2: L2 partial qty only if a pack-valid qty ≥ MOQ costs ≤ ₹500. Total ≤ budget always.

**F7 Scheme skip** (tests the `ordering.ts` scheme function in isolation). d̄ = 1, stock position 100, shelf life 540, P = 20, F = 3, q = 10, pack 10: qScheme = 20, received 23 → (100 + 23)/1 = 123 < 450 → **taken**. Same with d̄ = 0.2: 615 ≥ 450 and q < P → **SCHEME_SKIPPED_EXPIRY**, expiryAvoided = 10 × effective cost.

**F8 Edge cases.** zero demand → no line, `NO_DEMAND`; incoming PO beyond 14 days excluded; reserved stock subtracted once; quarantine/expired batch excluded; qty 85 with pack 10 → `INVALID_PACK_MULTIPLE`; stale and expired quotes excluded; blocked supplier excluded; budget boundary: line total exactly = remaining is included.

**F9 Determinism.** `buildPlan` twice on the same context → deep-equal output.

### 14.2 Integration (optional, `TEST_DATABASE_URL`)

Seed a tiny fixture DB → create plan → edit qty → approve twice with the same key → exactly one PO per supplier, PO total = Σ lines, every approved line linked once, audit rows exist → reject a plan → no POs.

### 14.3 Manual demo checklist (run before freeze)

- [ ] Seed from clean (`db:reset` + `seed`) passes validation.
- [ ] Command Center numbers match a direct SQL count.
- [ ] Plan at ₹2,00,000 has deferred lines; at ₹1,00,000 total ≤ ₹1,00,000.
- [ ] Edit preview shows new total before saving; over-budget edit is refused with the amount.
- [ ] Approve creates POs grouped by supplier; double-click creates nothing extra.
- [ ] 3D: click bin shows the right batches; heatmap modes change colours; `?sku=` focuses; 2D toggle works.
- [ ] Each scenario run + recalculate changes the numbers; Reset restores them.
- [ ] With `GEMINI_API_KEY` removed, Why? and Ask still respond (deterministic).
- [ ] `npm run build` passes.

---

## 15. Build plan — 30 hours, one builder

Stage 0 (setup) is already done, which gives about 1 hour of slack. Hours are cumulative.

### Stage 1 — Foundation and data (hours 0–3) · P0

- [ ] 3.2 setup: Supabase, `.env.local`, `npm run db:migrate`.
- [ ] Delete `app/page.tsx`; create `app/(dashboard)/layout.tsx` (temporary plain shell) and `app/(dashboard)/page.tsx` ("Command Center" placeholder inside `<Suspense>`).
- [ ] Phase D1: put the reference files in `data/reference/`, write `sources.json`, build `profile-reference.ts`, run it, review `profile.json` with the team.
- [ ] Phase D2: `scripts/seed/prng.ts`, `catalog.ts`, `generate-synthetic.ts`, `inject-demo-cases.ts`, `validate.ts`, `write.ts`, `index.ts` (section 5).
- [ ] `lib/services/as-of.ts`, `lib/services/audit.ts`.

Verify: `profile.json` contains no names or rows; `npm run db:reset && npm run seed` prints the summary with validation passed; Supabase shows 500 products, 240 bins, 45,000 sales rows; `npm run check` passes.

### Stage 2 — Calculation engine (hours 3–9) · P0

- [ ] `dates.ts`, `types.ts`, `demand.ts`, `expiry.ts`, `inventory.ts`, `ordering.ts`, `supplier-scoring.ts`, `totals.ts`, `priority.ts`, `basket.ts`, `impact.ts`, `validation.ts`, `engine.ts` (section 6).
- [ ] Write fixtures F1–F9 as tests **first** (hour 3), then implement until green.
- [ ] `lib/db/queries/*` and `lib/services/context.ts` (`loadPlanningContext`).
- [ ] Temporary script `scripts/debug-plan.ts` that prints the top 20 lines for ₹2,00,000 to eyeball results.
- [ ] Switch `inject-demo-cases.ts` and `validate.ts` from their temporary stage-1 helpers to the engine functions, then `npm run db:reset && npm run seed` again (validation must still pass).

Verify: `npm run test` all green (F1–F9); debug plan shows urgent SKUs first, deferred lines exist, total ≤ budget.

### Stage 3 — Procurement UI (hours 9–14) · P0

- [ ] Theme tokens in `globals.css`, `<html className="dark">`, `Toaster` in root layout; real shell (Sidebar, TopBar, DataSourceBadge).
- [ ] `lib/validation/api.ts`; routes: dashboard, analyze, get plan, PATCH line (with preview), recalculate.
- [ ] `lib/services/plans.ts` (createPlan, getPlan, editLine, recalculatePlan), `dashboard.ts`, `explain.ts`.
- [ ] Command Center screen; Create Purchase Plan dialog; Procurement list; Plan screen with Impact Card, table, deferred section, line drawer (demand chart, stock breakdown, batches, supplier comparison, formulas), edit with preview.

Verify: create a plan in the browser; open a line; edit qty → preview → save → totals change; over-budget edit refused; refresh keeps state.

### Stage 4 — Approval and audit (hours 14–17) · P0

- [ ] `lib/services/approval.ts` (7.6) + approve route; reject route; defer/reject/restore via PATCH.
- [ ] Purchase Orders list + detail + CSV export + print view.
- [ ] Activity screen.

Verify: approve 5 lines across 3 suppliers → 3 draft POs, totals match; click Approve twice fast / replay the same request → no duplicates; audit shows every action; reject plan → no POs.

### Stage 5 — Warehouse (hours 17–22) · P0

- [ ] `heatmap.ts`, `putaway.ts` (+ tests); `lib/services/warehouse.ts`; layout/heatmap/bin/search routes.
- [ ] `Grid2D` first (CSS grid by aisle → rack → shelf, same colours and panel), then `Scene3D` with instanced bins, hover, click, modes, legend, `?sku=` focus, proposed ghost cartons, reset camera, WebGL fallback.
- [ ] "Locate" links from Command Center and the line drawer.

Verify: every heatmap mode matches the plan's statuses for 3 spot-checked SKUs; unmapped stock is listed, not placed; works with WebGL disabled (2D).

### Stage 6 — Agent orchestration (hours 22–25) · P1

- [ ] `lib/agents/tools.ts`, `prompts.ts`, `orchestrator.ts`; `/api/agent/chat`; `/explain` route uses the agent then falls back.
- [ ] Ask PharmaOS panel; Why? buttons; plan summary after creation.
- [ ] Test the 7 prompts in Appendix A with and without the API key.

Verify: "Why did you choose Supplier B instead of Supplier A for <SKU>?" cites the same numbers as the drawer; "Reduce the budget to ₹1,00,000…" recalculates the saved plan and lists deferred lines; with the key removed every button still works.

### Stage 7 — Scenarios and polish (hours 25–27) · P1

- [ ] `apply.ts`, `scenarios.ts`, routes, Data & Scenarios screen, scenario chip in top bar, ROI model.
- [ ] Loading/empty/error/stale states on every screen; keyboard focus visible; numbers right-aligned.

Verify: run Budget cut → recalculate → total ≤ ₹1,00,000 with deferred reasons; Supplier delay re-ranks; Reset restores baseline numbers.

### Stage 8 — Freeze and rehearse (hours 27–30)

- [ ] No new features after hour 27.
- [ ] `npm run build` and run the production build locally (`npm run start`).
- [ ] `db:reset` + `seed` to a clean demo state; note the demo SKUs from `demo-cases.json`.
- [ ] Rehearse the demo script 3 times with a timer; record a backup video.
- [ ] Run the manual checklist 14.3.

P2 stretch (only if ahead at hour 22): ghost cartons polish, simulated put-away movement (`warehouse_movements`), simple FEFO pick path.

### 15.1 Cut order if time runs short

1. P2 stretch.
2. Demand-spike and expiry scenarios (keep budget cut).
3. Free-form Ask panel (keep deterministic **Why?** built from `evidence_json`).
4. Extra heatmap modes (keep stockout and expiry).
5. **Never cut:** correct calculations, plan editing with server recalculation, approval + audit, and a basic interactive 3D warehouse.

---

## 16. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Reference files have unexpected formats | `sources.json` column map + coercion; a missing file only falls back to defaults, so the demo never depends on it |
| Engine bugs show wrong numbers on stage | Fixtures F1–F9 written before the code; debug-plan script; `evidence_json` shows every step |
| Next 16 caching surprises | Suspense + `connection()` pattern on every page (1.1); `npm run build` at the end of every stage |
| Base UI component APIs differ from Radix examples | Read the component file in `components/ui/` before use |
| LLM slow / down / refuses | 15 s timeout, deterministic fallback, AI is never on the critical path |
| WebGL fails on the demo laptop | 2D grid with the same data and panel |
| Supabase/Wi-Fi issue during judging | Local Postgres fallback (3.2) seeded the same way; backup video |
| Running out of time | Stage order, freeze at hour 27, cut order 15.1 |

---

## 17. Demo script (3–4 minutes)

1. **(0:00) The pain.** "A stockist has ₹2 lakh to spend today, SKUs about to run out and stock near expiry." Command Center; point at the data-source badge.
2. **(0:30) Create plan.** Budget ₹2,00,000 → ranked plan. Impact Card: stockouts covered, ₹ committed, deferred risk.
3. **(1:00) Why this line?** Open a stockout SKU: demand chart, stock position, expiry, supplier comparison. Ask "Why Supplier B instead of A?" — the answer cites the drawer's numbers.
4. **(1:45) Warehouse.** Locate the SKU in 3D, switch stockout → expiry heatmap, click its bin.
5. **(2:20) Disruption.** Run Budget cut (or Supplier delay) → recalculate → deferred lines show their risk.
6. **(2:50) Edit.** Change one quantity → preview → save; totals recalculate on the server.
7. **(3:10) Approve.** Approve selected lines → draft POs grouped by supplier → audit record.
8. **(3:40) Close.** "Nothing was sent to a supplier; a human approved every rupee." Show the ROI model.

---

## 18. Definition of done

- [ ] The dashboard loads seeded synthetic demo data, labels it, and lists its reference sources.
- [ ] Dashboard metrics are computed from the database.
- [ ] Procurement run returns ranked recommendations with reasons and supporting values.
- [ ] Stock position, cover, reorder qty, rounding, expiry, scoring, basket and totals pass F1–F9.
- [ ] Supplier selection excludes stale/expired offers, unavailable stock, unapproved suppliers and mismatched products.
- [ ] The basket never exceeds the budget; deferred items and reasons are visible.
- [ ] Editing qty/supplier recalculates on the server, with preview.
- [ ] Approving selected lines creates draft POs grouped by supplier plus audit records; repeated approval creates no duplicates.
- [ ] Reject/defer changes totals and is audited.
- [ ] Clicking a 3D bin shows the matching product/batch/quantity records; heatmaps use calculated values; selecting a recommendation focuses its bin; proposed stock looks distinct.
- [ ] Scenarios change state and recalculated results.
- [ ] LLM failure does not break any workflow.
- [ ] No action is labelled sent/ordered/confirmed.
- [ ] `npm run check` and `npm run build` pass.

---

## Appendix A — Demo prompts for Ask PharmaOS

1. Create today's purchase plan with a ₹2,00,000 budget. Prioritise products likely to run out before the supplier can deliver.
2. Why did you choose Supplier B instead of Supplier A for this SKU?
3. Reduce the budget to ₹1,00,000 and recalculate. Tell me which orders you deferred and the risk.
4. Show where this SKU and its batches are located in the warehouse.
5. Show expiry risk in the warehouse and identify affected purchase recommendations.
6. Change this order to 60 packs and recalculate total, remaining budget and MOQ/pack constraints. *(the agent explains that edits are made in the Edit dialog and runs `validate_po` to check 60 packs; it does not edit lines itself)*
7. Prepare draft POs for approved lines. Do not send them to suppliers. *(the agent explains the Approve button; it cannot create POs)*

## Appendix B — Reason and warning codes

| Code | Kind | Meaning shown to the user |
|---|---|---|
| `BELOW_REORDER_POINT` | reason | Stock position is below the reorder point |
| `STOCKOUT_BEFORE_DELIVERY` | reason | Stock runs out before any supplier can deliver |
| `CHEAPER_OFFER_TOO_SLOW` | reason | A cheaper supplier was skipped because it delivers after the projected stockout |
| `SCHEME_TAKEN` | reason | Scheme taken; the extra stock sells before expiry |
| `SCHEME_SKIPPED_EXPIRY` | reason | Scheme skipped; the extra stock would not sell before expiry |
| `EXPIRY_REDUCED_QTY` | reason | Quantity reduced to the reorder point because existing batches are at expiry risk |
| `BUDGET_DEFERRED` | reason | Deferred: not enough budget left for this line |
| `ALT_OFFER_FOR_BUDGET` | reason | Switched to the next-best supplier to fit the budget |
| `PARTIAL_QTY_BUDGET` | reason | Quantity reduced to fit the remaining budget |
| `NO_ELIGIBLE_OFFER` | reason | No approved, valid, available offer for this SKU |
| `NO_DEMAND` · `LOW_HISTORY` · `DEMAND_SPIKE` | warning | Demand data quality notes |
| `AT_RISK_BATCHES` | warning | This SKU already has batches at expiry risk |
| `SCHEME_EXCESS_RISK` | warning | Free goods may not sell before expiry |
| `PRICE_ANOMALY` | warning | This offer is more than 20% above the SKU's other offers |
| `NOT_TOP_SUPPLIER` | warning | User chose a supplier that is not the top-scored one |
| `CAPACITY_REVIEW` | warning | No bin can take the proposed quantity; needs review |
| `UNMAPPED_STOCK` | warning | Some stock of this SKU has no bin location |
| Offer exclusions | offer | `SUPPLIER_NOT_APPROVED`, `QUOTE_EXPIRED`, `QUOTE_STALE`, `MISSING_PRICE`, `OFFER_INACTIVE`, `PRODUCT_MISMATCH`, `INSUFFICIENT_AVAILABILITY`, `INVALID_PACK_RULES`, `TOO_SLOW_FOR_COVER` |
| Hard stops | approval | `INVALID_SKU`, `SUPPLIER_NOT_APPROVED`, `QUOTE_EXPIRED`, `QUOTE_STALE`, `MISSING_PRICE`, `INVALID_PACK_MULTIPLE`, `BELOW_MOQ`, `ABOVE_AVAILABILITY`, `NON_POSITIVE_QTY`, `OVER_BUDGET`, `INVALID_BUDGET`, `PRODUCT_RECALLED` |
