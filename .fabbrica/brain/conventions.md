# Convenzioni

- Stack: TypeScript, Node ≥ 24, Fastify (backend), Next.js 16 App Router + Tailwind 4 + shadcn/ui (dashboard), PostgreSQL, Redis (+ BullMQ per la coda), Vitest.
- Next.js 16 ha breaking change: leggi `node_modules/next/dist/docs/` prima di scrivere codice Next. `cacheComponents` è attivo.
- Struttura cartelle: `src/` dashboard, `server/` backend, `db/migrations/NNNN_nome.sql`, `scripts/` tooling, `docs/` documentazione accreditamento.
- Backend: Node esegue i `.ts` direttamente (type stripping): import relativi con estensione `.ts`, niente enum/namespace/path alias (`erasableSyntaxOnly`).
- Naming: file in kebab-case, tipi PascalCase, tabelle SQL snake_case al plurale; testi UI e messaggi in italiano, identificatori in inglese salvo termini SdI (RC, NS, MC, NE, DT, SE, FPR12…).
- Config: tutto da variabili d'ambiente via `server/config.ts`; demo e produzione SdI separati (`SDI_DEMO_*`, `SDI_PROD_*`). Aggiungi ogni nuova variabile a `.env.example`.
- Test: Vitest, `*.test.ts` accanto al codice. `npm run typecheck`, `lint`, `test` e `build` devono passare.
- Porte fisse: web 3000, API 4000, Postgres 54320, Redis 63790.
- Cose da NON fare: segreti, chiavi private o certificati nel repo; modificare/cancellare righe del log di audit; mischiare dati tra tenant (ogni query è filtrata per tenant); usare il vecchio `next dev` direttamente (usa `npm run dev`); aggiungere dipendenze senza motivo.
