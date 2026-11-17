# Accesso e test

Mantenuto dall'orchestratore. Tutto ciò che serve a un agente (o a un umano) per avviare, autenticarsi e testare l'app.
Le sezioni "Run #N" in fondo vengono aggiunte automaticamente dagli artefatti `access` degli agenti.

## Avvio
- Prerequisiti: Node >= 24, Docker (per Postgres e Redis).
- Servizi: `docker compose up -d` avvia Postgres 17 (localhost:54320, db `sdi_channel`, utente `sdi` / `sdi_dev_only`, solo sviluppo) e Redis 7 (localhost:63790).
- `.env`: copia di `.env.example` (lo fa `npm run dev` se manca). `SDI_ENV=demo` sempre: la produzione SdI non si tocca.
- Migrazioni: `npm run db:migrate` (applica `db/migrations/*.sql` in ordine, tracciate in `schema_migrations`).
- Dev server: `npm run dev` avvia web (Next, porta 3000) e API (Fastify, porta 4000). Gli agenti NON lo avviano a mano: la preview è dell'infrastruttura.
- URL: dashboard http://localhost:3000 (oggi solo scheletro), API http://localhost:4000.

## Autenticazione
- Oggi NON esiste autenticazione: nessun utente, nessuna API key, nessun login. La dashboard e l'API sono aperte in locale.
- Le API key per tenant e il login operatore arriveranno con la roadmap (feature 6 e 7), non in questa run.
- L'endpoint di ricezione notifiche SdI (run #405) in produzione sarà protetto da mutua autenticazione TLS; in locale/test si chiama senza TLS.

## Dati di seed
- Oggi: nessuno (la migrazione 0001 è vuota).
- Con la run #405: migrazione con tabelle `tenants`, `invoices`, `invoice_status_history`, `sdi_notifications`, `audit_log` e uno script di seed idempotente con un tenant demo e una fattura demo in stato `sent`. Il builder documenterà comando e dati esatti in una sezione "Run #405".

## Endpoint utili
- `GET /health` (porta 4000): stato di database e Redis, `sdiEnv` attivo. 200 se tutto ok, 503 se degradato.
- In arrivo con la run #405: endpoint SOAP di ricezione notifiche SdI (RicevutaConsegna, NotificaScarto), percorso definito in ADR 0004.

## Test automatici
- `npm run test` (Vitest, file `*.test.ts` accanto al codice). Devono passare anche `npm run typecheck`, `npm run lint`, `npm run build`.
- I test unitari non richiedono rete né Docker. I test che toccano Postgres usano `DATABASE_URL` e vanno saltati in modo esplicito (non falliti in silenzio) se il DB non è raggiungibile.
- Nessun test chiama SdI reale: l'endpoint demo è simulato con un server HTTP locale su porta effimera avviato e chiuso dal test.
- Certificati di firma per i test: generati a runtime dal test (self-signed), mai salvati nel repo.
