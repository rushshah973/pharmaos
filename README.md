# PharmaOS — Intelligent Procurement Agent

A web-based dashboard that gives Indian pharma stockists budget-capped, explainable purchase plans, with human-approved draft POs and a 3D warehouse view on the same data.

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
