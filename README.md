# PharmaOS — Intelligent Procurement Agent

A web-based dashboard that gives Indian pharma stockists ranked, explainable purchase plans — with an ML demand model used where its backtest beats the average, and three guarded agents (Demand, Supplier, Order) that decide and create POs — plus Owner approval above ₹4,00,000 per PO, simulated sending, and a 3D warehouse view on the same data.

- Problem: [problemstatement.md](problemstatement.md)
- Architecture: [architecture.md](architecture.md)
- Build plan: [implementationplan.md](implementationplan.md)
- Build prompts, run one by one: [prompts.md](prompts.md) · what each one does: [prompts-explained.md](prompts-explained.md)

## Quick start

```bash
cp .env.example .env.local   # set DATABASE_URL (and optionally GEMINI_API_KEY)
npm install
npm run db:migrate
npm run seed                 # available after stage 1
npm run dev                  # http://localhost:3000
```

`npm run check` runs typegen, typecheck, lint and unit tests.
