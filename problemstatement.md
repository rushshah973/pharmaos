# PharmaOS — Problem Statement

> Intelligent procurement agent for Indian pharmaceutical stockists.
> Hackathon build · solo builder · 30 hours · Version 1.0 (21 Oct 2026)
> Source of truth: *PharmaOS — Final Hackathon Spec* (v1 spec + final revisions). Companion file: `implementationplan.md`.

---

## 1. One-line problem

Indian pharma stockists lose money every day in two opposite directions — running out of fast movers and writing off expired slow movers — because the daily purchase decision is made by hand from scattered reports and supplier quotes, under a tight cash budget.

## 2. One-line solution

PharmaOS turns that 1–2 hour judgement call into a 10-minute reviewed decision: a budget-capped, explainable purchase plan that says what to buy, how much, from which supplier and why, then creates draft purchase orders only after a human approves them. An interactive 3D warehouse shows the same inventory, its risks and the proposed replenishment.

**Tagline:** Buy what will sell, before it runs out, without buying what will expire.

**Core promise:** every rupee of today's purchase budget goes where it prevents the most loss.

---

## 3. Who has the problem

### 3.1 Where the stockist sits

```
Manufacturer → C&F agent / super-stockist → STOCKIST / DISTRIBUTOR → retail chemist / hospital → patient
```

The stockist carries thousands of SKUs from many manufacturers, sells to chemists on 15–45 days of credit, and pays its suppliers on shorter terms. Its profit is a thin trade margin (roughly 8–10% on PTR, approximate) multiplied by how fast its stock turns. **Purchasing is the one decision that controls both.**

### 3.2 Market context (from the secondary research brief — verify before quoting externally)

| Fact | Figure | Source (as cited in the research brief) |
|---|---|---|
| Indian pharma turnover, FY 2023–24 | ₹4,17,345 crore; ~10% average annual growth over five years | Department of Pharmaceuticals, Annual Report 2024–25 |
| Indian pharma market (report estimate) | ~₹2.42 lakh crore in 2023, projected ₹4.60 lakh crore by 2030 | Pharmarack / IPA, 2024 |
| Independent distributors | More than 60,000 (report estimate) | Pharmarack / IPA, 2024 |
| Channel scale (older baseline) | ~65,000 stockists, ~9 lakh private retail chemists | Competition Commission of India market study |
| Availability gap | Prescribed brands unavailable in 10–60% of cases, depending on region | Vector Consulting study, reported by PharmaBiz (Feb 2025) |
| Inventory held | ~15 weeks across the chain, ~7 weeks at distributors | Same study |
| Inventory write-offs | 4–10% a year | Same study |

The Vector Consulting figures come from a trade-press report of a consulting study, not official statistics. Use them as "reported" numbers only.

### 3.3 Ideal first customer (hypothesis to validate)

| Attribute | Range |
|---|---|
| Annual turnover | ₹5–50 crore |
| Active SKUs | 2,000–10,000 |
| Suppliers / manufacturers | 30–150 |
| Purchase orders per day | 10–60 |
| Staff on purchasing | Owner + 1–2 purchase clerks |
| Systems | A pharma distribution ERP with CSV export; supplier quotes on WhatsApp |

### 3.4 Personas

| Persona | Role | What they want | What they fear |
|---|---|---|---|
| **Rakesh, owner** | Buyer and final approver | Higher margin, less cash stuck, fewer "why didn't we have it" calls | Software that orders on its own; losing control of supplier relationships |
| **Purchase manager / clerk** | Daily user | A ready list each morning instead of building it from three reports | Being blamed for a stockout or an expiry |
| **Accountant** | Influencer | Purchases that stay inside the cash plan; clean POs | Surprise commitments; scheme claims that never get credited |
| **Warehouse in-charge** | Secondary user | Knowing where incoming stock goes; FEFO picking | Overflowing bins; old batches buried behind new ones |

---

## 4. The three losses PharmaOS attacks

| Loss | How it happens today | Why it hurts | What PharmaOS changes |
|---|---|---|---|
| **Lost sales (stockout)** | The owner notices a fast mover is short only when a chemist's order fails | Chemists multi-source; a missed order often goes to a rival distributor and the chemist may not come back | Flags SKUs that will run out *before the supplier can deliver*, and buys them first |
| **Expiry write-off** | Slow movers are reordered on habit or to grab a scheme; old batches sit behind new ones | Manufacturer return policies are partial and time-boxed; past the window it is a straight loss | Projects sell-through per batch, does not count ineligible stock, and avoids reorders that deepen expiry exposure |
| **Frozen cash** | "Buy extra, it's on scheme" — free-goods offers inflate quantities beyond demand | Working capital is the binding constraint; cash in slow stock cannot fund fast movers | Computes the *effective* scheme price and takes a scheme only when the extra stock will sell before expiry |

## 5. Why the decision is hard (and why software has not fixed it)

1. **Data lives in four places:** ERP stock and sales reports, batch/expiry lists, supplier quotes on WhatsApp/PDF/phone, and the owner's head.
2. **Supplier offers are unstructured:** schemes like "10+1", "15% on 50 boxes" or "rate valid till Saturday" rarely reach the ERP in structured form.
3. **Trade-offs are multi-dimensional:** cheapest supplier vs fastest vs most reliable; scheme savings vs expiry risk; today's budget vs tomorrow's stockout.
4. **ERPs record, they don't decide:** pharma ERPs (e.g. Marg) handle billing, stock ledgers, batch/expiry tracking and schemes; B2B platforms (e.g. Pharmarack) digitise ordering. Neither tells the owner *what* to buy within a budget, or *why*.

**Positioning rule (from the research brief):** do not claim that inventory software does not exist. PharmaOS differentiates through cross-system decision coordination — one explainable, budget-aware purchase decision — and human-approved execution.

## 6. Why now

- LLMs can coordinate business tools and explain a recommendation in plain language, grounded in the numbers those tools return.
- Tool calling lets an agent orchestrate deterministic calculations instead of guessing numbers, which keeps every output auditable.
- Stockists already export CSVs from their ERP; no new data entry is needed to start.

---

## 7. Job to be done

> "Every morning, with ₹X to spend, tell me what to buy, how much, from whom, and why — so nothing important runs out, nothing I buy expires, and I approve it in one sitting."

## 8. Scope for the hackathon (one problem, gone deep)

Following the mentor's advice, the build covers **one** workflow — intelligent procurement — end to end. No other modules.

**In scope (P0 unless marked):**

1. Synthetic demo data in the full schema, generated with a fixed seed from patterns learned from reference datasets (the team's datasets and public sources such as an Indian medicine catalogue and NPPA price references). No reference row is copied; every row is labelled `synthetic_demo` and every reference is listed in the app.
2. Demand baseline, stock position, days of cover, reorder point, order quantity with pack/MOQ rounding.
3. Batch-level expiry assessment that changes the recommendation.
4. Supplier comparison: eligibility filter, scheme-aware landed cost, transparent weighted score.
5. Budget basket ranked by **loss prevented per rupee**, with deferred lines and reasons.
6. Editable plan with server-side recalculation and a **Plan Impact Card**.
7. Approve / reject / defer, draft POs grouped by supplier, idempotent approval, append-only audit log.
8. Interactive 3D warehouse on the same records (heatmaps, bin details, focus from a plan line), with a 2D fallback.
9. AI orchestrator (P1): one LLM calling typed tools, grounded explanations, full deterministic fallback.
10. Disruption scenarios (P1): demand spike, supplier delay/price change, budget cut, expiry risk.
11. Stretch (P2): ghost incoming cartons, candidate put-away, simple pick path.

**Out of scope:** real ERP or supplier integrations; sending POs, emails or payments; live IoT/RFID/robots; automatic medicine substitution or safety decisions; claims of proven ROI; receivables, cold-chain, routing or recall products; a chatbot-first interface.

## 9. Product principles (non-negotiable)

1. **Procurement first.** Forecasting, inventory, expiry, supplier and budget logic exist only to improve one purchasing decision.
2. **Deterministic numbers.** Server-side code computes every quantity, price, total and score. The LLM interprets, coordinates tools and explains — it never produces a number.
3. **Traceable.** Every recommendation links to its source rows, calculation inputs, quote timestamps and rules.
4. **Human in charge.** Draft POs are not supplier commitments. Nothing is sent externally.
5. **One source of truth.** The 3D warehouse, dashboards and plan all read the same database records.
6. **Honest data.** All demo data is labelled synthetic, with its reference sources listed. Supplier prices are never presented as real quotes, and an MRP or NPPA ceiling price is never used as a purchase price. No fabricated metrics, no fake integrations, no "sent / confirmed" without a verified event.
7. **Dashboard, not chatbot.** The AI works behind buttons and panels; chat is optional.

## 10. Success criteria

### 10.1 Demo success moment

The user runs procurement analysis, sees a ranked and explainable plan, changes the budget or a supplier condition, watches the plan recalculate, approves selected lines, and sees saved draft POs grouped by supplier plus the matching 3D warehouse view — all with an audit trail.

### 10.2 What the build measures (real numbers on the fixed test set)

| Metric | Target |
|---|---|
| Calculation correctness vs hand-computed fixtures | 100% of unit tests pass |
| Budget adherence | Plan total ≤ budget in every run and scenario |
| Supplier validity | 0 selected offers that are stale, unapproved, mismatched or over availability |
| PO integrity | PO total = Σ line totals; 0 duplicate POs on repeated approval |
| Time to reviewable plan | Seconds from "Create plan" to rendered plan (report the measured number) |
| Warehouse mapping coverage | % of inventory balances mapped to a valid bin |

### 10.3 North-star metric

**Loss prevented per rupee spent** on each plan = (₹ margin protected from stockouts + ₹ expiry exposure avoided) ÷ ₹ plan total. Computed by the same engine that builds the plan and shown on the Plan Impact Card.

## 11. Business case (illustrative — assumptions, not results)

| Lever | Assumption | Baseline loss / year | Assumed improvement | Annual value |
|---|---|---|---|---|
| Expiry write-off | 1.0% of ₹18 Cr purchases (conservative vs the reported 4–10%) | ₹18.0 L | 25% fewer write-offs | ₹4.5 L |
| Lost sales | 4% of demand unmet; 9% margin on ₹80 L lost revenue | ₹7.2 L margin | 25% recovered | ₹1.8 L |
| Working capital | ₹2.5 Cr inventory (~50 days); 14% cost of capital | — | 5 fewer inventory days = ₹25 L released once | ₹3.5 L |
| Purchasing time | 1.5 h/day owner time; 300 days; ₹500/h | ₹2.3 L | 1.2 h/day saved | ₹1.8 L |
| **Total** | | | | **≈ ₹11.6 L / year + ₹25 L one-time cash** |

At an assumed ₹5,000/month subscription, payback is under one month on these assumptions. In the demo this is shown as an editable "illustrative model", never as a measured result.

## 12. Assumptions and validation needed

- Synthetic demo data does not prove ROI or willingness to pay.
- The demand forecast is a transparent baseline, not advanced forecasting.
- Supplier prices, schemes, availability, stock, batches, POs and the warehouse layout are all simulated: no verified open dataset of Indian stockist operations exists (see the data acquisition plan).
- 3D coordinates and capacity are a virtual demo layout, not a live digital twin.
- Tax, scheme, supplier-return and product-handling rules must be verified before real use.
- Before a pilot: interview 5–10 stockists (ideally in Maharashtra), inspect their exports, agree a baseline metric, and run in shadow mode before any operational execution.

## 13. Pitch-slide version

> Indian pharma stockists lose money every day in two opposite directions — running out of fast movers and writing off expired slow movers — because the daily purchase decision is made by hand from scattered reports and WhatsApp quotes, under a tight cash budget. PharmaOS makes that decision in minutes, explains every rupee, and keeps the human in charge of approval.
