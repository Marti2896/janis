# SDI Channel

Canale telematico SDICoop per la fatturazione elettronica italiana: generazione, firma CAdES-BES e invio fatture al SdI, ricezione di esiti e fatture passive, multi-tenant con API key per cliente, dashboard operativa.

Stato: **scheletro**. Le feature dell'MVP (vedi `.fabbrica/brain/business-rules.md`) non sono ancora implementate.

## Avvio

Requisiti: Node ≥ 24, Docker.

```bash
npm install
npm run dev
```

Un solo comando: crea `.env` da `.env.example` se manca, accende Postgres e Redis (docker compose), applica le migrazioni, avvia API e dashboard. `Ctrl+C` ferma tutto.

| Pezzo | Porta |
| --- | --- |
| Dashboard Next.js | 3000 |
| API Fastify (`/health`) | 4000 |
| PostgreSQL | 54320 |
| Redis | 63790 |

## Comandi

- `npm test` – Vitest
- `npm run typecheck` · `npm run lint` · `npm run build`
- `npm run db:migrate` – applica `db/migrations/*.sql`

## Struttura

- `src/` – dashboard Next.js (App Router, Tailwind, shadcn/ui in `src/components/ui`)
- `server/` – backend Fastify (TypeScript eseguito direttamente da Node 24, import con estensione `.ts`)
- `db/migrations/` – migrazioni SQL numerate
- `scripts/` – `dev.mjs` (avvio completo), `migrate.mjs`
- `.fabbrica/brain/` – convenzioni, design e regole di business

## Ambienti SdI

`SDI_ENV=demo|production` sceglie quale set di endpoint (`SDI_DEMO_*` / `SDI_PROD_*`) usare. Segreti e certificati vanno nel vault, mai nel repo.
