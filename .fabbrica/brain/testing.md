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


## Run #405 · builder · Seed demo e curl ricezione notifiche

Migrazioni: `npm run db:migrate`. Seed: `node --env-file-if-exists=.env scripts/seed.mjs` (idempotente). Tenant IT01234567890; fattura DEMO-0001, nome_file IT01234567890_00001.xml.p7m, stato sent, sdi_identifier 9900000001. Endpoint: POST http://localhost:4000/sdi/ricezione/trasmissione-fatture (text/xml, solo SDI_ENV=demo, nessuna autenticazione). Esempio curl completo in .fabbrica/brain/testing.md, sezione Run #405. Atteso: 200 con body SOAP vuoto e fattura delivered.

### Ricezione notifiche: provare con curl (run #405)
Prerequisiti: `npm run db:migrate && npm run db:seed`, API su localhost:4000 con `SDI_ENV=demo`. Il campo File è l'XML della notifica in base64.
```
INNER='<ns3:RicevutaConsegna xmlns:ns3="http://www.fatturapa.gov.it/sdi/messaggi/v1.0"><IdentificativoSdI>9900000001</IdentificativoSdI><NomeFile>IT01234567890_00001.xml.p7m</NomeFile><DataOraRicezione>2026-02-01T10:00:00.000+01:00</DataOraRicezione><DataOraConsegna>2026-02-01T10:00:05.000+01:00</DataOraConsegna><Destinatario><Codice>ABCDEFG</Codice></Destinatario><MessageId>M1</MessageId></ns3:RicevutaConsegna>'
curl -i -X POST http://localhost:4000/sdi/ricezione/trasmissione-fatture -H 'Content-Type: text/xml' --data "<soapenv:Envelope xmlns:soapenv=\"http://schemas.xmlsoap.org/soap/envelope/\"><soapenv:Body><RicevutaConsegna><IdentificativoSdI>9900000001</IdentificativoSdI><NomeFile>IT01234567890_00001_RC_001.xml</NomeFile><File>$(printf %s "$INNER" | base64)</File></RicevutaConsegna></soapenv:Body></soapenv:Envelope>"
```
Atteso: 200 con body SOAP vuoto; DEMO-0001 passa a `delivered` (ripetendo la chiamata: ancora 200, nessun nuovo storico). Per lo scarto usare l'operazione `NotificaScarto` con `ListaErrori/Errore`. Il seed si ripristina solo su DB nuovo (la fattura demo non si riporta a `sent`).
Test Vitest con DB: `DATABASE_URL=... npx vitest run src/server`; senza Postgres i 9 test DB sono saltati con un avviso.


## Run #405 · builder · Seed demo e curl ricezione notifiche (copia 4)

Migrazioni: `npm run db:migrate`. Seed idempotente: `npm run db:seed`. Tenant IT01234567890; fattura DEMO-0001, nome_file IT01234567890_00001.xml.p7m, stato sent, sdi_identifier 9900000001. Endpoint: POST http://localhost:4000/sdi/ricezione/trasmissione-fatture (Content-Type text/xml, attivo solo con SDI_ENV=demo, nessuna autenticazione). Esempio curl completo in .fabbrica/brain/testing.md, sezione Ricezione notifiche. Atteso: 200 con body SOAP vuoto e fattura delivered. Test con DB: DATABASE_URL=... npx vitest run src/server.
