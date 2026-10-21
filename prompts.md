# PharmaOS — Build Prompts

Run these prompts **one at a time, in order**, with your AI coding assistant opened in the `pharmaos/` folder. Each prompt matches a stage in `implementationplan.md` §15 and names the exact plan sections to follow.

## How to use this file

1. **New chat session?** Paste **P00** first, then the next prompt in the list.
2. Paste one prompt. Wait until it finishes and reports back.
3. Check the **You check** line yourself (open the dashboard in your browser at http://localhost:3000 and look at the numbers). If it fails, use **FIX** (end of file) before moving on.
4. Each prompt ends with the assistant running `npm run check` and committing. Don't start the next prompt until that commit exists.
5. **Behind schedule?** Use **CUT** (end of file).
6. Prompts marked **STOP** end with the assistant waiting for your review. Don't skip that review.

| # | Stage | Hours | Prompt |
|---|---|---|---|
| — | Any | — | P00 Session primer |
| 1 | Foundation and data | 0–3 | P01 Database · P02 Dashboard skeleton · P03 Register references (STOP) · P04 Profile references (STOP) · P05 Generate synthetic data · P06 Demo cases, validation, seed |
| 2 | Calculation engine | 3–9 | P07 Engine tests first · P08 Demand, expiry, inventory · P09 Ordering, suppliers, totals, priority · P10 Basket, impact, validation, engine · P11 Context loader and debug plan (STOP) |
| 3 | Procurement UI | 9–14 | P12 Theme and shell · P13 Plan services and API · P14 Command Center · P15 Plan screen · P16 Line drawer and edit preview |
| 4 | Approval and audit | 14–17 | P17 Approval service · P18 POs and Activity |
| 5 | Warehouse | 17–22 | P19 Heatmap, put-away, warehouse API · P20 2D grid and panels · P21 3D scene |
| 6 | Agent | 22–25 | P22 Tools and orchestrator · P23 Ask panel, Why?, summary |
| 7 | Scenarios and polish | 25–27 | P24 Scenarios and ROI model · P25 Polish pass |
| 8 | Freeze and rehearse | 27–30 | P26 Done audit (STOP) · P27 Demo build and clean seed · P28 Demo notes |
| — | Any | — | FIX · CUT · STRETCH |

---

## P00 — Session primer (paste at the start of every new chat session)

```text
You are building PharmaOS, a hackathon project. Before doing anything:
1. Read AGENTS.md, problemstatement.md, architecture.md and implementationplan.md in full.
2. Run `git log --oneline | head -20` and `git status` to see which stages are done.
3. Reply with: the last completed stage, the next prompt you expect to run, and any uncommitted changes.

Rules for this whole session:
- implementationplan.md is the source of truth. Do not add features, tables, endpoints or libraries that are not in it.
- Follow the rules in implementationplan.md §0.1 (R1–R10) and the layer rules in architecture.md §3.
- This is Next.js 16: read the relevant guide in node_modules/next/dist/docs/ before using an unfamiliar Next API.
- shadcn components here use Base UI (`render` prop, not `asChild`). Read the component file in components/ui/ before using it.
- If the plan is wrong or unclear, stop and tell me. Do not guess. If we agree on a change, update implementationplan.md in the same commit.
- Do not start the next prompt on your own. Wait for me.
```

---

## Stage 1 — Foundation and data (hours 0–3)

### Before P01, do this yourself (15 minutes, plan §3.2)

1. Create a Supabase project (region Mumbai).
2. Copy the **Transaction pooler** connection string (port 6543).
3. Run `cp .env.example .env.local` and paste the string into `DATABASE_URL`. Add `GEMINI_API_KEY` if you have one (from aistudio.google.com/apikey).

### P01 — Database

```text
Stage 1, step 1: database. Follow implementationplan.md §3.2 and §4.

1. Confirm .env.local exists and DATABASE_URL is set (do not print its value).
2. Run `npm run db:migrate`.
3. Write a throwaway check with tsx (do not save it in the repo) that connects with DATABASE_URL and prints:
   - every table in the public schema (expect 17 plus schema_migrations),
   - the 5 rows of `scenarios`,
   - the `app_state` row.
4. Report the output. If migrate fails, show the exact error and stop. Do not change db/migrations/001_init.sql without asking me.

No commit needed unless you changed files.
```
**You check:** the Supabase table editor shows the tables and 5 scenarios.

### P02 — Dashboard skeleton

```text
Stage 1, step 2: web dashboard skeleton. Follow implementationplan.md §1.1, §2 and §15 Stage 1.

1. Delete app/page.tsx (it conflicts with app/(dashboard)/page.tsx).
2. Create app/(dashboard)/layout.tsx: a temporary plain shell (header text "PharmaOS", main area). The real shell comes in P12.
3. Create app/(dashboard)/page.tsx: "Command Center" placeholder. Use the Suspense pattern from §1.1. Inside, an async server component calls `await connection()` and then shows the count of rows in `scenarios` using getSql() from lib/db/client.ts. This proves the DB-read pattern works with Cache Components.
4. Create lib/services/as-of.ts: resolveAsOfDate() per architecture.md §5.5 (DEMO_AS_OF_DATE → app_state.as_of_date → max(sales_history.sale_date); if there are no sales yet, return today's UTC date and say so in a comment). Return a YYYY-MM-DD string.
5. Create lib/services/audit.ts: writeAudit({ actorType, actorId, action, entityType, entityId, before, after, reason }), accepting either the pool or a transaction handle, plus listAudit({ limit, before }). This is the only module that inserts into audit_logs (architecture.md §3.2).
6. Run `npm run check` and `npm run build`. Both must pass. Then run `npm run dev`, open http://localhost:3000 and confirm the scenarios count shows 5.
7. Commit: "stage 1: dashboard skeleton, as-of and audit services".
```
**You check:** http://localhost:3000 shows "Command Center" and the number 5.

### Before P03, do this yourself

Put the reference dataset files in `pharmaos/data/reference/`: your own datasets plus any public ones from the data acquisition document (catalogue CSV, sales samples).

### P03 — Register reference datasets (STOP)

```text
Stage 1, phase D1a: register reference datasets. Follow implementationplan.md §5 (read 5.1–5.4 carefully).

IMPORTANT: these files are reference material only. Do not copy any row, name or price into the database, and do not generate any data in this step.

1. List the files in data/reference/ with size and row count.
2. For each file, print its header row and 3 sample rows, so we can see the format. Keep it in the chat; do not save the samples.
3. Match each file to a source in §5.1 (or mark it team_dataset_<name>). Propose its provenance label (public_reference / unverified_sample) and what it may inform.
4. Write data/reference/sources.json in the exact shape of §5.3, with the `columns` map filled in from the real headers.
5. Show me sources.json and list any file whose licence or provenance is unclear.

STOP and wait for my review. Do not commit until I approve.
```
**You check:** each file has the right label and nothing claims to be real stockist data. Approve, then tell it: "Approved, commit sources.json."

### P04 — Profile reference datasets (STOP)

```text
Stage 1, phase D1b: profile the reference datasets. Follow implementationplan.md §5.4 exactly.

1. Create scripts/seed/profile-reference.ts. It reads every file in data/reference/sources.json with csv-parse (columns: true, trim: true, skip_empty_lines: true, bom: true), coerces numbers (strip ₹, commas) and dates, and writes data/reference/profile.json with ONLY the aggregate fields in the §5.4 table.
2. profile.json must contain no names, IDs or individual rows. A missing source marks its fields "missing": true.
3. Add the npm script "profile": "tsx scripts/seed/profile-reference.ts" and run it.
4. Show me profile.json and a short plain-English summary (e.g. "62% tablets, median antibiotic price ₹X").
5. Prove the no-copy rule: search profile.json for 10 brand names and 5 manufacturer names taken from the reference files and confirm none appear.

STOP and wait for my review. After I approve, run `npm run check` and commit: "stage 1: reference sources and profile".
```
**You check:** the numbers look plausible and there are no names in `profile.json`.

### P05 — Generate synthetic data

```text
Stage 1, phase D2a: synthetic data generator. Follow implementationplan.md §5.5 exactly, including the no-copy rules.

1. scripts/seed/prng.ts: mulberry32(seed), and helpers int(min,max), float, pick, weighted pick, shuffle, poisson(lambda) (Knuth). Never use Math.random().
2. scripts/seed/catalog.ts: short lists of common generic names (single and combination), brand-name syllables, fictional manufacturer and supplier name parts, categories, forms.
3. scripts/seed/generate-synthetic.ts: export generate(profile, asOf, seed) returning in-memory rows for every table in the §5.5 table (products 200, suppliers 8, offers 1–3 per SKU, 90 days of sales, 240 bins, batches, balances, 15 open + 1 received + 1 cancelled POs with lines). Use profile.json where present, otherwise the defaults in §5.5. Every row: data_source = 'synthetic_demo'. Every offer: price_type = 'supplier_quote'. Money as strings.
4. Use faker.seed(42) and mulberry32(42). The as-of date for generation = DEMO_AS_OF_DATE, or today's UTC date if unset.
5. Add a unit test tests/unit/generator.test.ts: the same seed gives deep-equal output; row counts match §5.5; every bin_code is unique; no sales date is after as-of.
6. Run `npm run check`. Do not insert anything into the database yet.
7. Commit: "stage 1: synthetic data generator".
```

### P06 — Demo cases, validation and seed

```text
Stage 1, phase D2b: demo cases, validation and seed. Follow implementationplan.md §5.6, §5.7 and §5.8 exactly.

1. scripts/seed/inject-demo-cases.ts: adjust generated rows so every count in the §5.6 table holds. Write data/synthetic/demo-cases.json listing the SKUs per case (keys: stockout, expiry, excess, priceAnomaly, capacity, cheapestTooSlow, schemeSkip, staleQuote, unmapped, spike, noEligibleOffer).
   The engine does not exist yet. Implement the case conditions with simple local helpers in this file using the §6 formulas (cover = stock / d̄ and so on), and leave a TODO to switch to lib/business-logic after stage 2.
2. scripts/seed/validate.ts: every check in §5.7, including the no-copy checks against the files in data/reference/. The "default plan at ₹2,00,000" check also depends on the engine: implement it as "sum of estimated line costs of below-ROP SKUs > ₹2,00,000" with the same TODO.
3. scripts/seed/write.ts: truncate data tables (keep scenarios, reset app_state), insert in the §5.8 FK order inside sql.begin() with batches of 1,000 rows, set app_state.synthetic_seed and seeded_at, insert data_sources from sources.json, write CSV snapshots to data/synthetic/, call writeAudit('seed.completed').
4. scripts/seed/index.ts: profile.json → generate → inject → validate (exit 1 on failure) → write → print a summary table of rows per table.
5. Run `npm run db:reset && npm run seed`. Show me the summary and demo-cases.json.
6. Run `npm run check`. Commit: "stage 1: demo cases, validation and seed".
```
**You check:** about 200 products, 240 bins and 18,000+ sales rows in Supabase. Every `data_source` is `synthetic_demo`.

---

## Stage 2 — Calculation engine (hours 3–9)

### P07 — Engine tests first

```text
Stage 2, step 1: write the engine tests BEFORE the engine. Follow implementationplan.md §14.1 (fixtures F1–F9) and §6.

1. Create lib/business-logic/types.ts with the engine input and output types needed by §6 (SkuContext, OfferInput, BatchInput, BalanceInput, SkuAnalysis, PlanLine, PlanResult, ImpactCard, reason/warning code unions from Appendix B). Money fields are strings.
2. Create empty stub modules that export the planned function signatures and throw "not implemented": dates, demand, expiry, inventory, ordering, supplier-scoring, totals, priority, basket, impact, validation, engine.
3. Write tests/unit/engine/*.test.ts with every fixture F1–F9 using the EXACT numbers in §14.1. Compare money as fixed-decimal strings (e.g. "2061.00"), and non-money decimals with toBeCloseTo where the plan shows "…".
4. Add tests for every F8 edge case, one test each.
5. Run `npm run test`. The new tests should FAIL with "not implemented" and the type check should pass. Show me the failing list.
6. Commit: "stage 2: engine types and fixture tests".
```

### P08 — Demand, expiry, inventory

```text
Stage 2, step 2: implement dates.ts, demand.ts, expiry.ts and inventory.ts exactly as implementationplan.md §6.1–§6.4 says.

- Pure functions only; no DB, no clock, no Math.random. Use lib/money.ts for money and Decimal for fractional maths; round only where the plan says.
- dates.ts uses Date.UTC arithmetic on YYYY-MM-DD strings (no local-time getters).
- expiry.ts: FEFO order = expiry ascending, then batch_number. Ineligible batches (non-released or expired) are returned separately and never counted.
- inventory.ts: confirmed incoming = only POs with status 'open' and expected_delivery_date ≤ asOf + planningHorizonDays. Reserved stock is subtracted once.
- All constants come from lib/business-logic/config.ts.

Run `npm run test`. F1 (demand part), F4 and the related F8 cases must pass. Report which fixtures pass now. Run `npm run check`. Commit: "stage 2: demand, expiry, inventory".
```

### P09 — Ordering, suppliers, totals, priority

```text
Stage 2, step 3: implement ordering.ts, supplier-scoring.ts, totals.ts and priority.ts exactly as implementationplan.md §6.5–§6.8 says.

Pay special attention to:
- §6.5 candidate rule: d̄ > 0 and stockPosition < ROP(L_fastest); quantities are computed per offer with that offer's L, MOQ and pack multiple; EXPIRY_REDUCED_QTY; and the three-way scheme decision.
- §6.6 eligibility codes, effective cost (roundUnit), the urgency rule (TOO_SLOW_FOR_COVER, CHEAPER_OFFER_TOO_SLOW, STOCKOUT_BEFORE_DELIVERY), score normalisation (all equal → 100; null reliability or terms → 0), tie-breaks, and PRICE_ANOMALY.
- §6.7 one totals function used everywhere, with half-up rounding at the stated points.
- §6.8 the deterministic sort key.

Run `npm run test`. F1, F2, F3, F5, F7 and the related F8 cases must pass. Run `npm run check`. Commit: "stage 2: ordering, supplier scoring, totals, priority".
```

### P10 — Basket, impact, validation, engine

```text
Stage 2, step 4: implement basket.ts, impact.ts, validation.ts and engine.ts exactly as implementationplan.md §6.9–§6.12 says.

- basket.ts: pass 1 greedy, pass 2 (ALT_OFFER_FOR_BUDGET, then PARTIAL_QTY_BUDGET). Add a property test: for 200 random baskets (seeded), Σ in-basket lineTotal ≤ budget.
- impact.ts: every field in the §6.10 table; lossPreventedPerRupee is null when planTotal = 0.
- validation.ts: hard stops and soft warnings from §6.11 and Appendix B.
- engine.ts: analyseSku() and buildPlan(). analyseSku must return a full `evidence` object containing every input and intermediate value (architecture.md §6.4), because evidence_json powers the drawer and explanations.

Run `npm run test`. ALL fixtures F1–F9 must pass, including F9 determinism. Run `npm run check`. Commit: "stage 2: basket, impact, validation, engine".
```

### P11 — Context loader and debug plan (STOP)

```text
Stage 2, step 5: connect the engine to the database. Follow implementationplan.md §7.1 and §15 Stage 2.

1. lib/db/queries/*: typed read queries for products, suppliers, offers, sales (last 28 days plus first-sale date per SKU), batches with balances, and open POs with lines. Use postgres.js tagged templates only.
2. lib/services/context.ts: loadPlanningContext(sql, asOf, scenarioId), returning plain objects with money as strings. For now applyScenario is a no-op for 'baseline' (implemented in P24); create lib/scenarios/apply.ts with that stub.
3. Replace the TODO helpers in scripts/seed/inject-demo-cases.ts and validate.ts with the real engine functions. Re-run `npm run db:reset && npm run seed`; validation must still pass.
4. scripts/debug-plan.ts (npm script "debug:plan"): load context, run buildPlan at ₹2,00,000 and ₹1,00,000, and print for each: the top 20 lines (rank, sku, status, cover, qty+free, supplier, effective cost, line total, priority, reasons), totals, deferred count, and the Impact Card.

Run it and show me the output. Check and report: urgent SKUs come first; deferred lines exist at ₹2,00,000; total ≤ budget in both runs; the cheapestTooSlow and schemeSkip SKUs from demo-cases.json show the expected reason codes.

STOP for my review. After I approve: `npm run check`, commit "stage 2: planning context and debug plan".
```
**You check:** the ranking makes business sense to you as an owner.

---

## Stage 3 — Procurement UI (hours 9–14)

### P12 — Theme and shell

```text
Stage 3, step 1: theme and dashboard shell. Follow implementationplan.md §10 (intro: web dashboard, desktop-first, tablet ≥ 768 px), §10.1 and §10.2.

1. app/globals.css: map the §10.1 palette onto the shadcn CSS variables (background, card, border, primary = teal) and add status colour variables (stockout, expiry, excess, healthy, proposed). Keep the existing shadcn structure.
2. app/layout.tsx: <html className="dark">, keep the Geist fonts, title "PharmaOS", add <Toaster /> from components/ui/sonner.tsx and a TooltipProvider if the component requires one (check components/ui/tooltip.tsx).
3. components/layout/: Sidebar (6 links with lucide icons, active state), TopBar (wordmark, DataSourceBadge "Synthetic demo data", active scenario chip if not baseline, default budget via formatINR, as-of date, DEMO_USER), PageHeader.
4. Replace the temporary app/(dashboard)/layout.tsx with the real shell. TopBar data is read server-side inside <Suspense>.
5. Create placeholder pages (title + "Coming in stage N") for /procurement, /warehouse, /purchase-orders, /activity and /data so every sidebar link works.
6. `npm run check` and `npm run build` must pass. Commit: "stage 3: theme and shell".
```
**You check:** a dark navy web dashboard with a working sidebar on every route; at tablet width the sidebar collapses to icons.

### P13 — Plan services and API

```text
Stage 3, step 2: plan services and API routes. Follow implementationplan.md §7.2, §7.3, §7.4, §7.5, §7.7 (dashboard, explain) and §8.

1. lib/validation/api.ts: Zod schemas for analyze, get plan, PATCH line (exactly one change, plus optional preview), recalculate.
2. lib/services/plans.ts: createPlan, getPlan, editLine (with preview, LINE_LOCKED, OVER_BUDGET with overBy), recalculatePlan (frozen/edited/rejected rules from §7.5). Each mutation runs in sql.begin() and calls writeAudit with the §13 action names. createPlan logs its duration in ms.
3. lib/services/dashboard.ts: getCommandCenter() per §7.7.
4. lib/services/explain.ts: explainLine(evidence), returning deterministic sentences like the §7.7 example. No LLM.
5. Route handlers: POST /api/procurement/analyze, GET /api/purchase-plans/[id], PATCH /api/purchase-plans/[id]/lines/[lineId], POST /api/purchase-plans/[id]/recalculate, POST /api/purchase-plans/[id]/lines/[lineId]/explain (deterministic for now), GET /api/dashboard. Use RouteContext<'…'> and `await ctx.params`. Error envelope and status codes exactly as §8.
6. Test with curl or a small tsx script (not committed): create a plan, preview an edit, save it, trigger OVER_BUDGET, recalculate at ₹1,00,000. Show me the responses.
7. `npm run check` and `npm run build`. Commit: "stage 3: plan services and API".
```

### P14 — Command Center and plan list

```text
Stage 3, step 3: Command Center and procurement list. Follow implementationplan.md §10.3 (Command Center, Procurement list).

1. app/(dashboard)/page.tsx: KPI tiles (components/dashboard/KpiTile) for available budget, proposed spend, SKUs at stockout risk, ₹ expiry exposure and pending approvals; CriticalSkuList (top 8) with "Open in plan" and "Locate" (/warehouse?sku=…) links. All values come from getCommandCenter().
2. Create Purchase Plan dialog (client): budget prefilled from app_state.default_budget, optional priority text; POST /api/procurement/analyze; loading state; on success navigate to /procurement/[planId]; on error show a toast with the error message.
3. app/(dashboard)/procurement/page.tsx: plans table (created, budget, total, status, scenario) plus the Create button.
4. Loading skeletons, empty state ("No plans yet") and error state for both pages.
5. `npm run check` and `npm run build`. Commit: "stage 3: command center and plan list".
```
**You check:** the Command Center numbers match the debug-plan output.

### P15 — Plan screen

```text
Stage 3, step 4: the Procurement Plan screen. Follow implementationplan.md §10.3 (Procurement Plan), §6.10 and Appendix B.

1. app/(dashboard)/procurement/[planId]/page.tsx (PageProps, await params, Suspense).
2. components/procurement/ImpactCard: every §6.10 field, large numbers, one line of explanation each; budget bar (committed vs remaining).
3. PlanTable (client): columns exactly as §10.3, sorted by rank, row checkboxes, status badges with text, flag icons with tooltips showing the Appendix B meaning, tabular-nums right-aligned money via formatINR. Row actions: Why? (calls /explain, shows the text in a popover), Edit (opens the drawer, P16), Defer and Reject (dialog with a required reason, PATCH status).
4. DeferredList with reason, ₹ risk and Restore.
5. Recalculate control (budget input → POST recalculate → router.refresh()).
6. Footer bar with selected count and total, and the Approve button disabled with "Available in stage 4". Leave Reject plan for P17.
7. Every mutation: disable the button while running, toast on success or error, then router.refresh().
8. `npm run check` and `npm run build`. Commit: "stage 3: plan screen".
```

### P16 — Line drawer and edit preview

```text
Stage 3, step 5: the recommendation detail drawer. Follow implementationplan.md §10.3 (Line drawer) and architecture.md §6.4 and §7.2.

1. The drawer opens from ?line=<id> (Sheet component) and reads everything from the line's evidence_json.
2. Sections: product identity (+ data_source label); DemandChart (Recharts, last 28 days, with d7/d28/d̄ reference lines); stock breakdown (available, reserved, incoming, ineligible with reasons); cover, ROP, target; batches table with FEFO projection and at-risk value; SupplierComparison (all offers, including excluded ones with reason codes, factor scores, winner highlighted, quote timestamps); FormulaPanel (each §6 formula with the actual values substituted); "Locate in warehouse" link.
3. Edit controls: qty stepper in steps of pack_multiple (min MOQ) and an offer select (eligible offers only). Every change calls PATCH with preview: true and shows before → after (line total, plan total, budget remaining) before Save. Show 400/409 errors inline (e.g. "₹1,240 over budget").
4. `npm run check` and `npm run build`. Then click through 3 lines in the browser, edit one, and confirm the totals changed. Commit: "stage 3: line drawer and edit preview".
```
**You check:** stage 3 Verify in plan §15: create, open, edit, preview, save, over-budget refused, state kept after refresh.

---

## Stage 4 — Approval and audit (hours 14–17)

### P17 — Approval service

```text
Stage 4, step 1: approval. Follow implementationplan.md §7.6 exactly and architecture.md §7.3. This is the ONLY code allowed to create purchase orders.

1. lib/services/approval.ts: approveLines(planId, lineIds, idempotencyKey, userId) in ONE transaction: SELECT … FOR UPDATE on the plan → idempotency lookup → load lines → re-run analysis + ALL hard stops with fresh context (422 with { lineId, codes } on failure) → group by supplier → insert POs (status 'draft', po_number from po_number_seq, totals from the shared totals function, expected_delivery_date) → insert PO lines with recommendation_id → update line statuses, approvals, plan status → audit po.draft_created ×N and plan.lines_approved.
2. rejectPlan(planId, reason) in plans.ts.
3. Routes: POST /api/purchase-plans/[id]/approve and POST /api/purchase-plans/[id]/reject (Zod, §8 status codes).
4. UI: enable Approve on the plan screen. Generate crypto.randomUUID() when the confirmation dialog opens; the dialog lists the POs per supplier with totals; the button is disabled while running; success toast with links to the POs. Add Reject plan (reason required).
5. tests/integration/approval.test.ts (skip when TEST_DATABASE_URL is unset): approve twice with the same key → the same POs, no extra rows; PO total = Σ lines; a second approval of the same line fails; a rejected plan creates no POs.
6. Manually: approve 5 lines across 3 suppliers, then replay the same request with curl. Show me the result.
7. `npm run check` and `npm run build`. Commit: "stage 4: approval service".
```

### P18 — Purchase orders and Activity

```text
Stage 4, step 2: PO screens and activity log. Follow implementationplan.md §10.3 (Purchase Orders, Activity), §7.7 (exportPo) and §13.

1. lib/services/purchase-orders.ts: listPurchaseOrders, getPurchaseOrder, exportPo (CSV, status → exported, audit po.exported).
2. Routes: GET /api/purchase-orders, GET /api/purchase-orders/[id], POST /api/purchase-orders/[id]/export (text/csv download), GET /api/audit.
3. /purchase-orders list and /purchase-orders/[poId] detail as a printable PO document with the "DRAFT — not sent to supplier" watermark, Export CSV and Print (print CSS hides the dashboard shell).
4. /activity: AuditTable (time, actor, action, entity, before → after summary, reason), filters, Load more.
5. Search the codebase and confirm the words "sent", "ordered" and "confirmed" are never used as a status or label.
6. `npm run check` and `npm run build`. Commit: "stage 4: purchase orders and activity".
```
**You check:** stage 4 Verify in plan §15.

---

## Stage 5 — Warehouse (hours 17–22)

### P19 — Heatmap, put-away and warehouse API

```text
Stage 5, step 1: warehouse logic and API. Follow implementationplan.md §6.13, §8 (warehouse and products routes) and architecture.md §7.6.

1. lib/business-logic/heatmap.ts and putaway.ts (pure), with unit tests: one bin per mode, severity 0–3, candidate bin preference order, CAPACITY_REVIEW when nothing fits, unmapped stock never placed.
2. lib/warehouse/geometry.ts: shared helpers (aisle/side/rack/shelf from bin_code, bounding box).
3. lib/services/warehouse.ts: getLayout, getHeatmap(mode, planId?), getBinDetails(id), searchProducts(q). getHeatmap must use the SAME engine statuses as the plan (one context load per request).
4. Routes: GET /api/warehouse/layout, GET /api/warehouse/heatmap?mode=&planId=, GET /api/warehouse/bins/[id], GET /api/products/search?q=.
5. Spot-check 3 SKUs from demo-cases.json (stockout, expiry, excess): their bins have the matching heatmap status. Show me.
6. `npm run check`. Commit: "stage 5: heatmap, put-away and warehouse API".
```

### P20 — 2D grid and panels

```text
Stage 5, step 2: the warehouse page with the 2D grid first. Follow implementationplan.md §11 and architecture.md §10.3.

1. components/warehouse3d/WarehouseView (client): loads the layout once and the heatmap on mode change; state for mode, selectedBinId and search; reads ?mode, ?sku and ?bin from the URL.
2. Grid2D: CSS grid grouped aisle → side → rack → shelf, coloured by severity, with the bin code on hover; click selects.
3. BinPanel: location path, capacity and fill, balances (SKU, batch, expiry, days left, qty, reserved, status, data_source). Plus an "Unmapped stock" list.
4. Legend (colour + text for each mode) and ModeSelect (Stockout Risk, Expiry Risk, Excess Stock, Normal, Proposed Replenishment).
5. SKU search box: highlight every bin holding the SKU. ?sku= does the same on load.
6. A table view toggle for accessibility.
7. Wire "Locate" links from the Command Center and the line drawer.
8. `npm run check` and `npm run build`. Commit: "stage 5: warehouse 2D grid and panels".
```

### P21 — 3D scene

```text
Stage 5, step 3: the 3D scene. Follow implementationplan.md §11 exactly.

1. components/warehouse3d/Scene3D, loaded in WarehouseView with next/dynamic(() => import("./Scene3D"), { ssr: false }) (inside the client component).
2. <Canvas camera={{ position: [24, 18, 24], fov: 45 }} frameloop="demand">: floor, aisle labels, rack frames, ONE InstancedMesh for all bins (shared geometry and material, per-instance colour from severity), click → event.instanceId → bin id, hover tooltip with bin code and status, Drei OrbitControls with a Reset camera button, an Html label only for the selected bin.
3. Proposed mode: a second instanced mesh of semi-transparent cartons on the candidate bins, labelled "Proposed — not received".
4. ?sku= flies the camera to the first matching bin.
5. WebGL check (webgl2 context) and an error boundary → fall back to Grid2D automatically; a 2D/3D toggle is always visible.
6. Read the R3F/Drei docs installed in node_modules if unsure of an API. No external models or textures.
7. `npm run check` and `npm run build`. Then test in the browser: click a bin, switch modes, use ?sku=, toggle 2D. Commit: "stage 5: 3D warehouse".
```
**You check:** stage 5 Verify in plan §15, including the 2D fallback.

---

## Stage 6 — Agent orchestration (hours 22–25)

### P22 — Tools and orchestrator

```text
Stage 6, step 1: the AI orchestrator. Follow implementationplan.md §9.2, §9.3 and §9.4 exactly, plus architecture.md §9.

1. lib/agents/tools.ts: exactly the 19 tools in the §9.2 table. Each has a name, a description, a Zod input schema converted with z.toJSONSchema() and passed as parametersJsonSchema (keep schemas simple: no oneOf, no recursion) and a handler that calls services and returns a ToolResult (lib/validation/tool-contract.ts). Re-validate every input with Zod before running. recalculate_plan is the only write tool and audits with actor_type 'agent'. Do NOT add tools for approve, reject, PO creation or SQL.
2. lib/agents/prompts.ts: the §9.3 system prompt, byte for byte (sent as config.systemInstruction).
3. lib/agents/orchestrator.ts: runAgent({ message, planId }) with the §9.4 manual function-calling loop using @google/genai: model from GEMINI_MODEL (default gemini-flash-latest), systemInstruction, tools: [{ functionDeclarations }], functionCallingConfig mode AUTO, automaticFunctionCalling { disable: true }, maxOutputTokens 8192, httpOptions { timeout: 15000 }, max 8 turns. Append candidate.content EXACTLY as returned (keeps thoughtSignature parts), then all functionResponse parts in ONE user turn, in call order, with matching id and name. Catch ApiError and network/timeout errors. Missing GEMINI_API_KEY, any non-STOP finishReason, or any failure → deterministic fallback with source 'deterministic'.
   Check exact type names in node_modules/@google/genai/dist/genai.d.ts. Do not guess.
4. POST /api/agent/chat (Zod: message 1–2000 chars, optional planId), returning { reply, toolCalls, references, source }. Update /explain to try the agent first, then fall back to explain.ts.
5. Test 3 prompts from Appendix A with curl, once with the API key and once with it unset. Show me both.
6. `npm run check` and `npm run build`. Commit: "stage 6: agent tools and orchestrator".
```

### P23 — Ask panel, Why? and plan summary

```text
Stage 6, step 2: AI in the dashboard. Follow implementationplan.md §9.1 and §10.3 (Ask PharmaOS).

1. AskPanel (Sheet) on the plan screen: message box, conversation list, replies with `references` rendered as links (SKU → drawer, bin → warehouse), a "source: AI / calculated" tag, and a small note when the AI is unavailable.
2. The Why? popover shows the source tag too.
3. After createPlan, if the key is set, generate a 3–5 sentence plan summary through the agent (non-blocking), store it in assumptions_json.summary and show it above the Impact Card.
4. Run all 7 Appendix A prompts in the UI. Prompt 3 must recalculate the saved plan and list deferred lines. Prompts 6 and 7 must explain that the user edits and approves (the agent cannot). Prompt 2's numbers must match the drawer.
5. Remove GEMINI_API_KEY and confirm every button still works.
6. `npm run check` and `npm run build`. Commit: "stage 6: ask panel, why and summary".
```
**You check:** stage 6 Verify in plan §15.

---

## Stage 7 — Scenarios and polish (hours 25–27)

### P24 — Scenarios and ROI model

```text
Stage 7, step 1: scenarios and the Data & Scenarios screen. Follow implementationplan.md §12, §10.3 (Data & Scenarios) and architecture.md §7.7.

1. lib/scenarios/apply.ts: implement all 5 scenarios as IN-MEMORY changes to the planning context, exactly as the §12 table says, using SKUs from data/synthetic/demo-cases.json. Never write scenario effects to the seed tables.
2. lib/services/scenarios.ts: list, run (sets app_state.active_scenario_id, audit scenario.run), reset (baseline, audit scenario.reset). budget_cut makes ₹1,00,000 the budget for new and recalculated plans.
3. Routes: GET /api/scenarios, POST /api/scenarios/[id]/run, POST /api/scenarios/reset.
4. /data page: data summary (rows per table, as-of date, seed), the Data sources list from data_sources (name, link, label, what it informed), 5 scenario cards with Run/Reset, a "Recalculate current plan" button after Run, default budget input (audit settings.budget_changed), and components/scenarios/RoiModel with sliders for each problemstatement.md §11 assumption and live totals, labelled "Illustrative model — edit the assumptions".
5. Show the active scenario chip in the TopBar.
6. Unit tests for apply.ts (each scenario changes the expected field; baseline changes nothing).
7. Verify stage 7 in §15: budget cut → total ≤ ₹1,00,000 with deferred reasons; supplier delay re-ranks; Reset restores the baseline numbers. Show me before/after numbers.
8. `npm run check` and `npm run build`. Commit: "stage 7: scenarios and ROI model".
```

### P25 — Polish pass

```text
Stage 7, step 2: polish pass. No new features.

Go screen by screen (Command Center, Procurement list, Plan, drawer, Warehouse, POs, PO detail, Activity, Data) and fix:
1. Loading (Skeleton), empty, error and stale-data states everywhere (§10.1).
2. No inert buttons; every action disables while running and gives toast feedback.
3. Every status has colour AND text. Money is right-aligned, tabular-nums, formatINR.
4. Keyboard focus is visible; dialogs trap focus; Escape closes sheets.
5. The data-source badge is on every screen; nothing calls the data real or a supplier price a real quote (R8).
6. Grep for console errors and warnings in the dev server and the browser console, and fix them.
List every change you made. `npm run check` and `npm run build`. Commit: "stage 7: polish".
```

---

## Stage 8 — Freeze and rehearse (hours 27–30)

**Hour 27: feature freeze. From here on, only FIX prompts.**

### P26 — Definition-of-done audit (STOP)

```text
Stage 8, step 1: audit against the definition of done. Do not add features.

1. Go through implementationplan.md §18 line by line. For each item, state PASS or FAIL with evidence (file + test name, or the exact manual step you ran and what you saw).
2. Go through the §14.3 manual checklist the same way.
3. Check the rules R1–R10 (§0.1): grep for float money maths outside lib/money.ts, DB or agent imports in "use client" files, PO inserts outside approval.ts, audit inserts outside audit.ts, and Math.random in the engine or seed.
4. List every FAIL, ordered by demo impact.

STOP. Do not fix anything until I choose which FAILs to fix.
```

### P27 — Demo build and clean seed

```text
Stage 8, step 2: prepare the demo environment.

1. `npm run db:reset && npm run seed`. Confirm validation passes.
2. `npm run build`, then `npm run start`, and smoke-test every route at http://localhost:3000.
3. Time "Create plan" at ₹2,00,000 three times and report the measured time-to-reviewable-plan (this is the real number for the pitch).
4. If a local Postgres is available, seed it the same way and confirm the dashboard works against it by swapping DATABASE_URL (backup for demo day). If not, tell me how to set it up (plan §3.2).
5. Report anything that failed. Commit only if files changed: "stage 8: demo build".
```

### P28 — Demo notes

```text
Stage 8, step 3: demo notes. Create docs/demo-notes.md (no code changes).

Using implementationplan.md §17 and data/synthetic/demo-cases.json, write the exact click path for the 3–4 minute demo:
- which SKU to open at each step (its brand name and SKU code), which supplier comparison to show, which bin to click, which scenario to run, and which line to edit to what quantity;
- the expected numbers at each step, read from the running dashboard (not guessed);
- one fallback line per step if something fails (e.g. "If the AI is slow, use Why?, which is deterministic");
- the 3 questions judges are most likely to ask, with short honest answers (synthetic data, the forecast is a baseline, nothing is sent to suppliers).
Commit: "stage 8: demo notes".
```
Then rehearse the demo 3 times with a timer and record a backup video yourself.

---

## Reusable prompts

### FIX — when something is broken

```text
Something is wrong. Do not add features.

What I did: <steps>
What I expected: <expected>
What happened: <actual, including any error text>

1. Reproduce it and find the root cause. Show me the cause before changing code.
2. Fix it in the right layer (architecture.md §3). If it is a calculation bug, first add a failing unit test that captures it.
3. Run `npm run check` (and `npm run build` if UI or routes changed).
4. Commit: "fix: <short description>".
```

### CUT — when behind schedule

```text
We are behind schedule. It is hour <N> of 30 and the current stage is <stage>.

Using implementationplan.md §15.1 (cut order) and §18, tell me:
1. what to cut now, in cut-order, to reach a working demo by hour 27;
2. the minimum remaining prompts from prompts.md (or shortened versions of them) to get there;
3. what must not be cut.
Do not change any code until I confirm.
```

### STRETCH — only if ahead at hour 22

```text
We are ahead of schedule. Implement ONE P2 stretch item from implementationplan.md §15 Stage 8 ("P2 stretch"), in this order of preference:
1. polish the ghost cartons in Proposed mode;
2. a simulated put-away: from a plan line, "Simulate put-away" writes a warehouse_movements row (movement_type 'putaway_simulated', audited) and the bin shows the proposed stock;
3. a simple FEFO pick path for one SKU drawn in the 3D scene.
Stop after the first item, run `npm run check` and `npm run build`, and commit "stretch: <item>". Ask me before starting the next one.
```
