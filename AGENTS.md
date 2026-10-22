<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## PharmaOS project rules

- Read `problemstatement.md`, `architecture.md` and `implementationplan.md` before writing code; respect the layer and dependency rules in `architecture.md` §3. Build one stage at a time (section 15 of the plan) and do not add features, tables or endpoints that are not in the plan.
- All quantity, price, total and score maths lives in `lib/business-logic/` as pure, unit-tested functions; the demand model's maths lives in `lib/ml/` (pure, unit-tested). Money goes through `lib/money.ts` (decimal.js), never JS floats. Quantities are integer packs.
- Only `lib/services/approval.ts` creates purchase orders (one transaction, idempotent). The only AI allowed to call it is the pipeline's Order Agent (create only, audited as actor 'agent'). After an agent run, the pipeline sends that run's POs within the Owner approval limit automatically (simulated, audited as order-agent; owner's decision, 22 Oct); an agent-created PO the Owner approves is sent on approval. No AI can Owner-approve a PO, reject a plan or change the approval limit, and nothing ever leaves the app: sending is simulated.
- Every mutation writes an `audit_logs` row. Every page that reads the database wraps its data component in `<Suspense>` and calls `await connection()` first (Cache Components is on).
- shadcn components here use Base UI (style `base-nova`): compose with the `render` prop, not `asChild`. Read the file in `components/ui/` before using a component.
- Reference datasets in `data/reference/` are for learning patterns only (section 5 of the plan). Never copy their rows, names or prices into the database; every row is `data_source = 'synthetic_demo'`. Generate data only in stage 1, phase by phase.
- Run `npm run check` before every commit.
