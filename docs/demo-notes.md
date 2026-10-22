# PharmaOS — demo notes (3–4 minutes)

Click path for the live demo at <https://pharmaos-gold.vercel.app>, following `implementationplan.md` §17.
Every number below was read from the running app on 22 Oct 2026, right after a fresh reseed
(`npm run db:reset && DEMO_AS_OF_DATE=2026-10-21 npm run seed`). With the same seed the engine gives the same
numbers every time. Agent decisions come from Gemini and can differ from run to run, so read them off the trace.

> The Owner approval limit is **₹10,00,000 per purchase order** (it was ₹4,00,000 in earlier specs; it was raised
> for mid-size stockist volumes).

---

## Before the demo (10 minutes ahead)

1. Reseed so the app starts clean: `npm run db:reset && DEMO_AS_OF_DATE=2026-10-21 npm run seed`
   (must end with `Validation passed.`).
2. Open <https://pharmaos-gold.vercel.app/api/health>: expect `"ok":true` and `"gemini":true`.
3. Open the Command Center once so the server is warm.
4. **Gemini is the slow part.** On 22 Oct a full agent run took 4–5 minutes, and one run hit the 270-second limit
   before the Order Agent finished. Do a rehearsal agent run on a plan before the demo, so you have a finished trace
   to show if the live run is slow (see step 6).

---

## 1. (0:00) The pain — Command Center

**Click:** open the app (Command Center). Point at the **Synthetic demo data** badge, top right.

**Say:** "A stockist with 500 SKUs. Some are about to run out, some will expire, and orders are placed by gut feel."

**Expect:**

| Where | Value |
|---|---|
| Header | As of 21 Oct 2026 · 500 active SKUs |
| Status chips | Stockout risk **15** · Below ROP **17** · Healthy **374** · Excess **94** · No demand **0** |
| Workflow rail | Step 1 done (forecast); **Step 2 Plan reorders is current** (32 SKUs below their reorder point) |
| Needs attention | 15 SKUs run out before stock arrives (12 can be ordered in a new plan, 2 wait for a PO already coming) · ₹28,659 of stock may expire unsold |
| Closest to running out | Vexolin 500 (PHX-0115), Revolin 100 (PHX-0220), Saviquil 200 (PHX-0048), Lumolix 15 (PHX-0361) |
| Reorder in the next 7 days | 95 SKUs |

**If it fails:** if a card shows "could not load", press Retry once; the database pool recovers within seconds.

## 2. (0:30) Create the plan

**Click:** **Create Purchase Plan** → **Create plan** (leave Priorities empty). It takes about 2 seconds.

**Say:** "One click checks every SKU against demand, stock, expiry and supplier offers, then ranks what to buy first."

**Expect (Impact Card):**

| Field | Value |
|---|---|
| Total spend | **₹3,95,896** (27 lines; 3 more listed under "Not in this plan") |
| Stockouts covered | **12 / 15** |
| Loss prevented per ₹100 | **₹2.22** |
| Show details | Margin protected ₹2,477 · Expiry avoided ₹6,326 · Expiry exposure ₹28,659 · **6 supplier POs, none above ₹10,00,000** |
| Biggest supplier PO | SUP-01 Shreeji Medical Agencies ₹1,47,744.51 (7 lines) |

An AI plan summary appears at the top a few seconds later; it is not needed for the demo.

**If it fails:** if the plan doesn't open, go to **Plans** and open the newest one. The plan is saved even if the page is slow.

## 3. (1:00) Why this line? — supplier comparison and the ML moment

**Click:** in the plan table open **#10 Kelolin 50 (PHX-0081)**. The line drawer opens.

**Expect in the drawer:**

- Stock **12 packs**, cover **0.5 days**, reorder point 145, target 484. The engine orders **480 packs**.
- Supplier comparison, with reason chip **CHEAPER_OFFER_TOO_SLOW**:

| Supplier | Landed cost / pack | Lead time | Result |
|---|---|---|---|
| **SUP-02 Ambika Distributors** | ₹47.64 | 1 day | **Chosen** (score 96.2) |
| SUP-01 Shreeji Medical Agencies | ₹46.20 (about 3% cheaper) | 7 days | Excluded: `TOO_SLOW_FOR_COVER` (stock runs out in 0.5 d) |
| SUP-08 Kalpataru Enterprises | — | 2 days | Excluded: `SUPPLIER_NOT_APPROVED` |

**Say:** "The cheapest supplier is skipped because it would deliver 6 days after the shelf is empty."

**Click:** **Why?** The answer cites the drawer's numbers: SUP-01 is 3% cheaper but takes 7 days, which is after
the projected stockout.

**ML moment (two drawers, about 15 s each):**

- **ML wins:** open **#26 Bexomox 20 (PHX-0194)**. Its accuracy line shows the ML blend at **28%** error against the
  average's **31%**, so it uses ML.
- **ML does not win:** open **#20 Mevizol 5 (PHX-0279)**. It sells about 0.2 packs a day, so the ML blend's error is
  **527%** against the average's **189%**, and it uses the **average**. Say: "Where ML doesn't beat the simple
  average, we say so and use the average."

**If it fails:** "Why?" waits for Gemini and on 22 Oct took up to **98 seconds** before answering with the
calculated explanation. If it spins, close it and read the reason chips and the supplier table in the drawer; they
are calculated and need no AI.

## 4. (1:30) Edit a line

**Click:** in the Kelolin 50 drawer, change the quantity from **480** to **600** and save.

**Expect:**

| | Before | After |
|---|---|---|
| Kelolin 50 line total | ₹22,865.70 | **₹28,582.12** |
| Plan total | ₹3,95,896.48 | **₹4,01,612.90** |
| SUP-02 Ambika Distributors PO | ₹56,403.48 | **₹62,119.90** |

The server recalculates the totals; the line shows **Edited**. Optional: type **485** to show the refusal, "Quantity must
be a multiple of the supplier's pack multiple" (packs of 10).

**If it fails:** skip it; the edit is not needed for later steps.

## 5. (1:45) Warehouse — find the bin

**Click:** **Warehouse** → search **PHX-0081**. The camera flies to bin **A-L-05-1**; click it.

**Expect:** the bin holds Kelolin 50, **12 packs** in 2 batches (BA7RDIH, expires 18 Sep 2028; BKY73UF, expires
4 Nov 2028), status Stockout risk. The **Stockout** heatmap highlights **22 bins**.

**Click:** switch the mode to **Expiry risk**. **14 bins** light up. The same bin A-L-05-1 turns amber: it also holds
**Peracip 75 (PHX-0026)**, with about 24 packs at risk in batch B4XMC5S (expires 10 Mar 2027, 140 days). The worst
bin, **B-L-05-2**, holds 18 packs of already expired stock (PHX-0332).

**If it fails:** if 3D doesn't load, use the **2D** toggle; it uses the same data.

## 6. (2:20) Disruption — Seasonal surge

**Click:** **Data & AI** → **Seasonal surge** → **Run**. Go back to the plan (Plans → the plan) → **Recalculate**
(about 2 seconds).

**Expect:**

| | Value |
|---|---|
| Total spend | **₹43,52,648** |
| Stockouts covered | 13 / 23 |
| Supplier POs | 6, **1 needs the Owner** |
| **SUP-03 Padmavati Pharma Agencies** | **₹11,00,150.60** (25 lines), amber **Owner approval** badge |
| Next largest | SUP-02 Ambika Distributors ₹7,92,146.29 · SUP-01 Shreeji Medical Agencies ₹6,98,869.52 |

The Kelolin 50 edit (600 packs) stays as edited.

**If it fails:** if Recalculate is slow, create a new plan instead (Command Center → Create Purchase Plan); it picks
up the active scenario.

## 7. (2:50) Agents

**Click:** **Run procurement agents**. The agent panel opens with the live trace.

**Say:** "The engine and the ML model calculate. Three agents decide within guardrails, and every tool call is in the trace."

**What each agent does (read the decisions off the trace):**

- **Demand Agent** chooses ML or the average per SKU, never a number. In the rehearsal on this plan it changed 3 lines:
  - **PHX-0355 Tervocip 400**: ML → average (55 → 880 packs), because of a demand spike;
  - **PHX-0331 Bexocort 0.05**: ML → average (390 → 380), "Baseline has lower WAPE (0.2076 vs 0.2343)";
  - **PHX-0115 Vexolin 500**: ML → average (545 → 545), average error 52% vs ML 56%.
- **Supplier Agent** can only pick an offer that passes every check. In the rehearsal it switched PHX-0355 from SUP-06
  to SUP-02 and kept 14 lines.
- **Order Agent** validates the lines and creates POs through the same approval service as the Approve button:
  **Ready** up to ₹10,00,000, **Pending approval** above it. It cannot send or Owner-approve.

**Timing warning:** in the rehearsal this run took **277 seconds**. The Demand and Supplier agents finished; the Order
Agent hit the time limit, so the run ended "AI unavailable — review and approve manually" and created **no POs**. An
earlier run on the baseline plan (same seed) succeeded: the Demand Agent changed 10 lines and the Order Agent created
6 POs. Decisions vary per run.

**If it fails:** let the trace run for 20–30 seconds while you explain it, then say "this keeps going in the
background" and continue to step 8 with the human Approve button. If it ends in fallback, that is the safety design:
no AI changes, the person approves manually. If you rehearsed on another plan, open that plan from **Plans** and
its agent panel shows the finished trace.

## 8. (3:20) Owner approval and Send

**Click:** in the plan, select all lines (header checkbox) → **Approve selected**. The confirmation dialog lists one PO
per supplier and marks SUP-03 as needing the Owner → **Approve**.

**Expect:** 6 POs. **PO-20261022-1006 · SUP-03 Padmavati Pharma Agencies · ₹11,00,150.60 · Pending approval**,
delivery 25 Oct 2026. (The PO number can differ if POs were created earlier that day.)

**Click:** **Orders** → **Awaiting Owner approval** → open the SUP-03 PO.

**Say:** "Send is blocked." The PO has **no Send button**, only **Approve as Owner** and **Reject**, and its timeline
says it waits for the Owner. The server enforces this too: a send request for this PO is refused with
`APPROVAL_REQUIRED`, "…is above the Owner approval limit and needs Owner approval before it can be sent" (tested).

**Click:** **Approve as Owner** → add a note such as "Monsoon stock-up" → **Approve PO** → status **Approved**, and
**Send to supplier (simulated)** appears → click it → status **Sent**, labelled "Marked as sent — simulated, nothing
was emailed". Optional: **Receive goods** now appears on the PO (batch, expiry and bin per line).

**Click:** **Activity**. Newest first: `po.sent` (simulated), `po.approved` (with the note), `plan.lines_approved`,
plus the agents' entries from step 7.

**If it fails:** if Approve selected shows an error, press it again; approval is idempotent, so a retry never creates
duplicate POs. Only the SUP-03 lines together cross ₹10 L, so keep all of them selected.

## 9. (3:45) Close

**Say:** "The engine and the ML model calculate, three agents decide within guardrails, a person approves large
orders and sends them, and nothing leaves the app."

**Click:** **Data & AI** → the ROI model. The default assumptions show about **₹11.6 L a year plus ₹25 L of one-time
cash**; drag a slider to show it is a live model, not a slide.

**After the demo:** **Data & AI → Reset to baseline**, or reseed for a completely fresh start.

---

## Questions judges are likely to ask

**1. "Is this real data? How accurate is the forecast?"**
The data is synthetic, shaped like a mid-size Indian stockist: 500 SKUs, 8 suppliers, 45,000 daily sales rows. Every
screen says so. The ML model is a ridge regression trained on that history and tested on the last 14 days, which it
never saw. On those 14 days the ML blend's error is **14.0%** against **16.9%** for the old moving average. ML is used
only where it wins for a SKU (492 of 500), and each drawer shows both errors, including where the average wins.

**2. "What can the AI agents actually do? Could they buy something by mistake?"**
They choose a forecast method per SKU (never a number), switch to a supplier offer that passes every check, and
create POs through the same approval code as the human button: idempotent and audited. They cannot send a PO,
Owner-approve one, reject a plan or change the approval limit; those tools don't exist for any AI. Sending is
simulated, so nothing leaves the app. If Gemini fails or is slow, the agents change nothing and a person approves by hand.

**3. "Why is there no purchase budget?"**
The engine orders what each SKU needs to avoid a stockout, ranked by loss prevented per rupee. The Owner controls
spend through a **per-PO approval limit of ₹10,00,000**: any supplier PO above it waits for the Owner before it can be
sent, which mirrors how stockists approve large orders. The Owner can change the limit on the Data & AI page.

---

## Known issues seen in rehearsal (22 Oct 2026)

- **Gemini latency.** "Why?" took 98 s and an agent run took 277 s; the Order Agent timed out once. The fallbacks
  worked as designed, but a demo should not wait on them.
- **Supplier Agent quantity drop.** On the surge plan it switched PHX-0355 to SUP-02's offer, which cut the line from
  880 to 15 packs. The guardrail allowed it because the offer is valid. Worth tightening before relying on it live.
