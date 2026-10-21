# PharmaOS — Intelligent Procurement Agent

Budget-capped, explainable purchase plans for Indian pharma stockists, with human-approved draft POs and a 3D warehouse view on the same data.

- Problem: [problemstatement.md](problemstatement.md)
- Architecture: [architecture.md](architecture.md)
- Build plan: [implementationplan.md](implementationplan.md)
- Build prompts, run one by one: [prompts.md](prompts.md)

## Quick start

```bash
cp .env.example .env.local   # set DATABASE_URL (and optionally ANTHROPIC_API_KEY)
npm install
npm run db:migrate
npm run seed                 # available after stage 1
npm run dev                  # http://localhost:3000
```

`npm run check` runs typegen, typecheck, lint and unit tests.
