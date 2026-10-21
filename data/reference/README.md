# Reference datasets (patterns only)

Files here are **reference material**. They are never loaded into the database.

- The team's datasets and the public sources listed in `implementationplan.md` section 5.1 go here.
- `sources.json` registers each file: name, link, provenance label (`public_reference`, `unverified_sample`, …), licence note, and what it may inform.
- `scripts/seed/profile-reference.ts` reads the files and writes `profile.json`, which holds **aggregate statistics only** (shares, ranges, quantiles). No names, IDs or rows.
- `npm run seed` generates every database row from `profile.json` with a fixed seed and labels it `synthetic_demo`.

Data files in this folder are git-ignored; `README.md`, `sources.json` and `profile.json` are kept. Check each source's licence before use, and never use an MRP or NPPA ceiling price as a supplier purchase price.
