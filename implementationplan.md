# PharmaOS — Implementation Plan

> Web-based dashboard · solo builder · about 42 hours (was 30; extended for the ML demand model and the agent pipeline) · Next.js 16 + Supabase Postgres + Gemini
> Read `problemstatement.md` first. This file is the build source of truth: follow it stage by stage, in order. Do not add modules that are not in it.

---

## 0. How to use this plan

1. Work **one stage at a time** (section 15). Each stage lists its files, exact behaviour, and a "Verify" block. Do not start the next stage until its Verify block passes.
2. When an AI coding assistant writes the code, use the ready-made prompts in `prompts.md` (P00–P28, plus P16B, P22B and P23B), or give it this file plus the stage number. Tell it: *"Implement stage N exactly as written in implementationplan.md. Do not invent features, tables or endpoints."*
3. After every stage: `npm run check` (typecheck + lint + unit tests), then commit: `git add -A && git commit -m "stage N: <name>"`.
4. Every number shown in the UI must come from the database or from `lib/business-logic`. No hard-coded dashboard values.
5. If something in this plan turns out to be wrong while building, fix the plan in the same commit so the plan and code never disagree.

### 0.1 Rules the code must always follow

| # | Rule |
|---|---|
| R1 | All arithmetic for quantities, prices, totals and scores lives in `lib/business-logic/*` (pure functions, unit-tested); the demand model's maths lives in `lib/ml/*` (pure, unit-tested). Routes, UI and the LLM never compute them. An agent may choose between values the tools return (a forecast method, an eligible offer), never invent one. |
| R2 | Money uses `lib/money.ts` (decimal.js). Never use JS floats for rupees. DB money columns are `numeric`; postgres.js returns them as strings — pass strings into `dec()`. |
| R3 | Every quantity is an integer number of **packs**. |
| R4 | The browser is never the source of truth for totals. The server recomputes on every edit and on approval. |
| R5 | Only `lib/services/approval.ts` (`approveLines`) creates purchase orders, inside one DB transaction, idempotently. It is called by the approve endpoint (a human click) and by exactly one AI: the pipeline's **Order Agent** (section 9.5), create only, audited as actor `agent`. A PO whose grand total is above the Owner approval limit (₹10,00,000) is created `pending_approval` and cannot be sent until the Owner approves it. No AI can send a PO, Owner-approve a PO, reject a plan or change the approval limit. |
| R6 | Nothing ever leaves the app: "Send to supplier" is simulated (status `sent`, always labelled "simulated — nothing was emailed"). No email, API or payment integration. Statuses "ordered" or "confirmed" never appear. |
| R7 | Every mutation writes an `audit_logs` row (section 13). |
| R8 | Every screen shows the data-source badge ("Synthetic demo data"), and detail views show each record's `data_source` label. Never call generated data real, and never present a supplier price as a real quote. |
| R9 | The dashboard must work fully with `GEMINI_API_KEY` empty: chat/explanations switch to the deterministic text, and an agent run ends in `fallback` (no AI changes, no POs created — the user reviews and approves manually). The ML forecast needs no API key. |
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
| Migrations | Plain SQL in `db/migrations/`, applied by `npm run db:migrate` | `001_init.sql`, `002_approval_limit.sql` (removes the budget, adds the PO approval limit), `003_ml_and_agents.sql` (demand model + agent runs), later files up to `006_goods_receipt.sql` (`005` raises the Owner limit to ₹10,00,000; `006` adds goods receipt columns) |
| Validation | Zod 4 | API inputs, tool inputs, seed rows |
| Money | decimal.js via `lib/money.ts` | Already written and tested |
| AI | Google Gemini via `@google/genai` 2.30 (TypeScript), model from `GEMINI_MODEL`, default `gemini-flash-latest`. Manual function-calling loop, mode `AUTO`, automatic function calling disabled | Team choice; explicit workflow; no agent framework |
| Tests | Vitest 5 (`tests/**/*.test.ts`) | Already configured: `vitest.config.mts` |
| Demand ML | Global **ridge regression** in TypeScript (`lib/ml/`), closed-form solve, trained by `npm run train:forecast`; used per SKU only where its 14-day backtest beats the baseline | No Python service; deterministic; explainable; honest backtest (section 6.2a) |
| Agent pipeline | Three Gemini agents (Demand, Supplier, Order) run in sequence in the background (`after()`), each with its own tools and a Zod-validated terminal `submit_*` tool; every step stored in `agent_steps` | Real decisions with real, guarded effects; a replayable trace (section 9.5) |
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
├── prompts.md                        ✅ build prompts P00–P28 (+ P16B, P22B, P23B), run one by one
├── implementationplan.md              ✅ this file
├── .env.example                       ✅ copy to .env.local
├── package.json                       ✅ scripts: dev, build, lint, typecheck, test, check, db:migrate, db:reset, seed (+ train:forecast in P16B)
├── vitest.config.mts                  ✅
├── db/migrations/001_init.sql         ✅ full schema + default scenarios + app_state
├── db/migrations/002_approval_limit.sql  no budget; app_state.po_approval_limit; PO statuses ready/pending_approval/approved/sent/rejected; seasonal_surge scenario
├── db/migrations/003_ml_and_agents.sql   forecast_models, sku_forecast_metrics, agent_runs, agent_steps
├── db/migrations/005_scale_and_limit.sql po_approval_limit default 1000000
├── db/migrations/006_goods_receipt.sql   purchase_orders.received_at / received_by, purchase_order_lines.received_qty
├── data/
│   ├── reference/                     ✅ reference datasets (git-ignored) + sources.json + profile.json
│   └── synthetic/                     generated CSV snapshots for inspection (git-ignored)
├── scripts/
│   ├── db/migrate.ts                  ✅ applies migrations; --reset drops the public schema first
│   ├── ml/train-forecast.ts           npm run train:forecast — trains the ridge model, backtests, stores it (also run at the end of seed)
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
│   ├── ml/                            PURE demand-model maths (no I/O)
│   │   ├── features.ts                feature rows per (SKU, day): lags, rolling stats, trend, weekday, category
│   │   ├── ridge.ts                   standardise + closed-form ridge (normal equations, Cholesky)
│   │   ├── forecast.ts                recursive 14-day forecast from stored coefficients
│   │   └── backtest.ts                WAPE for ML vs baseline on the holdout; default-method rule
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
│   │   ├── impact.ts                  Plan Impact Card values
│   │   ├── validation.ts              hard stops + soft warnings
│   │   ├── heatmap.ts                 per-bin status
│   │   ├── putaway.ts                 candidate bin selection
│   │   └── engine.ts                  analyseSku() + buildPlan() + supplier PO projection: composes the above
│   ├── services/                      DB + business logic. Server only.
│   │   ├── context.ts                 loadPlanningContext(): one read of everything the engine needs
│   │   ├── as-of.ts                   resolveAsOfDate()
│   │   ├── dashboard.ts               Command Center metrics
│   │   ├── plans.ts                   createPlan, getPlan, editLine, recalculatePlan, rejectPlan
│   │   ├── approval.ts                approveLines() — the only PO writer
│   │   ├── purchase-orders.ts         list/get, Owner approve/reject, send (simulated), export
│   │   ├── warehouse.ts               layout, heatmap, bin details, candidate bin
│   │   ├── scenarios.ts               list, run, reset
│   │   ├── audit.ts                   writeAudit(), listAudit()
│   │   ├── forecast-model.ts          train + store the model, load the latest model, per-SKU metrics
│   │   ├── agent-runs.ts              start a run, read a run + steps, list runs
│   │   └── explain.ts                 deterministic explanation text from evidence_json
│   ├── agents/
│   │   ├── tools.ts                   tool definitions (name, description, Zod schema, handler)
│   │   ├── prompts.ts                 system prompt
│   │   ├── orchestrator.ts            runAgent(): manual tool loop + fallback (Ask PharmaOS, Why?, summary)
│   │   └── pipeline/                  the three decision-making agents (section 9.5)
│   │       ├── loop.ts                shared Gemini tool loop with a terminal submit_* tool + step logging
│   │       ├── demand-agent.ts        tools + submit_demand_decisions + guardrail
│   │       ├── supplier-agent.ts      tools + submit_supplier_decisions + guardrail
│   │       ├── order-agent.ts         tools + create_purchase_orders + submit_order_summary
│   │       └── run.ts                 runPipeline(runId): Demand → Supplier → Order, fallback, run status
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
│   │   ├── purchase-orders/[poId]/page.tsx  PO detail + approve/reject/send + print/export
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
│   ├── agents/                        RunAgentsButton, AgentRunPanel (agent cards, tool timeline, decisions, results)
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
2. Connect (top of the project) → **Session pooler** (port **5432**). Copy it. Do **not** use the transaction pooler (port 6543): several queries sent in parallel (as `loadPlanningContext` does) hang on it. The app keeps prepared statements on (`prepare: true`, supported in session mode): without them each parameterised query costs an extra round trip and stops pipelining. The session pooler allows 15 clients in total; the app pool uses 4, so scripts run alongside `npm run dev` should use ≤ 4.
3. `cp .env.example .env.local` and set `DATABASE_URL` (replace `[YOUR-PASSWORD]`).
4. Set `GEMINI_API_KEY` if you have one (from Google AI Studio, aistudio.google.com/apikey; optional until stage 6).
5. `npm run db:migrate` → expect `Applied 001_init.sql`, `Applied 002_approval_limit.sql` and `Migrations up to date.`
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

The schema is `db/migrations/001_init.sql` plus `002_approval_limit.sql` (drops `purchase_plans.budget_limit` / `budget_remaining` and their check, replaces `app_state.default_budget` with `po_approval_limit` default 400000, replaces the PO status check with `open | received | cancelled | ready | pending_approval | approved | sent | rejected`, adds `purchase_orders.sent_at` / `sent_by`, replaces scenario `budget_cut` with `seasonal_surge`) plus `003_ml_and_agents.sql` (demand model and agent-run tables, below). Key rules:

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
| `scenarios`, `app_state` | Demo control | `app_state` is a singleton row: active scenario, `po_approval_limit` (default ₹10,00,000), optional as-of date |
| `purchase_plans` | One planning run | No budget columns (dropped in `002_approval_limit.sql`); `impact_json` stores the Impact Card incl. `supplierTotals` |
| `purchase_recommendations` | One line per SKU in a plan | `in_basket` = buyable line in the plan (false only for "no eligible offer" lines; owner defer/reject is the `status`); `status` lifecycle in section 7.4; `evidence_json` holds every input and intermediate value |
| `purchase_orders` | POs | Seeded external: `open` (counts as incoming stock) · `received` · `cancelled`. Created by PharmaOS on approval: `ready` · `pending_approval` (grand total > `po_approval_limit`) · `approved` · `sent` (simulated; counts as incoming stock) · `rejected`. `sent_at`, `sent_by`; `unique (idempotency_key, supplier_id)` |
| `purchase_order_lines` | PO lines | `recommendation_id` unique → a recommendation can become a PO line only once, ever |
| `approvals` | Decisions | One row per approve / reject / defer |
| `audit_logs` | History | Append-only (a trigger blocks update/delete) |
| `warehouse_movements` | Simulated moves | Only `*_simulated` types |
| `forecast_models` | Trained demand models | `feature_names`, `means`, `stds`, `coefficients` (jsonb), `intercept`, `lambda`, `train_rows`, `holdout_days`, `metrics` {mlWape, baselineWape, skusUsingMl}, `trained_at`, `as_of_date`, `data_source = 'synthetic_demo'`; the latest row is used |
| `sku_forecast_metrics` | Per-SKU backtest | `model_id`, `product_id`, `ml_wape`, `baseline_wape`, `default_method` ('ml' / 'baseline'); unique per model + product |
| `agent_runs` | One pipeline run | `plan_id`, `status` running / succeeded / failed / fallback, `max_skus`, `skus` jsonb, `started_at`, `finished_at`, `summary`, `error`; at most one `running` per plan |
| `agent_steps` | Every tool call and decision | `run_id`, `agent` demand / supplier / order, `seq`, `kind` tool_call / decision / rejected_decision / message / fallback, `tool_name`, `input` / `output` jsonb, `ok`, `ms`; append-only like the audit log |

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
| suppliers | 8 (`SUP-01`…`SUP-08`) | 6 approved, 1 `pending`, 1 `blocked`; lead times as Indian pharma distribution runs: approved local distributors 1, 1, 2, 2 and 3 days, plus one **manufacturer-direct** channel at 6 days (cheaper, slower: the "cheaper but too slow" trade-off); pending/blocked 2–4 days; reliability 60–98 (drives late deliveries in the simulation); payment terms 15, 21, 30, 45 or 60 days; one approved supplier with null reliability (tests "missing data scores 0") |
| supplier_offers | 1–4 per SKU (mostly 2–3); the first is the SKU's usual distributor (approved, never the direct channel) | `price_type = 'supplier_quote'`; `unit_price` = ptr × 0.80–0.90 from distributors, × 0.74–0.80 from the manufacturer-direct channel (stockist buys below PTR); MOQ ∈ {1, 5, 10, 20}; pack_multiple ∈ {1, 5, 10}; available 50–2,000; lead time = supplier default ± 1 (min 1); freight ₹0–₹1.50 per pack; schemes on ~15% of offers (`10+1`, `20+3`, `5+1`); `quoted_at` = as-of − 1…20 days (≈10% older than 14 days = stale); `valid_until` = `quoted_at` + 7…30 days (≈5% already expired) |
| sales_history | 90 days ending on as-of, every product (zero days included as rows) | Demand **shape** from `dailyDemandQuantiles` (its spread relative to its median), **rescaled** so each SKU's base demand sits at a mid-size stockist level (≈ ₹15 Cr of sales a year): median 12 packs/day, clamped to 1.5–90 packs/day (the sample's absolute level comes from 5 drugs across 5 states and an unknown unit, so it is not used). Weekly shape from `weekdayFactors` (flat if missing). Profile per SKU: 45% stable (Poisson), 20% intermittent (zero-day share from the profile, default 60%), 16% growing (+1%/day), 16% declining (−1%/day), 3% spike (last 5 days × 3). The simulated stockist reviews each SKU twice a week with its own rule of thumb (reorder below lead + 4–14 days of cover, top up to lead + 25–40 days), so on demo day most SKUs are healthy and the plan's lines still have days of stock left. These are customer **demand**; recorded `units_sold` = what the daily-operations simulation (below) could actually sell from stock, so a stockout shows as lost sales |
| inventory_locations | 240 bins | Aisles A–E; each aisle has a left and right rack row; 6 racks per row; 4 shelves per rack (5 × 2 × 6 × 4 = 240). `bin_code` = `A-L-03-2` (aisle-side-rack-shelf). Coordinates: `x = aisleIndex × 4 + (side === 'L' ? -1 : 1)`, `z = rackIndex × 1.2`, `y = (shelf − 1) × 0.7`. Aisle E = `cold_chain` + `cool`; the rest `ambient`. Capacity 250–1,000 packs (demo proxy, sized so 500 SKUs fit at ~70% fill). 4 bins `inactive` |
| batches | What the simulation left: opening lots plus one lot per delivery (1–6 per SKU) | Opening stock = 10–30 days of cover in 1–2 lots received 10–120 days before the window; every delivery creates a lot on its arrival date with `expiry_date` = arrival + shelf life − age at receipt (30–180 days; a short-dated share, as before, arrives much closer to expiry); `unit_cost` = the offer price ± 3%. Kept: lots that still hold stock, plus each SKU's latest receipt. Exceptions: 3 lots received in the last 3 days still in `quarantine` (awaiting QC), 1 `recalled`, 2 that expired on the shelf |
| inventory_balances | Each remaining lot in 1–2 bins of a matching storage class (ambient → aisles A–D, cool → E right, cold_chain → E left; never an inactive bin) | `on_hand_qty` = the lot's stock at as-of after FEFO sales, within bin capacity; `reserved_qty` 0–10% of on hand (customer orders not yet dispatched); 3 balances with `location_id = null` (received, not yet put away) |
| purchase_orders + lines | From the simulation, one PO per supplier per order day (about 150) | `open` = still on the way at as-of (`expected_delivery_date` = order day + lead time; a few already overdue because the supplier is late); `received` = arrived in the last 21 days; `cancelled` = cancelled by the distributor in the last 21 days (~1% of orders); older history is not kept. `po_number` = `EXT-0001`… in order-day order |

**Daily-operations simulation** (in `generate-synthetic.ts`, replaces random stock): for each SKU, day by day over the 90 days, (1) deliveries due today become new lots, (2) the day's demand is sold from eligible stock, oldest expiry first (anything short is a lost sale), (3) on its two weekly review days the owner's rule of thumb runs: if stock + on order covers less than lead + 6 days of the last 14 days' average sales, order up to lead + 14 days from the usual distributor (MOQ and pack multiple applied); ~10% of reviews are missed (busy days), deliveries are late by 1–3 days with probability (100 − reliability) %, and ~1% of orders are cancelled. The result is what a real, imperfect stockist looks like: about 80% of SKUs healthy, some excess on slow movers, and a handful short because of a missed review, a late delivery, a trend or a spike — before the demo cases are added.

### 5.6 `inject-demo-cases.ts` — guaranteed cases

First, any SKU whose offers all came out stale or expired gets one approved offer refreshed (only the `noEligibleOffer` SKU may have none), and SKUs holding unmapped stock are kept out of the other cases. Then adjust specific SKUs so these counts hold exactly, and record which SKUs are which in `data/synthetic/demo-cases.json` (used by the demo script and tests):

| Case | Count | How it is forced |
|---|---|---|
| Stockout risk (cover < fastest eligible lead time) | ≥ 10 | Reduce on-hand of fast movers |
| Expiry-risk batches (projected unsold before risk window) | ≥ 8 (9 listed) | Move expiry to as-of + 95…150 days on slow movers with large qty |
| Excess stock (position > 1.5 × target) | ≥ 5 | Increase on-hand of slow movers |
| Supplier price anomaly (offer > 1.2 × median of other offers) | 3 | Inflate one offer price |
| Capacity warning (no bin can take the proposed qty) | 2 | Cold-chain room full: the other cold-chain SKUs get healthy stock, these 2 get none, then every cold-chain bin's capacity is set just above its current fill (no bin ever exceeds capacity) |
| Cheapest supplier too slow (cheapest lead time > cover) | 3 | Cheapest offer gets lead time 6–7 days (like the manufacturer-direct channel) and ≥ 1,000 packs available, so speed alone rules it out; the faster offers get 1–2 days |
| Scheme that should be skipped | 2 | A very slow mover (≈0.17 packs/day, shelf life 540 days, 1 pack in stock) gets a `100+20` scheme on its offers, so (stock + 120) ÷ d̄ ≥ shelf life − 90 and q < 100. (A `20+3` scheme can never trigger the skip at stockist demand levels.) |
| Stale quote on an otherwise best offer | 2 | `quoted_at` = as-of − 20 days |
| Unmapped stock | 3 | `location_id = null` |
| Demand spike flag | ≥ 2 (3 listed, used by the demand_spike scenario) | Spike profile; last 5 days set to ≈ 4.5 × base so d7 / d28 ≥ 2 |

### 5.7 `validate.ts` — fail loudly

The seed aborts (non-zero exit) if any check fails:
- every FK resolves; every SKU has ≥ 1 offer from an approved supplier (except 1 deliberate "no eligible offer" SKU);
- no balance has `reserved_qty > on_hand_qty`; no bin exceeds capacity except the 2 capacity cases;
- every sales row is ≤ as-of date and ≥ 0;
- the counts in 5.6 hold;
- the default plan has at least 15 candidate lines;
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
baseline     = 0.6 × d7 + 0.4 × d28
avgDailyDemand d̄ = the chosen method's value: ML (section 6.2a) or the baseline
```

Flags (returned as warnings):
- `NO_DEMAND`: d̄ = 0 → no order, cover shows "No reliable demand estimate".
- `LOW_HISTORY`: first sale date is fewer than 28 days before as-of.
- `DEMAND_SPIKE`: d28 > 0 and d7 / d28 ≥ 2.

Return `{ d7, d28, baseline, ml, method, methodReason, avgDailyDemand, windowDays: { short: 7, long: 28 }, flags, dailySeries, forecast14 }` (`dailySeries` = last 28 days for the chart, `forecast14` = the ML forecast for the next 14 days). The method is the SKU's default (6.2a) unless a Demand Agent decision overrides it (9.5). With no model trained yet, the method is always the baseline.

### 6.2a ML demand model (`lib/ml/`)

The synthetic sales have learnable structure the baseline ignores: weekday factors (from the reference profile), about 15% growing SKUs (+1%/day), about 15% declining (−1%/day), about 20% intermittent (many zero days) and about 10% with a 5-day ×3 spike. The model learns it; the backtest proves whether it helps.

- **Model:** one **global ridge regression** (all SKUs pooled) predicting packs sold on day t.
- **Features per (SKU, t)**, from days before t only: `lag1`, `lag7`, `mean7`, `mean28`, `std28`, `zeroShare28`, OLS trend slope over the last 28 days, day-of-week one-hot (6 columns, Monday is the reference), category one-hot. Features are standardised (store `means` and `stds`); the target is not.
- **Fit:** closed form, w = (XᵀX + λI)⁻¹ Xᵀy, solved with Cholesky in `ridge.ts` (plain numbers; this is demand, not money). The intercept is not penalised. λ is picked from the fixed grid [0.1, 1, 10, 100] by the lowest WAPE on a validation slice (the 14 days before the holdout) → fully deterministic: same data, same coefficients.
- **Train / holdout:** train on every day except the last 14 (holdout); then refit on the chosen λ with all training days.
- **Backtest per SKU:** from the holdout start, forecast the 14 holdout days **recursively** (each prediction feeds the next day's lags) and compute WAPE = Σ|actual − forecast| / Σ actual for ML and for the baseline (the baseline value computed at the holdout start, held flat). A SKU with Σ actual = 0 gets WAPE `null` and uses the baseline.
- **Default method rule (deterministic):** use **ML** if the SKU has ≥ 28 days of history **and** its ML WAPE is at least 5% (relative) lower than its baseline WAPE (`mlWape ≤ 0.95 × baselineWape`); otherwise the **baseline**. The reason is recorded ("ML error 18% vs average 27% on the last 14 days → ML", or the reverse).
- **Forecast at plan time (live):** `loadPlanningContext` loads the last 56 days of sales and the latest stored model; inference is cheap, so the recursive 14-day forecast runs on the **current** context's sales (scenarios such as `seasonal_surge` and `demand_spike` therefore change it). `mlDaily` = mean of those 14 days (never below 0). `SkuContext.forecast` = `{ mlDaily, baselineDaily, mlWape, baselineWape, defaultMethod, series14 }`.
- **Storage:** `forecast_models` + `sku_forecast_metrics` (section 4). `npm run train:forecast` trains, backtests and stores a new model (audit `model.trained` with the global metrics); `npm run seed` runs it at the end.
- **Evidence:** every line stores both values, both WAPEs, the method, the reason and who chose it (`default` or `demand-agent`).
- **Honesty rule:** if ML does not beat the baseline for a SKU, the system says so and uses the baseline. The UI never claims accuracy the backtest does not show; every model view is labelled "trained on synthetic demo data".


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
confirmedIncoming = Σ quantity_packs (+ free_qty) of lines on POs with status 'open' (seeded) or 'sent' (PharmaOS, simulated)
                    and expected_delivery_date ≤ asOf + 14 days
stockPosition     = eligibleAvailable + confirmedIncoming
```
(Reserved stock is subtracted once, inside `available`. PharmaOS POs count as incoming from the moment they exist (`open`, `ready`, `pending_approval`, `approved`, `sent`), each on its expected delivery date, so a new plan never re-orders what an earlier plan already ordered; `rejected` and `received` POs do not count — a received PO's stock is already on hand.)

For a given lead time L (days) and review period R = 14 (about three weeks of stock at target, a mid-size stockist's practice):
```
cover   = days until stock runs out, each PO on its delivery day (= stockPosition / d̄ with no gap)   only if d̄ > 0
safety  = max(2, d̄ × 5)
ROP     = d̄ × L + safety
target  = d̄ × (L + R) + safety
reorderInDays = max(0, (stockPosition − ROP) / d̄)   rounded down to 0.1 day; null if d̄ = 0
orderBy       = asOf + ⌊reorderInDays⌋               the date stock reaches the reorder point at forecast demand
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
if the SKU has at-risk batches AND status ≠ STOCKOUT_RISK:
     qRaw = max(0, ROP(L_offer) − stockPosition)                     reason EXPIRY_REDUCED_QTY
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

**Why stockout lines are never reduced (decided at P11 review):** a medicine about to run out must not be under-ordered, and under FEFO the new, long-dated stock sells after the old at-risk batch, so ordering less would not save that batch anyway. For the same reason a reduced quantity is not counted as "expiry avoided" on the Impact Card.

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
```
Free goods are a separate quantity at ₹0; percentage-discount schemes are not modelled (state this in the UI assumptions).

### 6.8 Priority: loss prevented per rupee (`priority.ts`)

```
shortfallDays  = max(0, L − cover)
lossPrevented  = shortfallDays × d̄ × unit_margin × w_crit       w_crit: life_saving 2, chronic 1.5, acute 1, otc 0.7
priority       = lossPrevented / lineTotal                       lineTotal > 0
```
Sort key (deterministic): priority desc → cover asc → w_crit desc → sku asc. Lines with priority 0 (below ROP but not urgent) therefore follow urgent lines in order of lowest cover. Priority only orders the plan (most urgent first); it never removes a line.

### 6.9 Plan assembly and PO projection (`engine.ts`)

There is **no purchase budget**. Every SKU that needs stock and has an eligible offer becomes a plan line at the engine's quantity (`in_basket = true`), in the §6.8 sort order. SKUs that need stock but have no eligible offer are appended (`in_basket = false`, reason `NO_ELIGIBLE_OFFER`, never bought).

Spend control is the **Owner approval limit**, applied per purchase order, not per plan:
```
supplierTotals = for each supplier of counted lines (in_basket and status proposed / edited / approved_for_po):
                   { supplierId, supplierCode, lines, total = Σ lineTotal, needsApproval = total > poApprovalLimit }
poApprovalLimit = app_state.po_approval_limit        default ₹10,00,000; strictly above needs approval (= ₹10,00,000 does not)
```
The projection uses the same totals as the POs that approval creates (one PO per supplier; grand total incl. GST and freight). It is a workflow gate on **sending** a PO (§7.6), not a hard stop. Tested: a supplier total of exactly ₹10,00,000.00 → `needsApproval = false`; ₹10,00,000.01 → `true`.

### 6.10 Plan Impact Card (`impact.ts`)

| Field | Definition |
|---|---|
| `skusAtRisk` | count of SKUs with status `STOCKOUT_RISK` (whole catalogue) |
| `stockoutsCovered` | counted lines whose SKU status is `STOCKOUT_RISK` |
| `marginProtected` | Σ lossPrevented of counted lines |
| `expiryExposure` | Σ atRiskValue of all batches (current stock) |
| `expiryAvoided` | Σ expiryAvoidedValue of counted lines with `SCHEME_SKIPPED_EXPIRY` (free goods not taken because they would have expired). Reduced quantities (`EXPIRY_REDUCED_QTY`) are **not** counted |
| `totalSpend` | planTotal |
| `poCount` | number of projected supplier POs (`supplierTotals.length`) |
| `posNeedingApproval` | projected POs with total > `po_approval_limit` |
| `excludedCount`, `excludedRisk` | count and Σ lossPrevented of lines not in the plan total: no eligible offer, or owner deferred / rejected |
| `lossPreventedPerRupee` | (marginProtected + expiryAvoided) / planTotal; null when planTotal = 0 |

The plan result also carries `supplierTotals` (§6.9), shown as the supplier PO strip on the plan screen.

### 6.11 Validation (`validation.ts`)

**Hard stops** (approval of a line is refused; plan approval refused if any selected line has one):
`INVALID_SKU` · `SUPPLIER_NOT_APPROVED` · `QUOTE_EXPIRED` · `QUOTE_STALE` · `MISSING_PRICE` · `INVALID_PACK_MULTIPLE` (q % pack_multiple ≠ 0) · `BELOW_MOQ` · `ABOVE_AVAILABILITY` · `NON_POSITIVE_QTY` · `PRODUCT_RECALLED` (any batch of the SKU is `recalled` → human review).

**Soft warnings** (allowed; overriding them requires a note): `AT_RISK_BATCHES` · `NOT_TOP_SUPPLIER` · `LOW_HISTORY` · `DEMAND_SPIKE` · `SCHEME_EXCESS_RISK` · `PRICE_ANOMALY` · `CAPACITY_REVIEW`.

### 6.12 `engine.ts`

- `analyseSku(input, config) → SkuAnalysis` — demand, expiry, stock position, every offer evaluated (eligibility, q, effective cost, factors, score), chosen offer, line totals, priority, reasons, warnings, status, and `evidence` (all inputs and intermediates, ready for `evidence_json`).
- `buildPlan(context, config, { poApprovalLimit }) → PlanResult` — runs `analyseSku` for every active SKU, keeps every candidate, sorts, appends no-offer lines, projects supplier POs, computes impact, assigns `rank` (1 = top).
- Pure and deterministic: same input → byte-identical output (tested).

### 6.13 Heatmap and put-away (`heatmap.ts`, `putaway.ts`)

Per bin, from the SKUs and batches it holds:
| Mode | Bin is highlighted when | Value shown |
|---|---|---|
| `stockout` | any SKU in the bin has status `STOCKOUT_RISK` | lowest cover (days) |
| `expiry` | any batch in the bin has `atRiskQty > 0` or is expired | earliest expiry, at-risk qty |
| `excess` | any SKU in the bin has status `EXCESS` | stock ÷ target |
| `normal` | — | fill % = on hand ÷ capacity |
| `proposed` | bin is the candidate put-away bin of a counted plan line | proposed packs (paid + free) |

Each bin also gets a severity 0–3 so the legend and colour never carry meaning alone (text label in the panel).

Candidate bin (deterministic): active bins with matching `storage_class` and `capacity_units − Σ on_hand ≥ proposed packs`; prefer (1) a bin already holding the SKU, (2) the same aisle as existing stock, (3) lowest `bin_code`. None fits → `CAPACITY_REVIEW`, no location invented.

---

## 7. Services (`lib/services/`)

### 7.1 `loadPlanningContext(sql, asOf, scenarioId)`

One function that reads, with a fixed set of queries, everything the engine needs: active products, approved/pending/blocked suppliers, active offers, the last 56 days of sales (28 for the baseline, 56 for the ML features; plus first-sale date per SKU), the latest demand model and per-SKU metrics, released and non-released batches with balances, open POs within the horizon. Then `applyScenario(context, scenario)` (section 12) modifies it **in memory**, and the ML forecast is computed from the resulting sales (section 6.2a). Returns plain objects (money as strings).

### 7.2 `createPlan({ priorities? })`

1. `asOf`, active scenario and `po_approval_limit` from `app_state` (one round trip).
2. `result = buildPlan(context, { ...ENGINE_CONFIG, poApprovalLimit })` (limit from `app_state.po_approval_limit`) — every candidate, no budget.
3. In one transaction: insert `purchase_plans` (totals, `assumptions_json` = ENGINE_CONFIG + asOf + scenario + approval limit + priorities, `impact_json` incl. `supplierTotals`), insert all recommendation rows, write audit `plan.created`.
5. Return the plan id. Target: < 3 s for 500 SKUs.

### 7.3 `editLine(planId, lineId, change, { preview })`

`change` = one of: `{ qty }`, `{ offerId }`, `{ status: 'deferred' | 'rejected', reason }`, `{ status: 'proposed' }` (restore), `{ note }`.
1. Load plan + line; refuse if plan `rejected`/`approved` or line `approved_for_po` (409 `LINE_LOCKED`).
2. Rebuild that SKU's analysis from fresh context; apply the change; validate (qty multiple of pack_multiple, ≥ MOQ, ≤ available; offer must be eligible for the same product).
3. Recompute line totals, plan total, supplier PO projection and impact (a supplier crossing the approval limit shows up in the preview).
4. `preview: true` → return before/after without saving (used to show the new total before saving).
5. Else save (status → `edited`, or the requested status), update plan totals + impact, audit `line.edited` / `line.deferred` / `line.rejected` / `line.restored` with before/after.

### 7.4 Status lifecycles

- Recommendation: `proposed → edited → approved_for_po`; `proposed|edited → deferred | rejected`; `deferred|rejected → proposed` (restore).
- Plan: `draft → partially_approved → approved`; `draft|partially_approved → rejected`. Rejected creates no POs.
- PO (PharmaOS): created as `ready` (grand total ≤ limit) or `pending_approval` (> limit); `pending_approval → approved | rejected` (Owner); `ready | approved → sent` (simulated). Export CSV / Print never change the status. Seeded external POs: `open | received | cancelled`.

### 7.5 `recalculatePlan(planId)`

Rebuild the same plan with fresh context, the active scenario and the current approval limit. Lines `approved_for_po` are frozen; `rejected` lines stay rejected; owner-`deferred` lines stay deferred; `edited` lines keep the owner's qty/offer at fresh prices (if one now fails a hard stop it stays `edited` but is not counted — `in_basket = false`, `defer_reason` = the code — and is retried on the next recalculation); every other line is recomputed (SKUs that no longer need stock drop out, new ones are added). Audit `plan.recalculated` with before/after totals and the lines added / removed.

### 7.6 `approveLines(planId, lineIds, idempotencyKey, actor)` — the only PO writer

`actor` = `{ type: 'user', id: DEMO_USER }` from the approve route, or `{ type: 'agent', id: 'order-agent' }` from the pipeline's Order Agent (section 9.5, `idempotencyKey` = the run id). It is the same function and the same checks for both; the actor is stored in `approved_by` and the audit rows. The Order Agent calls `validate_po` first and passes only lines without hard stops; if a 422 still comes back, it drops those lines and retries once.

In **one transaction**:
1. `select … from purchase_plans where id = $1 for update`.
2. If any `purchase_orders` row has this `idempotency_key` → return those POs with `alreadyProcessed: true` (no new rows).
3. Load the selected lines; each must be `in_basket` (buyable), status `proposed` or `edited`, not already linked to a PO line.
4. Re-run the SKU analysis and **all hard stops** with fresh data; any failure → abort with 422 and the list of `{ lineId, codes[] }`.
5. Group lines by supplier. For each supplier insert a `purchase_orders` row: `po_number = 'PO-' || to_char(now(),'YYYYMMDD') || '-' || nextval('po_number_seq')`, status `pending_approval` if grand_total > `po_approval_limit` else `ready`, totals = Σ line amounts (same totals function), `expected_delivery_date = asOf + max lead time of its lines`, `source_plan_id`, `idempotency_key`, `approved_by` (the actor id), `approved_at` (who approved the plan lines).
6. Insert PO lines (copy qty, free qty, price, tax, amounts, `recommendation_id`).
7. Update recommendations → `approved_for_po`; insert `approvals`; update plan status; audit `po.created` per PO (with its status) and `plan.lines_approved`.
8. Return the POs (each with `needsApproval`). A second identical request returns the same POs (unique constraints are the final guard).

### 7.6a Owner approval and sending (`purchase-orders.ts`)

- `approvePo(poId, { note? }, userId)`: only from `pending_approval` → `approved`; `approvals` row (entity `purchase_order`, decision `approved`); audit `po.approved`. Other states → 409 `PO_LOCKED`.
- `rejectPo(poId, reason, userId)`: only from `pending_approval` → `rejected` (reason ≥ 3 chars); approvals row; audit `po.rejected`. Its recommendation lines stay `approved_for_po` (they are not re-planned automatically).
- `sendPo(poId, userId)`: only from `ready` or `approved` → `sent`, `sent_at = now()`, `sent_by`; audit `po.sent`. From `pending_approval` → 409 `APPROVAL_REQUIRED` ("This PO is above ₹10,00,000 and needs Owner approval before it can be sent"); `sent` / `rejected` → 409 `PO_LOCKED`. **Simulated:** nothing leaves the app (no email, no API call); the UI says "Marked as sent — simulated, nothing was emailed". A `sent` PO counts as confirmed incoming stock in later plans.
- The approval check reads the PO's stored status, which was set from its grand total at creation; the limit applies at creation time (changing the limit later does not re-gate existing POs).

### 7.7 Other services

- `rejectPlan(planId, reason)`: status `rejected`, `reject_reason`, approval row, audit. No POs.
- `dashboard.getCommandCenter()`: approval limit (app_state), latest plan's proposed spend, count `STOCKOUT_RISK`, Σ expiry exposure, lines awaiting PO (in-plan lines not yet approved on non-rejected plans), POs awaiting Owner approval (`pending_approval`), top 8 critical SKUs.
- `purchase-orders.exportPo(poId)`: builds CSV, audit `po.exported`; works in any status and does not change it. Print view uses the same data.
- `explain.explainLine(evidence)`: deterministic sentences, e.g. *"Ordering 90 packs from SUP-03 because stock covers 4.3 days and SUP-03 delivers in 2 days. SUP-01 is 6% cheaper but takes 7 days, which is after the projected stockout."*

---

## 8. API (route handlers)

All bodies validated with Zod (`lib/validation/api.ts`). Errors return `{ error: { code, message, details? } }` with the status below. Success returns JSON.

| Method & path | Body / query | Success | Errors |
|---|---|---|---|
| `GET /api/dashboard` | — | Command Center metrics | 500 |
| `POST /api/procurement/analyze` | `{ priorities?: string }` | `{ planId }` (201) | 400 validation |
| `GET /api/purchase-plans/[id]` | — | plan + lines + impact | 404 |
| `PATCH /api/purchase-plans/[id]/lines/[lineId]` | `{ qty? , offerId?, status?, reason?, note?, preview?: boolean }` (exactly one change) | `{ before, after, plan }` | 400 validation and hard-stop codes, 409 `LINE_LOCKED`, 404 |
| `POST /api/purchase-plans/[id]/recalculate` | `{}` | plan | 404, 409 `PLAN_LOCKED` |
| `POST /api/purchase-plans/[id]/approve` | `{ lineIds: uuid[] (≥1), idempotencyKey: uuid }` | `{ purchaseOrders (status `ready` / `pending_approval`), alreadyProcessed }` | 422 hard stops, 409 locked |
| `POST /api/purchase-plans/[id]/reject` | `{ reason: string (≥3) }` | plan | 409 |
| `POST /api/purchase-plans/[id]/lines/[lineId]/explain` | — | `{ text, source: 'agent' | 'deterministic' }` | 404 |
| `GET /api/purchase-orders` / `GET /api/purchase-orders/[id]` | — | POs / PO with lines | 404 |
| `POST /api/purchase-orders/[id]/approve` | `{ note?: string }` | PO (`approved`) | 404, 409 `PO_LOCKED` |
| `POST /api/purchase-orders/[id]/reject` | `{ reason: string (≥3) }` | PO (`rejected`) | 400, 404, 409 `PO_LOCKED` |
| `POST /api/purchase-orders/[id]/send` | — | PO (`sent`, simulated) | 404, 409 `APPROVAL_REQUIRED` / `PO_LOCKED` |
| `GET /api/purchase-orders/[id]/receive` · `POST /api/purchase-orders/[id]/receive` | — · `{ lines: [{ lineId, qty (0 … ordered + free), batchNumber, expiryDate (≥ as-of + 90 d), binId }], note? }` | receipt draft (full quantities, batch numbers, suggested bins) · `{ status: 'received', packs, shortLines, bins }`; creates batches and stock balances, audit `po.received` | 404, 409 `PO_NOT_RECEIVABLE` (only `sent` or seeded `open`), 422 `RECEIPT_INVALID` (per-line problems) |
| `POST /api/purchase-orders/[id]/export` | — | `text/csv` download (status unchanged) | 404 |
| `PATCH /api/settings` | `{ poApprovalLimit: number>0 }` | settings | 400 |
| `GET /api/warehouse/layout` | — | bins with geometry | — |
| `GET /api/warehouse/heatmap?mode=` | `mode ∈ stockout|expiry|excess|normal|proposed`, `planId?` | `{ bins: [{ binId, severity, label, value }] }` | 400 |
| `GET /api/warehouse/bins/[id]` | — | bin + balances + batches + SKU status | 404 |
| `GET /api/products/search?q=` | `q` ≥ 2 chars | up to 20 SKUs with their bins | 400 |
| `GET /api/scenarios` · `POST /api/scenarios/[id]/run` · `POST /api/scenarios/reset` | — | active scenario | 404 |
| `POST /api/agent/chat` | `{ message: string (1–2000), planId?: uuid }` | `{ reply, toolCalls: [{ name, ok }], references: [{ type, id, label }], source }` | 503 never — falls back |
| `POST /api/agents/run` | `{ planId: uuid, maxSkus?: 1–30 (default 15) }` | `{ runId }` (202; runs in the background) | 404, 409 `RUN_IN_PROGRESS`, 409 plan locked |
| `GET /api/agents/runs/[id]` | — | run + steps (polled every 2 s while running) | 404 |
| `GET /api/agents/runs?planId=` | — | past runs for a plan, newest first | — |
| `GET /api/audit?limit=&before=` | pagination | audit rows | — |

UI reads go through server components calling services directly; UI mutations call these routes then `router.refresh()`.

---

## 9. AI orchestrator (`lib/agents/`)

### 9.1 Where the AI shows up (dashboard, not chatbot)

1. **Create Purchase Plan** — the plan is built deterministically; if the key is set, the agent then writes a 3–5 sentence plan summary from the plan's tool output (stored in `assumptions_json.summary`).
2. **Why?** on each line → `/explain` → agent explanation grounded in that line's evidence; deterministic text if the LLM fails.
3. **Ask PharmaOS** side panel on the plan screen: requests such as "which supplier POs will need Owner approval, and why?", "why Supplier B instead of A for Paracip 650?", "show where this SKU is stored".

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
| `get_po_projection` | `{ planId }` | projected PO per supplier, total, and whether it is above the ₹10,00,000 Owner approval limit |
| `get_plan` | `{ planId }` | lines (rank, sku, qty, supplier, total, status, reasons) + impact |
| `build_plan_preview` | `{}` | **preview only** (not saved) of a fresh plan on the current context |
| `recalculate_plan` | `{ planId }` | runs `recalculatePlan` (a saved, audited change, actor `agent`) |
| `validate_po` | `{ planId, lineIds }` | hard stops / warnings per line (no writes) |
| `get_bin_details` | `{ binCode }` | bin contents |
| `get_heatmap_metrics` | `{ mode }` | top 20 highlighted bins |
| `suggest_candidate_bin` | `{ sku, packs }` | candidate bin or `CAPACITY_REVIEW` |

Not exposed to the Ask PharmaOS agent, by design: approve lines, reject, create/update PO, Owner-approve a PO, send a PO, change the approval limit, any SQL. Creating POs is available to exactly one AI — the pipeline's Order Agent (section 9.5) — and no AI anywhere can send a PO, Owner-approve a PO, reject a plan or change the approval limit.

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
  lines with the Approve button, that any PO above the Owner approval limit (get_po_projection
  gives it) needs the Owner's approval before it can be sent, and that sending is simulated:
  nothing leaves the app.
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

### 9.5 Agent pipeline (`lib/agents/pipeline/`) — three agents that decide

**Pitch:** *The engine and the ML model calculate, three agents decide within guardrails, a human sends and the Owner approves large orders.* The agents are not narrators: each makes decisions that change the plan or create POs, and every decision passes a code guardrail before it takes effect.

- **Trigger:** "Run procurement agents" on the plan screen (and on the Command Center for the latest plan) → `POST /api/agents/run { planId, maxSkus? }` → inserts `agent_runs` (status `running`) and returns `{ runId }` immediately; the run executes in the background with `after()` from `next/server`. One running run per plan (409 `RUN_IN_PROGRESS`). The UI polls `GET /api/agents/runs/[id]` every 2 s.
- **SKU selection:** the top N plan lines by rank with status `proposed` (not edited, deferred, rejected or on a PO). N = `maxSkus` (1–30, default 15).
- **Loop:** each agent is one Gemini session running the same manual function-calling loop as 9.4 (mode `AUTO`, automatic function calling disabled, `candidate.content` appended unchanged, all functionResponses in one user turn in call order, every `call.args` Zod-validated, max 12 turns, 45 s deadline per call; a call unanswered after 10 s is raced against the backup model `gemini-flash-latest`, transient errors retried twice; the whole run stops cleanly at 270 s). It handles **all** selected SKUs, sees **only its own tools**, and must finish by calling exactly **one terminal `submit_*` tool** whose arguments are Zod-validated. Agents hand off through the database (the plan lines), not through free text: the Demand Agent's chosen forecast is saved on each line first, so the Supplier Agent compares offers for that forecast and the Order Agent orders the resulting quantities. Every tool call and decision is written to `agent_steps` (input, output, ok, ms).

| Agent | Tools | Terminal tool | Guardrail (code) | Effect |
|---|---|---|---|---|
| **Demand Agent** | `get_sales_history`, `get_demand_forecasts {sku}` (baseline, ML, both WAPEs, default method, flags, 14-day ML series), `get_inventory_position` | `submit_demand_decisions { decisions: [{ sku, method: 'ml' \| 'baseline', reason (≥ 10 chars) }] }` | The agent picks a **method**, never a number: d̄ = that method's tool value. Unknown SKU or a SKU outside the run → rejected step | For each decision that differs from the line's current method, the SKU is re-analysed with that method and the line updated (qty, totals, `evidence.demandDecision { method, reason, by: 'demand-agent' }`); audit actor_type `agent`, actor_id `demand-agent`, action `agent.demand_decided` |
| **Supplier Agent** | `compare_supplier_offers {sku, planId}` (re-analyses the SKU with the line's **current demand method** — the one the Demand Agent chose — so every offer's quantity, availability check, urgency/cover rule, scheme and totals reflect that forecast), `get_po_projection`, `get_approval_limit` | `submit_supplier_decisions { decisions: [{ sku, offerId, reason }] }` | The offer must have **no exclusion codes** and pass every hard stop for the line's quantity (same validation as `editLine`); otherwise the decision is rejected and logged and the line keeps its offer | Applied through `editLine` with actor `supplier-agent` (action `line.edited`, reason = the agent's reason, `evidence.supplierDecision`). It may trade speed for price, consolidate SKUs onto one supplier to save freight, or keep a supplier PO under the ₹10,00,000 Owner limit |
| **Order Agent** | `get_plan`, `validate_po { lineIds }`, `create_purchase_orders { lineIds }` | `submit_order_summary { created: [poId], skipped: [{ sku, reason }] }` | `create_purchase_orders` calls `approveLines` with actor `order-agent` and `idempotencyKey` = the run id (a retry never duplicates POs); lines with hard stops are skipped with their codes | POs created as `ready` (≤ limit) or `pending_approval` (> limit). It can **never** send a PO, Owner-approve a PO, reject a plan or change the approval limit — those tools do not exist for any AI |

- **Fallback:** no `GEMINI_API_KEY`, API error, timeout, non-`STOP` finish, or an invalid terminal call after 2 retries → the Demand and Supplier agents fall back to the deterministic defaults (no changes, a `fallback` step); the Order Agent in fallback creates **no** POs and reports "AI unavailable — review and approve manually". The run ends with status `fallback`, and the UI says so plainly.
- **Run status:** `succeeded` when all three agents end with a valid terminal call; `failed` only on an unexpected server error (the error is stored). `summary` lists lines changed and POs created (with which need Owner approval).
- **Tests:** guardrails (a number instead of a method → rejected; an excluded or ineligible offer → rejected; an unknown tool → rejected; `create_purchase_orders` twice with the same run id → the same POs) and a fake Gemini client (scripted function calls) so the whole pipeline runs end to end in Vitest without the network.
- The Ask PharmaOS agent (9.1–9.4) stays read-only plus `recalculate_plan`; it does **not** get `create_purchase_orders`.

---

## 10. UI

PharmaOS is a web dashboard: a left sidebar, a top bar and data-dense screens (tables, cards, a 3D panel) laid out for desktop browsers. Build every screen for 1280 px and wider first, and make sure it still works at tablet width (≥ 768 px: the sidebar collapses to icons, wide tables scroll horizontally inside their card). Phone layouts are out of scope.

### 10.1 Design system — premium quality bar

**Goal:** the dashboard must look like a funded B2B product, not a hackathon template. Reference quality: Linear, Vercel dashboard, Stripe dashboard, Ramp. Calm, dark, precise, data-dense; one accent colour; every pixel aligned. Judges decide in the first 10 seconds, so the first screen must already look finished.

#### Principles
1. **Restraint.** One accent (teal). Colour is used for meaning (status, selection, the primary action), never for decoration.
2. **Hierarchy through type and space**, not boxes and borders. Big numbers, small quiet labels.
3. **Depth through layered surfaces**, not drop shadows: page → surface → raised surface, each one step lighter, with hairline borders.
4. **Numbers are the product.** Tabular figures, right-aligned, Indian digit grouping (₹2,00,000), consistent decimals.
5. **Motion explains change** (a total updating, a drawer opening), short and subtle. Nothing bounces.
6. **Finished states everywhere:** loading skeletons shaped like the content, designed empty states, clear errors.

#### Colour tokens (`app/globals.css`, mapped onto the shadcn variables; dark is the only theme)

| Token | Value | Use |
|---|---|---|
| `--bg` | `#070B14` | page background |
| `--surface-1` | `#0D1424` | cards, sidebar, tables |
| `--surface-2` | `#121B2F` | raised: popovers, drawer, table header, inputs |
| `--surface-3` | `#18233A` | hover and selected rows |
| `--border` | `#1C2740` | hairline dividers (1 px) |
| `--border-strong` | `#2A3954` | inputs, focused cards |
| `--text-1` | `#E6EDF7` | primary text and numbers |
| `--text-2` | `#94A3B8` | secondary text, column headers |
| `--text-3` | `#5B6B85` | tertiary: captions, axis labels, placeholders |
| `--accent` | `#2DD4BF` | brand, focus ring, selected, links |
| `--accent-strong` | `#14B8A6` | primary button background |
| `--accent-glow` | `rgba(45, 212, 191, 0.10)` | hero card glow, selected row tint |
| `--stockout` | `#F87171` on `rgba(248,113,113,0.12)` | stockout risk |
| `--expiry` | `#FBBF24` on `rgba(251,191,36,0.12)` | expiry risk |
| `--excess` | `#A78BFA` on `rgba(167,139,250,0.12)` | excess stock |
| `--healthy` | `#34D399` on `rgba(52,211,153,0.12)` | healthy / approved |
| `--neutral` | `#94A3B8` on `rgba(148,163,184,0.10)` | deferred, info |
| `--proposed` | `#22D3EE` at 35% opacity | ghost / proposed stock (3D) |

Contrast: all text ≥ WCAG AA on its surface. Status is always **dot + label** (never colour alone).

#### Typography (Geist Sans for UI, Geist Mono for SKU codes, IDs and formulas — both already loaded)

| Role | Size / line | Weight | Notes |
|---|---|---|---|
| Hero number (Impact Card, KPI) | 32 / 36 | 600 | `tabular-nums`, tracking −0.02em |
| Page title | 22 / 28 | 600 | tracking −0.01em |
| Section title | 15 / 22 | 600 | |
| Body / table | 13.5 / 20 | 400 | the default size: dense but readable |
| Label (micro) | 11 / 16 | 500 | UPPERCASE, tracking 0.06em, `--text-3` |
| Mono (SKU, PO no., formula) | 12.5 / 18 | 450 | Geist Mono |

Money: `formatINR()` → "₹2,00,000" (no paise on KPI tiles, paise in tables and POs). Dates: "21 Oct 2026". Days of cover: one decimal ("4.3 d").

#### Space, shape, elevation
- 4 px grid. Page padding 32 px (24 px at tablet). Card padding 20 px. Gaps 16 / 24 px. Content max-width 1440 px, centred.
- Radius: 8 px controls, 12 px cards, 16 px hero card; status pills fully rounded.
- Surfaces: `--surface-1` with a 1 px `--border` and a top inner highlight `inset 0 1px 0 rgba(255,255,255,0.04)`. No large drop shadows; popovers/drawer get one soft shadow `0 12px 32px rgba(0,0,0,0.45)`.
- **One signature gradient only:** the Plan Impact Card and the Command Center hero get a faint radial teal glow (`--accent-glow`) from the top-left corner. No other gradients.

#### Layout
- Sidebar 240 px (`--surface-1`), collapsible to a 64 px icon rail (and auto-collapsed below 1024 px). Logo mark + wordmark at the top; nav items 36 px tall, 16 px lucide icons (stroke 1.75), active item = `--surface-3` background + 2 px accent bar on the left; data-source badge and demo user pinned at the bottom.
- Top bar 56 px, sticky, `--bg` at 80% with `backdrop-blur`, hairline bottom border: breadcrumb/page title left; scenario chip, as-of date, "Approval above ₹10,00,000" right.
- Page header: title + one-line description + primary action on the right.

#### Components
- **Buttons:** primary = `--accent-strong` bg, dark text, 36 px; secondary = `--surface-2` + border; ghost for row actions. One primary button per view.
- **KPI tile:** micro label, hero number (count-up on first load), a one-line context ("12 below reorder point"), and a sparkline **only when backed by real data** (e.g. 28-day sales). No fake trends.
- **Status pill:** 6 px dot + label, tinted background from the status table, 22 px tall.
- **Tables:** 44 px rows, sticky header on `--surface-2`, micro-label headers, hairline row dividers, hover `--surface-3`, selected row = accent-glow tint + 2 px accent left edge; numbers right-aligned and tabular; SKU in mono with brand/strength as a second line in `--text-2`; row actions appear on hover.
- **Drawer (line detail):** 560 px wide, `--surface-2`, slides from the right (220 ms); sticky header with SKU, status pill and Edit controls; sections separated by space and micro labels, not boxes.
- **Formula panel:** each formula on one line in mono, with the real values substituted and the result highlighted in `--text-1` ("ROP = 9.2 × 4 + 27.6 = **64.4**").
- **Charts (Recharts):** no chart junk — faint horizontal gridlines only, axis text 11 px `--text-3`, teal line 2 px with an area fill fading from 20% to 0%, reference lines dashed for d7/d28/d̄, custom tooltip card on `--surface-2`.
- **Toasts (sonner):** dark, bottom-right, icon + one line + optional link.
- **Empty states:** 40 px icon in a soft circle, one line of explanation, one action. **Errors:** what happened + what to do + Retry. **Loading:** skeletons with the same layout as the content, subtle shimmer.

#### Motion (CSS transitions + `tw-animate-css`, already installed; no new library)
- 150 ms ease-out for hover/focus; 220 ms for drawers and dialogs; KPI and Impact Card numbers count up once (≤ 600 ms); supplier PO chips update smoothly when totals change.
- Recalculated values flash a faint accent background for 600 ms so the eye sees what changed.
- Respect `prefers-reduced-motion` (no count-up, no shimmer).

#### Brand
- Logo mark: a 24 px rounded square with a teal gradient (`#2DD4BF` → `#0EA5A4`) and a simple white glyph (a capsule crossed with a check), inline SVG in `components/layout/Logo.tsx`; also used as `app/icon.svg` (favicon). Wordmark "PharmaOS" in Geist 600.
- Browser title: "PharmaOS · <page>".

#### Signature moments (polish these most — they are the demo)
1. Command Center hero: at-risk SKUs, ₹ at expiry risk and POs awaiting Owner approval, with the **Create Purchase Plan** button.
2. Plan Impact Card with counting numbers and the supplier PO strip (Owner approval badge above ₹10,00,000).
3. A ranked plan table that reads like a decision list (reason chips, Why? on hover).
4. The line drawer: demand chart + supplier comparison + live formulas.
5. The 3D warehouse: dark scene, soft lighting, emissive heatmap bins, smooth camera fly-to.

#### Don'ts
No emoji, no stock illustrations, no gradients on ordinary cards, no glassmorphism except the top bar, no more than one accent, no default unstyled shadcn look, no lorem ipsum, no placeholder numbers, no layout shift when data loads.

#### Visual QA (every UI prompt)
Before committing a UI step: run the dev server, take a screenshot at **1440 × 900** and at **1024 × 768**, and check it against this section (alignment, spacing, contrast, states, no overflow, numbers formatted). Fix what fails before the commit.

### 10.2 Shell (`app/(dashboard)/layout.tsx`)

- Left sidebar (lucide icons, see §10.1 Layout): logo + wordmark; Command Center `/`, Procurement `/procurement`, 3D Warehouse `/warehouse`, Purchase Orders `/purchase-orders`, Activity Log `/activity`, Data & Scenarios `/data`; `DataSourceBadge` ("Synthetic demo data") and demo user at the bottom.
- Top bar (sticky, blurred): page title / breadcrumb; active scenario chip (if not baseline), as-of date, "Approval above ₹10,00,000" (from `app_state.po_approval_limit`).
- `<Toaster />` (sonner) in the root layout.

### 10.3 Screens

**Command Center (`/`)**
- KPI tiles: Proposed spend (latest plan) · SKUs at stockout risk · ₹ expiry exposure · Lines awaiting PO · POs awaiting Owner approval.
- Critical SKUs list (top 8 by status/cover): SKU, cover days, lead time, status badge, "Open in plan" / "Locate" links.
- **Reorder in the next 7 days** (forward-looking): SKUs not urgent yet whose `reorderInDays` (6.4) ≤ 7, soonest first — SKU, order-by date ("Order today" / "Order tomorrow" / "in N days"), stock position, forecast demand per day with its method (ML / avg), fastest lead time, "Locate".
- Primary CTA **Create Purchase Plan** → dialog (optional priority text only; no budget) → `POST /api/procurement/analyze` → navigate to the plan.

**Procurement list (`/procurement`)**: table of plans (created, total, lines, POs needing approval, status, scenario) + Create button.

**Procurement Plan (`/procurement/[planId]`)**
- Top: **Plan Impact Card** (section 6.10 fields, large numbers, one line of explanation each) + **supplier PO strip**: one chip per supplier with its projected PO total, an amber "Owner approval" badge when above ₹10,00,000.
- Plan table (sorted by rank): checkbox, rank, SKU (brand, strength, pack), status badge, cover (days), qty (+ free), supplier code, effective cost/pack, lead time, line total, flags (icons with tooltips), reason (short), actions (Why?, Edit, Defer, Reject).
- "Not in this plan" section below: owner-deferred / rejected lines (with reason and ₹ risk, "Restore" action) and SKUs with no eligible offer.
- Footer bar: selected count and total → **Approve selected** (generates a fresh `idempotencyKey` with `crypto.randomUUID()` when the dialog opens; button disabled while the request runs) → confirmation dialog listing POs per supplier and marking which will need Owner approval (> ₹10,00,000) → success toast with links.
- **Reject plan** (reason required).
- **Recalculate** (plain button: fresh data and the active scenario).
- **Run procurement agents** (section 9.5) → **Agent Run** panel (Sheet, 640 px): three agent cards in order with status (waiting / thinking / done / fallback), the tool calls as a timeline (tool name, ok, ms, one-line result), the decisions table (SKU, decision, reason, accepted or rejected by the guardrail), and the results (lines changed → drawer links, POs created → PO links, which need Owner approval). Live by polling; finished runs stay viewable under "Past runs".
- **Ask PharmaOS** side panel (Sheet): message box, replies with references rendered as links.
- Line drawer (`?line=<id>`, Sheet): product identity; demand chart (28 days, Recharts) with d7/d28/d̄; stock breakdown (available, reserved, incoming, ineligible); cover, ROP, target; batches table with FEFO projection; supplier comparison table (all offers incl. excluded with reason codes, factor scores, winner highlighted); formulas with the actual values substituted (incl. the ridge prediction with its largest feature contributions); the 14-day ML forecast as a dashed continuation of the demand chart and an accuracy line ("ML error 18% vs average 27% on the last 14 days → using ML", or the reverse, honestly; plus who chose the method); quote timestamps; data-source labels; Edit controls (qty stepper by pack multiple, offer select) with live **preview** (PATCH `preview: true`) before Save; "Locate in warehouse" → `/warehouse?sku=<sku>`.

**3D Warehouse (`/warehouse`)** — section 11.

**Purchase Orders (`/purchase-orders`, `/purchase-orders/[poId]`)**: list (PO number, supplier, lines, grand total, status, source plan, created); detail = printable PO document (supplier, SKU, manufacturer, pack, qty, free qty, price, GST, freight, totals, expected delivery, line approver, Owner approval (who, when) when required, sent at/by, "NOT SENT" watermark until sent, then "SENT (simulated)"); status pill; actions by status: **Approve** / **Reject** (Owner) for `pending_approval`, **Send to supplier (simulated)** for `ready` / `approved` (toast "Marked as sent — simulated, nothing was emailed"), **Export CSV** and **Print** (`window.print()` with print CSS) in any status.

**Activity & Audit (`/activity`)**: table (time, actor type/id, action, entity, before → after summary, reason), filter by action/entity, "Load more".

**Data & Scenarios (`/data`)**: data summary (rows per table, as-of date, seed) and the **Data sources** list from `data_sources` (name, link, label, what it informed); scenario cards (5) with Run / Reset; **Demand model** card (trained at, training rows, features, global ML vs baseline WAPE, SKUs using ML, "trained on synthetic demo data", Retrain button calling the training service); Owner approval limit input (default ₹10,00,000, `PATCH /api/settings`); **ROI model** (section 11 of `problemstatement.md`) with sliders for each assumption and live totals, labelled "Illustrative model — edit the assumptions".

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
| `seasonal_surge` | Monsoon fever season: the last 10 days of sales × 4 for SKUs in categories `analgesic`, `antibiotic`, `respiratory` | Larger quantities; at least one supplier PO crosses ₹10,00,000 → Owner approval badge, `pending_approval` on approve (P24 checks this and tunes the multiplier if not) |
| `expiry_risk` | The largest batch of PHX-0178 (a `demo-cases.json` `expiry` SKU, named in params) gets expiry = as-of + 92 days: just past the 90-day sell-by window, so a little still sells (at 60 days none could and the SKU turned stockout risk; at 130 days nothing needed ordering) | At-risk value appears, reorder reduced or blocked, bin turns amber |
| `baseline` | none | — |

---

## 13. Audit log catalogue

Every row: `actor_type` (`user` | `system` | `agent` | `tool`), `actor_id` (DEMO_USER, `seed`, `orchestrator`, `demand-agent`, `supplier-agent`, `order-agent`), `action`, `entity_type`, `entity_id`, `before_json`, `after_json`, `reason`.

| Action | When |
|---|---|
| `seed.completed` | end of `npm run seed` (row counts) |
| `plan.created` | createPlan |
| `plan.recalculated` | recalculatePlan (before/after totals, changed lines) |
| `line.edited` · `line.deferred` · `line.rejected` · `line.restored` | editLine |
| `plan.lines_approved` | approveLines (line ids) |
| `po.created` | per PO (with status `ready` / `pending_approval`) |
| `po.approved` · `po.rejected` | Owner decision on a `pending_approval` PO |
| `po.sent` | simulated send |
| `po.exported` | CSV export (status unchanged) |
| `plan.rejected` | rejectPlan |
| `scenario.run` · `scenario.reset` | scenarios |
| `settings.approval_limit_changed` | Owner approval limit edit |
| `model.trained` | demand model trained (global metrics, λ, rows) |
| `agent.run_started` · `agent.run_finished` | pipeline run start / end (status, summary) |
| `agent.demand_decided` | Demand Agent changed a line's forecast method (actor `agent`, `demand-agent`) |
| `line.edited` (actor `supplier-agent`) · `plan.lines_approved` + `po.created` (actor `order-agent`) | Supplier / Order Agent effects, same actions as for a human |

---

## 14. Testing

### 14.1 Unit fixtures (hand-computed — these numbers must match exactly)

**F1 Demand and quantity.** Last 7 days sold `[10, 12, 8, 10, 10, 14, 6]` (sum 70); last 28 days sum 224. Offer: L = 4, pack_multiple = 10, MOQ = 20. Stock position = 40.
- d7 = 10, d28 = 8; with under 56 days of history the trend-aware average is the 28-day mean, so d̄ = **8** (the policy figures below use d̄ = 9.2 directly)
- safety = max(2, 9.2 × 5) = **46**; ROP = 9.2 × 4 + 46 = **82.8**; target = 9.2 × 18 + 46 = **211.6**
- 40 < 82.8 → candidate; qRaw = 171.6 → ceil(17.16) × 10 = **180**; max(180, 20) = **180**
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

**F6 Plan assembly and approval limit.** Candidates L1 ₹3,000 (p 5), L2 ₹2,500 (p 4), L3 ₹1,500 (p 3): all three are in the plan, ranked L1, L2, L3, plan total ₹7,000 (no budget, nothing deferred). Supplier projection: lines for SUP-A totalling exactly ₹10,00,000.00 → `needsApproval = false`; ₹10,00,000.01 → `true`; `posNeedingApproval` counts only the latter.

**F7 Scheme skip** (tests the `ordering.ts` scheme function in isolation). d̄ = 1, stock position 100, shelf life 540, P = 20, F = 3, q = 10, pack 10: qScheme = 20, received 23 → (100 + 23)/1 = 123 < 450 → **taken**. Same with d̄ = 0.2: 615 ≥ 450 and q < P → **SCHEME_SKIPPED_EXPIRY**, expiryAvoided = 10 × effective cost.

**F8 Edge cases.** zero demand → no line, `NO_DEMAND`; incoming PO beyond 14 days excluded; reserved stock subtracted once; quarantine/expired batch excluded; qty 85 with pack 10 → `INVALID_PACK_MULTIPLE`; stale and expired quotes excluded; blocked supplier excluded.

**F9 Determinism.** `buildPlan` twice on the same context → deep-equal output.

**F10 Demand model.** Ridge solver matches a hand-solved 2-feature problem (λ = 1) to 1e-9; feature builder on a known 35-day series gives the expected lags, means, std, zero share and slope; recursive forecast uses its own predictions as later lags; WAPE on a known pair = expected; default-method rule (ML only when ≥ 28 days of history and `mlWape ≤ 0.95 × baselineWape`; ties and `null` → baseline); training twice on the same rows → identical coefficients.

**F11 Agent guardrails.** With a fake Gemini client: `submit_demand_decisions` with a number instead of a method → rejected step, line unchanged; a supplier decision for an excluded offer → rejected, line keeps its offer; an unknown tool → `INVALID_TOOL_INPUT`; `create_purchase_orders` twice with the same run id → the same POs; no API key → run status `fallback`, no POs.

### 14.2 Integration (optional, `TEST_DATABASE_URL`)

Seed a tiny fixture DB → create plan → edit qty → approve twice with the same key → exactly one PO per supplier, PO total = Σ lines, every approved line linked once, audit rows exist → reject a plan → no POs.

### 14.3 Manual demo checklist (run before freeze)

- [ ] Seed from clean (`db:reset` + `seed`) passes validation.
- [ ] Command Center numbers match a direct SQL count.
- [ ] A plan includes every SKU that needs stock (no budget); the supplier PO strip matches the POs that approval creates.
- [ ] Edit preview shows the new total and supplier PO totals before saving.
- [ ] Approve creates POs grouped by supplier; double-click creates nothing extra; a PO above ₹10,00,000 is `pending_approval` and Send returns 409 `APPROVAL_REQUIRED` until the Owner approves it.
- [ ] 3D: click bin shows the right batches; heatmap modes change colours; `?sku=` focuses; 2D toggle works.
- [ ] Each scenario run + recalculate changes the numbers; Reset restores them.
- [ ] With `GEMINI_API_KEY` removed, Why? and Ask still respond (deterministic), and an agent run ends `fallback` with no changes and no POs.
- [ ] The Data page model card shows the real backtest; the drawer's accuracy line matches `sku_forecast_metrics` for 3 spot-checked SKUs.
- [ ] Under Seasonal surge, an agent run changes at least one line, creates POs, and at least one is `pending_approval`; every step is visible in the trace and in the audit log.
- [ ] `npm run build` passes.

---

## 15. Build plan — about 42 hours, one builder

Stage 0 (setup) is already done. Hours are cumulative. The original budget was 30 hours; adding the ML demand model (P16B, about 4–5 h) and the three-agent pipeline (P22B + P23B, about 6–7 h) takes it to about 42 hours — the team accepted going past 30 hours rather than cutting features.

### Stage 1 — Foundation and data (hours 0–3) · P0

- [ ] 3.2 setup: Supabase, `.env.local`, `npm run db:migrate`.
- [ ] Delete `app/page.tsx`; create `app/(dashboard)/layout.tsx` (temporary plain shell) and `app/(dashboard)/page.tsx` ("Command Center" placeholder inside `<Suspense>`).
- [ ] Phase D1: put the reference files in `data/reference/`, write `sources.json`, build `profile-reference.ts`, run it, review `profile.json` with the team.
- [ ] Phase D2: `scripts/seed/prng.ts`, `catalog.ts`, `generate-synthetic.ts`, `inject-demo-cases.ts`, `validate.ts`, `write.ts`, `index.ts` (section 5).
- [ ] `lib/services/as-of.ts`, `lib/services/audit.ts`.

Verify: `profile.json` contains no names or rows; `npm run db:reset && npm run seed` prints the summary with validation passed; Supabase shows 500 products, 240 bins, 45,000 sales rows; `npm run check` passes.

### Stage 2 — Calculation engine (hours 3–9) · P0

- [ ] `dates.ts`, `types.ts`, `demand.ts`, `expiry.ts`, `inventory.ts`, `ordering.ts`, `supplier-scoring.ts`, `totals.ts`, `priority.ts`, `impact.ts`, `validation.ts`, `engine.ts` (section 6).
- [ ] Write fixtures F1–F9 as tests **first** (hour 3), then implement until green.
- [ ] `lib/db/queries/*` and `lib/services/context.ts` (`loadPlanningContext`).
- [ ] Temporary script `scripts/debug-plan.ts` that prints the top 20 lines and the supplier PO totals (any above ₹10,00,000 flagged) to eyeball results.
- [ ] Switch `inject-demo-cases.ts` and `validate.ts` from their temporary stage-1 helpers to the engine functions, then `npm run db:reset && npm run seed` again (validation must still pass).

Verify: `npm run test` all green (F1–F9); debug plan shows urgent SKUs first and the supplier PO totals with any above ₹10,00,000 flagged.

### Stage 3 — Procurement UI and demand model (hours 9–19) · P0

- [ ] Theme tokens in `globals.css`, `<html className="dark">`, `Toaster` in root layout; real shell (Sidebar, TopBar, DataSourceBadge).
- [ ] `lib/validation/api.ts`; routes: dashboard, analyze, get plan, PATCH line (with preview), recalculate.
- [ ] `lib/services/plans.ts` (createPlan, getPlan, editLine, recalculatePlan), `dashboard.ts`, `explain.ts`.
- [ ] Command Center screen; Create Purchase Plan dialog; Procurement list; Plan screen with Impact Card, supplier PO strip, table, "Not in this plan" section, line drawer (demand chart, stock breakdown, batches, supplier comparison, formulas), edit with preview.

- [ ] **ML demand model (P16B, section 6.2a):** `lib/ml/*` + tests F10, migration `003_ml_and_agents.sql`, `npm run train:forecast`, live forecast in `loadPlanningContext`, method + evidence in the engine, drawer accuracy line and forecast continuation, Data page model card.

Verify: create a plan in the browser; open a line; edit qty → preview → save → totals and supplier PO strip change; refresh keeps state. After P16B: `npm run train:forecast` prints the global ML vs baseline WAPE and how many SKUs use ML; a new plan's drawer shows the method and accuracy line; F10 green.

### Stage 4 — Approval and audit (hours 19–22) · P0

- [ ] `lib/services/approval.ts` (7.6) + approve route; reject route; defer/reject/restore via PATCH.
- [ ] PO Owner approve / reject / send (simulated) services and routes (7.6a).
- [ ] Purchase Orders list + detail (actions by status) + CSV export + print view.
- [ ] Activity screen.

Verify: approve 5 lines across 3 suppliers → 3 POs (`ready`, or `pending_approval` above ₹10,00,000), totals match; Send works on `ready`, is refused with `APPROVAL_REQUIRED` on `pending_approval`, works after Owner approval; click Approve twice fast / replay the same request → no duplicates; audit shows every action; reject plan → no POs.

### Stage 5 — Warehouse (hours 22–27) · P0

- [ ] `heatmap.ts`, `putaway.ts` (+ tests); `lib/services/warehouse.ts`; layout/heatmap/bin/search routes.
- [ ] `Grid2D` first (CSS grid by aisle → rack → shelf, same colours and panel), then `Scene3D` with instanced bins, hover, click, modes, legend, `?sku=` focus, proposed ghost cartons, reset camera, WebGL fallback.
- [ ] "Locate" links from Command Center and the line drawer.

Verify: every heatmap mode matches the plan's statuses for 3 spot-checked SKUs; unmapped stock is listed, not placed; works with WebGL disabled (2D).

### Stage 6 — Agents (hours 27–37) · P1

- [ ] `lib/agents/tools.ts`, `prompts.ts`, `orchestrator.ts`; `/api/agent/chat`; `/explain` route uses the agent then falls back.
- [ ] Ask PharmaOS panel; Why? buttons; plan summary after creation.
- [ ] Test the 7 prompts in Appendix A with and without the API key.
- [ ] **Agent pipeline (P22B, section 9.5):** shared loop with terminal tools, Demand / Supplier / Order agents with guardrails, `runPipeline`, routes, tests F11.
- [ ] **Agent run view (P23B):** Run procurement agents button, Agent Run panel with live trace, past runs.

Verify: "Why did you choose Supplier B instead of Supplier A for <SKU>?" cites the same numbers as the drawer; "Which POs need Owner approval?" cites the supplier totals; "Recalculate the plan" recalculates the saved plan (audited, actor agent); with the key removed every button still works. Agent pipeline: a run on the seasonal-surge plan changes lines and creates POs (one `pending_approval`), every step is in the trace; without the key the run ends `fallback`, creating nothing.

### Stage 7 — Scenarios and polish (hours 37–39) · P1

- [ ] `apply.ts`, `scenarios.ts`, routes, Data & Scenarios screen, scenario chip in top bar, ROI model.
- [ ] Loading/empty/error/stale states on every screen; keyboard focus visible; numbers right-aligned.

Verify: run Seasonal surge → recalculate → the ML forecast rises for the surged categories → at least one supplier PO above ₹10,00,000 with the Owner approval badge; Supplier delay re-ranks; Reset restores baseline numbers.

### Stage 8 — Freeze and rehearse (hours 39–42)

- [ ] No new features after hour 39.
- [ ] `npm run build` and run the production build locally (`npm run start`).
- [ ] `db:reset` + `seed` to a clean demo state; note the demo SKUs from `demo-cases.json`.
- [ ] Rehearse the demo script 3 times with a timer; record a backup video.
- [ ] Run the manual checklist 14.3.

P2 stretch (only if ahead at hour 27): ghost cartons polish, simulated put-away movement (`warehouse_movements`), simple FEFO pick path.

### 15.1 Cut order if time runs short

1. P2 stretch.
2. Demand-spike and expiry scenarios (keep seasonal surge: it shows the approval gate).
3. Free-form Ask panel (keep deterministic **Why?** built from `evidence_json`). Keep the agent pipeline: it is the agentic core.
4. Extra heatmap modes (keep stockout and expiry).
5. **Never cut:** correct calculations, the ML demand model with its honest backtest, the three-agent pipeline with guardrails, plan editing with server recalculation, approval + audit, and a basic interactive 3D warehouse.

---

## 16. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Reference files have unexpected formats | `sources.json` column map + coercion; a missing file only falls back to defaults, so the demo never depends on it |
| Engine bugs show wrong numbers on stage | Fixtures F1–F9 written before the code; debug-plan script; `evidence_json` shows every step |
| Next 16 caching surprises | Suspense + `connection()` pattern on every page (1.1); `npm run build` at the end of every stage |
| Base UI component APIs differ from Radix examples | Read the component file in `components/ui/` before use |
| LLM slow / down / refuses | 45 s deadline per call, race against the backup model after 10 s, run budget 270 s, then deterministic fallback, AI is never on the critical path |
| WebGL fails on the demo laptop | 2D grid with the same data and panel |
| Supabase/Wi-Fi issue during judging | Local Postgres fallback (3.2) seeded the same way; backup video |
| Running out of time | Stage order, freeze at hour 39, cut order 15.1 |
| ML does not beat the baseline | The per-SKU rule falls back to the baseline and the UI says so; the backtest numbers are shown as they are, never tuned for the demo |
| An agent proposes something unsafe | Code guardrails reject it (method-only demand decisions, eligible offers only, POs only through `approveLines`, no send / Owner-approve tool for any AI); rejected decisions are visible in the trace |

---

## 17. Demo script (3–4 minutes)

1. **(0:00) The pain.** "A stockist has SKUs about to run out, stock near expiry, and orders placed by gut feel." Command Center; point at the data-source badge.
2. **(0:30) Create plan.** One click → ranked plan with every SKU that needs stock. Impact Card: stockouts covered, total spend, POs per supplier.
3. **(1:00) Why this line?** Open a stockout SKU: demand chart with the dashed ML forecast and the accuracy line ("ML error 18% vs average 27% → using ML"), stock position, expiry, supplier comparison. Ask "Why Supplier B instead of A?" — the answer cites the drawer's numbers.
4. **(1:45) Warehouse.** Locate the SKU in 3D, switch stockout → expiry heatmap, click its bin.
5. **(2:20) Disruption.** Run Seasonal surge → recalculate → quantities rise and one supplier PO crosses ₹10,00,000 (amber Owner approval badge).
6. **(2:50) Agents.** Click **Run procurement agents**: watch the Demand Agent pick ML or the average per SKU, the Supplier Agent switch one supplier (with its reason, checked by the guardrail), and the Order Agent create the POs — one needs Owner approval. Every tool call is in the trace.
7. **(3:20) Owner and send.** Open the large PO: `pending_approval`, Send is blocked → Owner approves → Send (simulated) → the audit log shows the agents' and the humans' actions.
8. **(3:45) Close.** "The engine and the ML model calculate, three agents decide within guardrails, a human sends and the Owner approves large orders — and nothing leaves the app." Show the ROI model.

---

## 18. Definition of done

- [ ] The dashboard loads seeded synthetic demo data, labels it, and lists its reference sources.
- [ ] Dashboard metrics are computed from the database.
- [ ] Procurement run returns ranked recommendations with reasons and supporting values.
- [ ] Stock position, cover, reorder qty, rounding, expiry, scoring, plan assembly, approval limit and totals pass F1–F9.
- [ ] Supplier selection excludes stale/expired offers, unavailable stock, unapproved suppliers and mismatched products.
- [ ] Every PO above ₹10,00,000 needs Owner approval before it can be sent; owner-deferred / rejected lines and their reasons are visible.
- [ ] Editing qty/supplier recalculates on the server, with preview.
- [ ] Approving selected lines creates POs grouped by supplier (`ready` / `pending_approval`) plus audit records; repeated approval creates no duplicates; sending is simulated and labelled so.
- [ ] Reject/defer changes totals and is audited.
- [ ] Clicking a 3D bin shows the matching product/batch/quantity records; heatmaps use calculated values; selecting a recommendation focuses its bin; proposed stock looks distinct.
- [ ] Scenarios change state and recalculated results.
- [ ] LLM failure does not break any workflow.
- [ ] The demand model is trained, backtested and stored; each SKU uses ML only where its backtest beats the baseline, and the UI shows both errors honestly.
- [ ] An agent run makes real, guarded decisions (forecast method, supplier, POs), stores every step, and audits every change; without the API key it ends `fallback` and changes nothing.
- [ ] No action is labelled ordered/confirmed; every "sent" is labelled simulated; no PO above ₹10,00,000 reaches `sent` without an Owner approval.
- [ ] `npm run check` and `npm run build` pass.

---

## Appendix A — Demo prompts for Ask PharmaOS

1. Create today's purchase plan. Prioritise products likely to run out before the supplier can deliver.
2. Why did you choose Supplier B instead of Supplier A for this SKU?
3. Which supplier POs will need Owner approval, and why?
4. Show where this SKU and its batches are located in the warehouse.
5. Show expiry risk in the warehouse and identify affected purchase recommendations.
6. Change this order to 60 packs and recalculate the total, the supplier's PO total and MOQ/pack constraints. *(the agent explains that edits are made in the Edit dialog and runs `validate_po` to check 60 packs; it does not edit lines itself)*
7. Prepare POs for approved lines and send them. *(the agent explains the Approve button, the Owner approval above ₹10,00,000 and that sending is simulated; it cannot create, approve or send POs)*

## Appendix B — Reason and warning codes

| Code | Kind | Meaning shown to the user |
|---|---|---|
| `BELOW_REORDER_POINT` | reason | Stock position is below the reorder point |
| `STOCKOUT_BEFORE_DELIVERY` | reason | Stock runs out before any supplier can deliver |
| `CHEAPER_OFFER_TOO_SLOW` | reason | A cheaper supplier was skipped because it delivers after the projected stockout |
| `SCHEME_TAKEN` | reason | Scheme taken; the extra stock sells before expiry |
| `SCHEME_SKIPPED_EXPIRY` | reason | Scheme skipped; the extra stock would not sell before expiry |
| `EXPIRY_REDUCED_QTY` | reason | Quantity reduced to the reorder point because existing batches are at expiry risk (never on stockout-risk lines) |
| `NO_ELIGIBLE_OFFER` | reason | No approved, valid, available offer for this SKU |
| `NO_DEMAND` · `LOW_HISTORY` · `DEMAND_SPIKE` | warning | Demand data quality notes |
| `AT_RISK_BATCHES` | warning | This SKU already has batches at expiry risk |
| `SCHEME_EXCESS_RISK` | warning | Free goods may not sell before expiry |
| `PRICE_ANOMALY` | warning | This offer is more than 20% above the SKU's other offers |
| `NOT_TOP_SUPPLIER` | warning | User chose a supplier that is not the top-scored one |
| `CAPACITY_REVIEW` | warning | No bin can take the proposed quantity; needs review |
| `UNMAPPED_STOCK` | warning | Some stock of this SKU has no bin location |
| Offer exclusions | offer | `SUPPLIER_NOT_APPROVED`, `QUOTE_EXPIRED`, `QUOTE_STALE`, `MISSING_PRICE`, `OFFER_INACTIVE`, `PRODUCT_MISMATCH`, `INSUFFICIENT_AVAILABILITY`, `INVALID_PACK_RULES`, `TOO_SLOW_FOR_COVER` |
| Hard stops | approval | `INVALID_SKU`, `SUPPLIER_NOT_APPROVED`, `QUOTE_EXPIRED`, `QUOTE_STALE`, `MISSING_PRICE`, `INVALID_PACK_MULTIPLE`, `BELOW_MOQ`, `ABOVE_AVAILABILITY`, `NON_POSITIVE_QTY`, `PRODUCT_RECALLED` |
