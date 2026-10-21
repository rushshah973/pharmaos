# PharmaOS — What Each Prompt Does

A plain-English companion to `prompts.md`. For every prompt: **what it does**, **what it creates or changes**, **what you will see when it is done**, and **why it matters** for the product or the demo. The prompts themselves (the text you paste) stay in `prompts.md`.

**Status** — ✅ done (commit) · ⏭ next · ⬜ not started. Last updated after P16.

| # | Prompt | Status |
|---|---|---|
| P00 | Session primer | reusable |
| P01 | Database | ✅ (no files changed) |
| P02 | Dashboard skeleton | ✅ `d9ce3b3` |
| P03 | Register reference datasets | ✅ `fc2268f` |
| P04 | Profile reference datasets | ✅ `89f9305` |
| P05 | Generate synthetic data | ✅ `db15a70`, then 500 products in `06691da` |
| P06 | Demo cases, validation and seed | ✅ `a58fe1b` |
| P07 | Engine tests first | ✅ `698bd9c` |
| P08 | Demand, expiry, inventory | ✅ `5ef2952` |
| P09 | Ordering, suppliers, totals, priority | ✅ `afa8ee2` |
| P10 | Basket, impact, validation, engine | ✅ `c3600d1` |
| P11 | Context loader and debug plan | ✅ `2b2b280` |
| P12 | Theme and shell | ✅ `6a1bb63` |
| P13 | Plan services and API | ✅ `2296530` |
| P14 | Command Center and plan list | ✅ `90d5ce4` |
| P15 | Plan screen | ✅ `8d364b0` |
| P16 | Line drawer and edit preview | ✅ `9d4d4bd` |
| P16B | ML demand model | ✅ |
| P17 | Approval service | ✅ |
| P18 | Purchase orders and Activity | ✅ |
| P19 | Heatmap, put-away and warehouse API | ⏭ |
| P20–P28 | … (plus P22B, P23B after P23) | ⬜ |

> Budget cap removed; ₹4,00,000 per-PO Owner approval added (after P13).
>
> Added after P16: ML demand model (P16B) and three-agent pipeline (P22B, P23B). The build now runs about 42 hours instead of 30, by choice.

After P16B: the seed now **simulates daily operations** (twice-weekly reviews, realistic 1–3 day distributor lead times plus one slower manufacturer-direct channel, late deliveries, FEFO sales, real PO history), the stockout explanation says plainly how many days you will be without stock, and the Command Center shows **Reorder in the next 7 days** with an order-by date.

---

## How the prompts fit together

```
Stage 1  Data         P01 → P06   database, skeleton, reference patterns, 500 synthetic SKUs, demo cases
Stage 2  Engine       P07 → P11   tests first, then the maths that decides what to buy
Stage 3  Screens      P12 → P16B  the dashboard: Command Center, plan, line details, edits; then the ML demand model
Stage 4  Approval     P17 → P18   human approval → POs, Owner sign-off above ₹4L, simulated send, audit trail
Stage 5  Warehouse    P19 → P21   heatmaps, 2D grid, 3D scene
Stage 6  AI           P22 → P23B  Gemini explains plans; then three agents (Demand, Supplier, Order) make guarded decisions and create POs (never send or Owner-approve)
Stage 7  Scenarios    P24 → P25   disruptions, ROI model, polish
Stage 8  Demo         P26 → P28   audit, clean build, demo notes
```

Each stage builds on the one before. The engine (stage 2) needs the data (stage 1); the screens (stage 3) show what the engine computes; approval (stage 4) turns screen decisions into POs; the warehouse, AI and scenarios all reuse the same engine, so every number on every screen agrees.

---

## P00 — Session primer

- **What it does:** Makes the AI assistant read the four project documents, check git to see which stages are finished, and tell you where things stand before it touches any code.
- **Creates or changes:** Nothing.
- **You will see:** A short report: last completed stage, next prompt, any uncommitted changes.
- **Why it matters:** A new chat session remembers nothing. P00 loads the rules (no new features, numbers only from the engine, nothing ever leaves the app) so the assistant does not drift from the plan.
- **When:** At the start of every new chat session.

---

## Stage 1 — Foundation and data

### P01 — Database ✅

- **What it does:** Creates all the database tables in your Supabase project from the ready-made schema, then checks they are really there.
- **Creates or changes:** Tables in Supabase only (17 tables + a migrations tracker). No project files.
- **You will see:** A list of the tables, the 5 demo scenarios (baseline, demand spike, supplier delay, expiry risk, and budget cut — later replaced by seasonal surge), and the settings row.
- **Why it matters:** Everything else stores and reads data here. The schema also enforces safety rules itself, e.g. a recommendation can become a PO line only once, and the audit log can never be edited.

### P02 — Dashboard skeleton ✅

- **What it does:** Replaces the Next.js starter page with the first PharmaOS page and adds two small server services every later step uses.
- **Creates or changes:** `app/(dashboard)/layout.tsx`, `app/(dashboard)/page.tsx`, `lib/services/as-of.ts`, `lib/services/audit.ts`.
- **You will see:** http://localhost:3000 shows "Command Center — Scenarios in database: 5".
- **Why it matters:** Proves the web dashboard can read the database with Next.js 16's new caching rules. `as-of` decides which date counts as "today" (so demo numbers stay reproducible); `audit` is the single place that records every change.

### P03 — Register reference datasets (STOP) ✅

- **What it does:** Looks at the reference files (the public medicine catalogue and the sales sample), shows you their format, labels where each came from, and records this in `sources.json`. It copies nothing and generates nothing.
- **Creates or changes:** `data/reference/sources.json`. The data files themselves stay local and are never committed.
- **You will see:** File sizes, column headers, three sample rows each, and the proposed labels (`public_reference`, `unverified_sample`). It stops for your approval.
- **Why it matters:** Honest provenance. The app can later show judges exactly which public sources shaped the synthetic data, and that no real stockist data or real supplier price is being passed off as real.

### P04 — Profile reference datasets (STOP) ✅

- **What it does:** Reads the reference files and writes down only **statistics**: e.g. "60% of medicines are tablets", "median antibiotic price ≈ ₹67", "41% of days have no sale". It then proves no names were copied.
- **Creates or changes:** `scripts/seed/catalog.ts` (category keyword map, PTR factor), `scripts/seed/profile-reference.ts`, `data/reference/profile.json`, the `npm run profile` command.
- **You will see:** `profile.json` and a plain-English summary, plus a no-copy check (real brand and company names searched for and not found). It stops for your review.
- **Why it matters:** This is how the reference data is used *as a reference*: the synthetic data copies the patterns, never the rows.

### P05 — Generate synthetic data ✅

- **What it does:** Builds a complete, realistic stockist in memory from those statistics: 500 medicines, 8 suppliers, about 1,000 supplier quotes, 90 days of sales, 240 warehouse bins, batches with expiry dates, stock in bins, and incoming purchase orders. Brand, company and supplier names are invented.
- **Creates or changes:** `scripts/seed/prng.ts` (repeatable randomness), more lists in `catalog.ts`, `scripts/seed/generate-synthetic.ts`, `tests/unit/generator.test.ts`.
- **You will see:** Tests passing. Nothing is written to the database yet.
- **Why it matters:** The same seed always produces the same data, so the demo is reproducible. Every row is labelled `synthetic_demo`.

### P06 — Demo cases, validation and seed ✅

- **What it does:** Makes sure the realistic problems PharmaOS is built to catch actually exist in the data (some SKUs about to run out, batches near expiry, a cheap-but-slow supplier, a stale quote, a full cold room…), checks everything thoroughly, then loads it all into Supabase.
- **Creates or changes:** `scripts/seed/inject-demo-cases.ts`, `validate.ts`, `write.ts`, `index.ts` (the `npm run seed` command), `data/synthetic/demo-cases.json`.
- **You will see:** A table of rows written (500 products, 45,000 sales rows…) and `demo-cases.json`, which lists which SKUs show which situation.
- **Why it matters:** The demo needs clear examples to show. Important: the engine never reads `demo-cases.json` — it must find these problems on its own with the same rules for every SKU. The validator refuses to seed if any rule is broken or any reference name was copied.

---

## Stage 2 — Calculation engine

### P07 — Engine tests first ✅

- **What it does:** Writes the answer key before the engine: small hand-made examples with exact expected results (e.g. "this sales history must give demand 9.2 and an order of exactly 90 packs"). It also creates empty engine files with their final function signatures.
- **Creates or changes:** `lib/business-logic/types.ts`, 12 stub engine modules, `tests/fixtures/engine.ts`, `tests/unit/engine/f1…f9`.
- **You will see:** 30 tests failing with "not implemented" — on purpose.
- **Why it matters:** Wrong numbers on stage would destroy trust. Writing the tests first means every formula is proven against hand-computed answers.

### P08 — Demand, expiry, inventory ✅

- **What it does:** Implements the first half of the maths: how much each medicine sells per day, which batches will sell before they expire (first-expiry-first-out), how much usable stock there really is, how many days it will last, and when to reorder.
- **Creates or changes:** `dates.ts`, `demand.ts`, `expiry.ts`, `inventory.ts` in `lib/business-logic/`.
- **You will see:** F1 (demand part), F4 and matching F8 tests turning green.
- **Why it matters:** This is how PharmaOS knows a SKU will run out *before the supplier can deliver*, and that near-expiry or quarantined stock must not be counted.

### P09 — Ordering, suppliers, totals, priority ✅

- **What it does:** Implements the second half: how many packs to order (rounded to pack size and minimum order), whether a "10+1" scheme is worth taking given expiry, which supplier wins on cost, speed, reliability and payment terms, the rupee totals with GST and freight, and how much loss each line prevents per rupee.
- **Creates or changes:** `ordering.ts`, `supplier-scoring.ts`, `totals.ts`, `priority.ts`.
- **You will see:** F1, F2, F3, F5, F7 and matching F8 tests green.
- **Why it matters:** This is the "why Supplier B and not A?" logic and the money maths that must be exact to the paisa.

### P10 — Basket, impact, validation, engine ✅

- **What it does:** (Historical: it fitted lines into a budget; that budget logic was removed after P13 — plans now include every SKU that needs stock.) It computes the Plan Impact Card, the approval hard stops, and wires everything into two main functions: analyse one SKU, and build a whole plan.
- **Creates or changes:** `basket.ts`, `impact.ts`, `validation.ts`, `engine.ts`; removes the temporary `_stub.ts`.
- **You will see:** All engine tests F1–F9 green (the budget-basket tests were later replaced by plan-assembly and approval-limit tests).
- **Why it matters:** This is the whole decision engine. Every screen, the warehouse heatmap and the AI all call these same functions.

### P11 — Context loader and debug plan (STOP) ✅

- **What it does:** Connects the engine to the real database, switches the seed checks from their temporary formulas to the real engine, and prints a sample plan in the terminal (at that time at ₹2,00,000 and ₹1,00,000; the budget was removed after P13).
- **Creates or changes:** `lib/db/queries/*`, `lib/services/context.ts`, `lib/scenarios/apply.ts` (empty for now), `scripts/debug-plan.ts`; updates `inject-demo-cases.ts` and `validate.ts`; re-seeds.
- **You will see:** The top 20 recommended purchases with reasons. It stops so you can judge whether the ranking makes sense to an owner.
- **Why it matters:** The first time you see PharmaOS actually deciding what to buy — before any screen exists, so mistakes are cheap to fix.

---

## Stage 3 — Procurement UI

### P12 — Theme and shell ✅

- **What it does:** Gives the dashboard its premium look (plan §10.1: layered dark surfaces, one teal accent, refined type and spacing, logo mark): dark navy and teal, the left sidebar with six sections, the top bar with the "Synthetic demo data" badge, date and (after P13) the ₹4,00,000 approval limit, and placeholder pages for every section.
- **Creates or changes:** `app/globals.css`, `app/layout.tsx`, `components/layout/*`, placeholder pages.
- **You will see:** A professional web dashboard where every sidebar link works; the sidebar shrinks to icons at tablet width.
- **Why it matters:** First impression for judges, and the frame every later screen sits in.

### P13 — Plan services and API ✅

- **What it does:** Builds the server side of planning: create a plan (every SKU that needs stock, most urgent first, no budget), read it, edit a line (with a preview before saving that shows the new total and each supplier's PO total), recalculate with fresh data, and the calculated "Why?" explanation. It also projects one PO per supplier and flags any above ₹4,00,000 as needing Owner approval.
- **Creates or changes:** `lib/validation/api.ts`, `lib/services/plans.ts`, `dashboard.ts`, `explain.ts`, and the matching `app/api/...` routes.
- **You will see:** The assistant testing each route and showing you the responses.
- **Why it matters:** Totals are always recomputed on the server; the browser is never trusted with money.

### P14 — Command Center and plan list ✅

- **What it does:** Builds the home screen: proposed spend, SKUs at stockout risk, rupees at expiry risk, lines waiting for a PO, POs waiting for the Owner's approval, the most critical SKUs, and the **Create Purchase Plan** button (no budget to enter). Also the list of past plans.
- **Creates or changes:** `app/(dashboard)/page.tsx`, `components/dashboard/*`, `app/(dashboard)/procurement/page.tsx`.
- **You will see:** Real numbers from the database and a working Create Purchase Plan dialog.
- **Why it matters:** The opening of the demo ("this is what a stockist sees every morning").

### P15 — Plan screen ✅

- **What it does:** Builds the main working screen: the Plan Impact Card, a strip showing each supplier's PO total (amber "Owner approval" badge above ₹4,00,000), the ranked table of what to buy, flags and reasons, defer/reject actions, a "Not in this plan" list with each line's risk, and a Recalculate button.
- **Creates or changes:** `app/(dashboard)/procurement/[planId]/page.tsx`, `ImpactCard`, `SupplierPoStrip`, `PlanTable`, the "Not in this plan" list.
- **You will see:** A full plan you can read, sort through and adjust.
- **Why it matters:** The heart of the product — where the owner makes today's buying decision.

### P16 — Line drawer and edit preview ✅

- **What it does:** Opens one recommendation in a side panel: demand chart, stock breakdown, batches and expiry, every supplier compared (including why some were excluded), the formulas with real numbers filled in, and an edit control that shows the new total before saving.
- **Creates or changes:** `LineDrawer`, `DemandChart`, `SupplierComparison`, `FormulaPanel`, edit controls.
- **You will see:** Complete evidence for any line; edits preview and save, and the preview warns when a supplier's PO would cross ₹4,00,000; invalid quantities (below MOQ, wrong pack multiple) are refused with the reason.
- **Why it matters:** "Explain every rupee" — the trust moment for judges and owners.

### P16B — ML demand model ✅

- **What it does:** Replaces "a weighted average of the last 7 and 28 days" with a real machine-learning forecast where — and only where — it is measurably better. One ridge-regression model learns from every SKU's sales at once: recent days, rolling averages, how steady or patchy sales are, the trend, the day of the week and the product category. It is trained on all but the last 14 days, then tested on those 14 days it never saw. For each SKU, PharmaOS uses the ML forecast only if its error on that test was clearly lower than the average's; otherwise it keeps the average and says so.
- **Creates or changes:** `lib/ml/` (features, ridge solver, forecaster, backtest), `npm run train:forecast` (also run by the seed), the `003_ml_and_agents.sql` migration, the forecast inside the planning context, the drawer's dashed 14-day forecast and accuracy line, and a "Demand model" card on the Data page. Tests for every piece.
- **You will see:** The training script prints the real errors (ML vs average); a line's drawer says, e.g., "ML error 18% vs average 27% on the last 14 days → using ML" — or the honest reverse.
- **Why it matters:** Real ML, honestly measured: the model learns weekly patterns, growth and decline that the average ignores, and the dashboard never claims accuracy the test does not show. Scenarios change the forecast live because it reads the current sales.

---

## Stage 4 — Approval and audit

### P17 — Approval service ✅

- **What it does:** Builds the only code allowed to create purchase orders: re-checks every rule with fresh data, groups approved lines by supplier and creates one PO per supplier inside one database transaction (a PO above ₹4,00,000 is held as "Awaiting Owner approval"), and makes a double click or retry harmless. Also adds the Owner's Approve / Reject for held POs and a simulated "Send to supplier" that refuses held POs. Adds Approve and Reject plan to the screen.
- **Creates or changes:** `lib/services/approval.ts`, PO approve/reject/send in `purchase-orders.ts`, their routes, approval dialog, an optional integration test.
- **You will see:** Approving 5 lines across 3 suppliers creates 3 POs; repeating the request creates nothing extra; a PO above the limit cannot be sent until the Owner approves it.
- **Why it matters:** Human control: nothing is ordered without a person, large orders need the Owner's sign-off, nothing actually leaves the app (sending is simulated), and money can never be committed twice.

### P18 — Purchase orders and Activity ✅

- **What it does:** Builds the PO list and a printable PO document (watermarked "NOT SENT" until sent, then "SENT (simulated)") with Approve / Reject for the Owner, Send (simulated), CSV export and Print, and the Activity log showing every action.
- **Creates or changes:** `lib/services/purchase-orders.ts`, PO and audit routes, `/purchase-orders`, `/activity`.
- **You will see:** Printable POs with their status, the Owner approval step for large ones, and a complete history of who changed what.
- **Why it matters:** Accountability and the clean ending of the demo ("a human approved every line, the Owner signed off the big PO, nothing left the app").

---

## Stage 5 — Warehouse

### P19 — Heatmap, put-away and warehouse API ⏭

- **What it does:** Works out, for every bin, whether it holds stock at stockout risk, expiry risk or excess, and where newly ordered stock could go. Builds the server routes for the layout, heatmaps, bin details and product search.
- **Creates or changes:** `heatmap.ts`, `putaway.ts` (+ tests), `lib/warehouse/geometry.ts`, `lib/services/warehouse.ts`, warehouse routes.
- **You will see:** Spot checks showing that a stockout SKU's bin really is marked stockout.
- **Why it matters:** The warehouse view uses the same engine as the plan, so a red bin and a stockout line can never disagree.

### P20 — 2D grid and panels ⬜

- **What it does:** Builds the warehouse page as a 2D grid first (aisles, racks, shelves), with heatmap modes, a bin detail panel, a legend, product search and "Locate" links from the plan.
- **Creates or changes:** `WarehouseView`, `Grid2D`, `BinPanel`, `Legend`, `ModeSelect`.
- **You will see:** A working warehouse map you can click through.
- **Why it matters:** A reliable fallback if 3D fails on the demo laptop, and the data layer the 3D scene reuses.

### P21 — 3D scene ⬜

- **What it does:** Adds the interactive 3D warehouse: rotate, zoom, click a bin, switch heatmaps, fly to a searched SKU, and see proposed stock as see-through "ghost" cartons. Falls back to 2D automatically if 3D is not supported.
- **Creates or changes:** `Scene3D` and its loading in `WarehouseView`.
- **You will see:** A 3D warehouse linked to each recommendation.
- **Why it matters:** The visual "wow" moment, built on the same records as everything else.

---

## Stage 6 — AI (Gemini)

### P22 — Tools and orchestrator ⬜

- **What it does:** Connects Gemini. Gives it 19 safe, typed tools (look up sales, stock, batches, suppliers, plan…; one tool to recalculate a plan) and a strict system prompt. It runs Gemini's tool loop with a timeout, and falls back to the calculated explanation if anything fails.
- **Creates or changes:** `lib/agents/tools.ts`, `prompts.ts`, `orchestrator.ts`, `/api/agent/chat`; `/explain` tries the AI first.
- **You will see:** Test questions answered with numbers that come from the tools — once with the Gemini key, once without.
- **Why it matters:** This chat agent explains and can recalculate, but can never approve, create or send a PO, and never invents a number. (Creating POs is reserved for the guarded Order Agent in P22B.)

### P23 — Ask panel, Why? and plan summary ⬜

- **What it does:** Puts the AI into the dashboard: an "Ask PharmaOS" side panel, AI answers behind each **Why?** button, and a short AI summary above a new plan. Tests all 7 demo questions.
- **Creates or changes:** `AskPanel`, Why? popover updates, plan summary.
- **You will see:** Natural-language answers with links to SKUs and bins, and a clear "calculated" label when the AI is off.
- **Why it matters:** "Dashboard, not chatbot" — AI where it helps, and everything still works without it.

### P22B — Agent pipeline: Demand, Supplier and Order agents ⬜

- **What it does:** Builds three AI agents that take real decisions, one after another, for the most urgent lines of a plan. The **Demand Agent** looks at each SKU's sales and both forecasts (ML and average, with their measured errors) and picks which one to trust — it can only pick a method, never type a number. The **Supplier Agent** compares the offers and the supplier PO totals and may switch a supplier (faster, cheaper, fewer suppliers, or keeping a PO under the ₹4,00,000 Owner limit) — but only to an offer that passes every rule. The **Order Agent** checks the lines and creates the purchase orders through the same approval code a human uses. Every decision is checked by code before it takes effect; rejected decisions are recorded, not applied.
- **Creates or changes:** `lib/agents/pipeline/` (shared tool loop, the three agents, the run), `/api/agents/run` and the run-status routes, the `agent_runs` / `agent_steps` trace, audit entries, and tests with a scripted fake Gemini.
- **You will see:** A real run changes some lines (with the agent's reason) and creates POs grouped by supplier; one may need Owner approval. Without the Gemini key the run ends "fallback" and changes nothing.
- **Why it matters:** This is the agentic core, and it is real: the agents decide, their decisions change the plan and create POs, and code guardrails keep them inside the rules. They can never send a PO, approve a large PO for the Owner, or change the limit.
- **Decided (22 Oct 2026):** Add a cost-of-delay comparison here. For each offer, compare the rupees lost from the expected days without stock (gap days × average daily demand × margin) against the price saving, so "faster vs cheaper" is decided by a number the Supplier Agent can see. Code computes it; the agent may only pick an offer that passes the rules.

### P23B — Agent run view ⬜

- **What it does:** Adds a "Run procurement agents" button and a live panel that shows the three agents working: which tools each one called, what came back, every decision with its reason and whether the guardrail accepted it, and the results — lines changed and POs created.
- **Creates or changes:** `RunAgentsButton`, `AgentRunPanel`, past runs, agent reasons in the line drawer.
- **You will see:** The trace filling in live; afterwards the plan, the PO list and the Activity log all show what the agents did.
- **Why it matters:** Judges can watch the agents work and check every step — nothing is hidden or staged.

---

## Stage 7 — Scenarios and polish

### P24 — Scenarios and ROI model ⬜

- **What it does:** Makes the five disruption scenarios work (seasonal surge, supplier delay, demand spike, expiry risk, baseline) without changing the stored data, and builds the Data & Scenarios page: data summary, list of reference sources, scenario cards, the Owner approval limit setting, and an editable ROI model. Scenarios change the sales the ML forecast reads, so the forecast moves with them.
- **Creates or changes:** `lib/scenarios/apply.ts`, `lib/services/scenarios.ts`, scenario routes, `/data` page, `RoiModel`, scenario chip in the top bar.
- **You will see:** Running "Seasonal surge" and recalculating pushes at least one supplier's PO above ₹4,00,000, so it shows the Owner approval badge; Reset restores everything.
- **Why it matters:** The live disruption moment in the pitch, and an honest business case.

### P25 — Polish pass ⬜

- **What it does:** Goes screen by screen fixing loading, empty and error states, button feedback, colour-plus-text statuses, money alignment, keyboard focus, labels and console errors. No new features.
- **Creates or changes:** Small fixes across screens.
- **You will see:** A list of every change.
- **Why it matters:** Small rough edges are what judges notice first.

---

## Stage 8 — Freeze and rehearse

### P26 — Definition-of-done audit (STOP) ⬜

- **What it does:** Checks every "done" item and every rule in the plan, with evidence (including the ML backtest numbers and the agents' guardrails and trace), and lists anything that fails, most demo-critical first. Changes nothing.
- **Creates or changes:** Nothing.
- **You will see:** PASS/FAIL per item. It stops so you choose what to fix.
- **Why it matters:** Catches problems before judges do.

### P27 — Demo build and clean seed ⬜

- **What it does:** Re-seeds to a clean state, builds and runs the production version, smoke-tests every page, measures the real time to create a plan and to run the agents, checks the demand model was trained, and prepares a local-database backup.
- **Creates or changes:** Usually nothing.
- **You will see:** A smoke-test report and the measured plan time for your pitch.
- **Why it matters:** The demo runs on the same build you tested, with a backup ready.

### P28 — Demo notes ⬜

- **What it does:** Writes the exact click path for the 3–4 minute demo: which SKU to open (one where ML wins, one where it does not), which bin to click, which scenario to run, the agent run and what each agent changed, the Owner approval moment for the large PO, the numbers you will see, a fallback for each step, and honest answers to likely judge questions.
- **Creates or changes:** `docs/demo-notes.md`.
- **You will see:** A script you can rehearse from.
- **Why it matters:** A calm, rehearsed demo. Afterwards: rehearse 3 times and record a backup video.

---

## Reusable prompts

| Prompt | Use it when | What it does |
|---|---|---|
| **FIX** | Something is broken | Reproduces the problem, shows you the cause first, adds a failing test for calculation bugs, fixes it in the right place, re-checks and commits |
| **CUT** | You are behind schedule | Uses the plan's cut order to tell you what to drop and the shortest path to a working demo by hour 39; changes nothing until you agree |
| **STRETCH** | You are ahead at hour 27 | Adds one optional extra (ghost-carton polish, simulated put-away, or a pick path), then stops and asks before the next |
