# Accesso e test

Mantenuto dall'orchestratore. Tutto ciò che serve a un agente (o a un umano) per avviare, autenticarsi e testare l'app.
Le sezioni "Run #N" in fondo vengono aggiunte automaticamente dagli artefatti `access` degli agenti: l'orchestratore le consolida qui sopra.

## Avvio
- Prerequisiti: Node >= 24, Docker (per Postgres e Redis).
- Servizi: `docker compose up -d` avvia Postgres 17 (localhost:54320, db `sdi_channel`, utente `sdi` / `sdi_dev_only`, solo sviluppo) e Redis 7 (localhost:63790).
- `.env`: copia di `.env.example` (lo fa `npm run dev` se manca). `SDI_ENV=demo` sempre: la produzione SdI non si tocca.
- Migrazioni: `npm run db:migrate` (applica `db/migrations/*.sql` in ordine, tracciate in `schema_migrations`). La 0002 crea lo schema SDICoop (ADR 0004).
- Dev server: `npm run dev` avvia web (Next) e API (Fastify) sulle porte di `.env`: `WEB_PORT=4810`, `API_PORT=4811` (i default nel codice, 3000/4000, valgono solo senza `.env`). Gli agenti NON lo avviano a mano: la preview (http://127.0.0.1:4810, la web app) è dell'infrastruttura e gira con `SDI_ENV=demo`. Non riconfigurarla.
- URL: web http://127.0.0.1:4810, API http://127.0.0.1:4811 (`/health`). Negli esempi curl più sotto sostituisci 4000 con 4811.

## Autenticazione
### Oggi (prima della run #406)
- Non esiste autenticazione: nessun utente, nessuna API key, nessun login. Dashboard e API sono aperte in locale.
- L'endpoint di ricezione notifiche SdI in produzione sarà protetto da mutua TLS; in locale si chiama senza TLS e resta senza login anche dopo la run #406 (lo chiama SdI, non un utente).

### Dalla run #406 (in costruzione: i builder aggiornano questa sezione con un artefatto access)
- Login web: pagina `/login` (email + password, hash argon2id o bcrypt), sessione con cookie httpOnly, SameSite=Lax, Secure in produzione; logout da header.
- Ruoli: `admin` (tutti gli account, certificati, configurazione canale, creazione account) e `cliente` (solo i dati del proprio tenant).
- Utenti di test creati da `npm run db:seed` (idempotente), SOLO sviluppo:
  - `admin@interscambio.test` / `Admin-dev-2026!` (ruolo admin)
  - `cliente.alfa@interscambio.test` / `Cliente-dev-2026!` (cliente, tenant Alfa Srl, P.IVA 01234567890, quello demo esistente)
  - `cliente.beta@interscambio.test` / `Cliente-dev-2026!` (cliente, tenant Beta Spa, P.IVA 09876543210) per verificare l'isolamento: Beta non deve mai vedere fatture, notifiche o audit di Alfa.
- API REST esterna: header `X-API-Key: <chiave>`; chiavi per tenant, salvate solo come hash. Il seed stampa a console una chiave di sviluppo per Alfa e una per Beta (valori deterministici documentati dal builder). Documentazione OpenAPI su `GET /api/v1/openapi.json` (porta 4811) e pagina docs.

## Dati di seed
- Comando: `npm run db:seed` (equivale a `node --env-file-if-exists=.env scripts/seed.mjs`), idempotente: rieseguirlo non duplica.
- Tenant demo: partita IVA IT01234567890.
- Fattura demo: numero DEMO-0001, nome_file `IT01234567890_00001.xml.p7m`, stato `sent`, sdi_identifier `9900000001`.
- Il seed NON riporta la fattura demo a `sent` se è già stata consumata da una RC/NS (le tabelle sono append-only). Per ripetere i test di ricezione: crea fatture di prova con prefisso `qa-` e sdi_identifier dedicati, oppure ricrea il DB (`docker compose down -v && docker compose up -d`, poi migrate e seed).

## Endpoint utili
- `GET /health` (porta 4000): stato di database e Redis, `sdiEnv` attivo. 200 se tutto ok, 503 se degradato.
- `POST /sdi/ricezione/trasmissione-fatture` (porta 4000, Content-Type `text/xml`): ricezione notifiche SdI, operazioni `RicevutaConsegna` e `NotificaScarto` (ADR 0004). Attiva solo con `SDI_ENV` diverso da `production`; in production risponde sempre SOAP Fault senza toccare il DB.

### Ricezione notifiche: provare con curl
Prerequisiti: migrate + seed, API su localhost:4000 con `SDI_ENV=demo`. Il campo File è l'XML della notifica in base64.

Le notifiche devono essere conformi a `MessaggiTypes_v1.0.xsd` (ADR 0005): attributo `versione="1.0"` sulla radice, `Destinatario` con `Codice` e `Descrizione`, `MessageId` e `ds:Signature` XMLDSig obbligatoria. Non scrivere l'XML a mano: usa il generatore (introdotto per l'issue #16), che firma a runtime con il certificato di test e stampa la busta SOAP completa.
```
npm run --silent sdi:notifica-demo -- --tipo RC --id 9900000001 --nome-file IT01234567890_00001.xml.p7m --message-id M1 > /tmp/rc.xml
curl -i -X POST http://localhost:4000/sdi/ricezione/trasmissione-fatture -H 'Content-Type: text/xml' --data-binary @/tmp/rc.xml
npm run --silent sdi:notifica-demo -- --tipo NS --id <sdi_identifier> --nome-file <nome_file> --message-id M2 --errore 00200:"File non conforme al formato" > /tmp/ns.xml
```
Atteso: RC → 200 con body SOAP vuoto e fattura `delivered`; ripetendo: ancora 200, nessun nuovo storico. NS → 200 e fattura `rejected` con errori in `sdi_notifications`. XML malformato o non valido contro lo XSD (es. RC senza DataOraConsegna o senza ds:Signature): 500 SOAP Fault e stato invariato.
Nota: oggi si controlla solo la struttura della firma via XSD, non la sua validità crittografica (rinviata, ADR 0005). Rimuovi i file in /tmp a fine prova.

### Caso SDI_ENV=production
Non si verifica sulla preview condivisa (gira in demo e non va riconfigurata) e il QA non avvia istanze temporanee dell'API. La copertura è un test Vitest che istanzia il server Fastify reale con `sdiEnv: 'production'` e usa `app.inject` con un pool che registra le query: atteso Fault 500 e zero query. Il QA verifica questo test, non il server dal vivo.

## Test automatici
- `npm run test` (Vitest, file `*.test.ts` accanto al codice). Devono passare anche `npm run typecheck`, `npm run lint`, `npm run build`.
- Moduli: `src/sdi/fatturapa` (generazione e validazione XSD), `src/sdi/sign` (firma CAdES-BES), `src/sdi/client` (client SOAP SdIRiceviFile), `src/server` (repo fatture, ricezione notifiche).
- Test con DB: `DATABASE_URL=postgres://sdi:sdi_dev_only@localhost:54320/sdi_channel npx vitest run src/server`. Senza Postgres i test DB sono saltati con un avviso esplicito.
- Nessun test chiama SdI reale: l'endpoint demo è simulato con un server HTTP locale su porta effimera, avviato e chiuso dal test.
- Certificati di firma per i test: generati a runtime (`src/sdi/sign/test-cert.ts`), mai salvati nel repo.
- Firma da riga di comando (verifica indipendente): `openssl cms -verify -inform DER -in file.p7m -noverify -out out.xml` e `openssl asn1parse -inform DER -in file.p7m -i` per ispezionare signing-certificate-v2.

## QA della run #405
- Nessuna UI: niente browser né screenshot. Il QA usa Vitest, curl sull'API della preview e query sul DB.

## QA della run #406 (UI completa, ADR 0006)
- Prima: `npm run db:migrate && npm run db:seed` (nuove migrazioni per utenti, sessioni, API key, certificati, impostazioni canale, fatture ricevute, nuovi stati).
- Browser sulla preview http://127.0.0.1:4810: login con i tre utenti di test sopra, verificare che senza sessione ogni pagina reindirizzi a `/login`.
- Isolamento: da Beta aprire l'URL di dettaglio di una fattura di Alfa deve dare «non trovato»; stessa prova via API con la chiave di Beta.
- Notifiche MC/NE/DT e fatture passive si simulano con il generatore `sdi:notifica-demo` (esteso dai builder) e curl su porta 4811.


## Run #406 · builder · Accessi di test: auth, tenant, seed (copia 1)

## Avvio dati
- DB: `export DATABASE_URL=postgres://sdi:sdi_dev_only@localhost:54320/sdi_channel`
- `node scripts/migrate.mjs` applica anche 0006.
- `npm run db:seed` (o `node scripts/seed.ts`): idempotente; genera SECRETS_MASTER_KEY in .env se manca (solo sviluppo).

## Utenti di test (solo sviluppo)
- admin@interscambio.test / Admin-dev-2026! (ruolo admin)
- cliente.alfa@interscambio.test / Cliente-dev-2026! (tenant Alfa Srl, P.IVA 01234567890)
- cliente.beta@interscambio.test / Cliente-dev-2026! (tenant Beta Spa, P.IVA 09876543210)

## Sessione
Cookie `interscambio_session` httpOnly, SameSite=Lax, Secure in produzione, 12 ore. Blocco: 5 login falliti in 15 minuti sulla stessa email = rifiuto per 15 minuti.

## Test
`DATABASE_URL=... npx vitest run src/server/auth.test.ts src/server/isolation.test.ts`


## Run #406 · builder · Backend SDI: notifiche, fatture passive e API v1 (copia 2)

## Avvio
`npm run db:migrate` applica anche 0007_sdi_notifiche_passive.sql. API su porta 4811 (processo Fastify).

## Contratto esportato (src/server/invoice-service.ts)
listInvoices(scope,{stato?,tenantId?,limit?,offset?}), getInvoice(scope,id) (null se di un altro tenant; contiene `events`), getInvoiceFile(scope,id) -> {fileName,bytes}, createAndSendInvoice(scope,input) -> {id,queued?,warning?,replay?} oppure {errors:{campo:messaggio}}, listReceived(scope), getReceived(scope,id) (con `bytes`), listUnassigned(scope), assignReceived(scope,id,tenantId), channelCounters(scope). Scope = {role:'admin'} | {role:'cliente',tenantId}. Input fattura: cessionarioDenominazione, cessionarioPartitaIva, cessionarioCodiceFiscale?, destinazione:{tipo:'codice'|'pec',valore}, tipoDocumento TD01|TD04, data, righe[{descrizione,quantita,prezzoUnitario in euro,aliquota 22|10|4|0}], idempotencyKey?, tenantId (solo admin).

## Esempi curl (porta 4811, SDI_ENV=demo)
Generare il SOAP: `npm run --silent sdi:notifica-demo -- --tipo MC --id 123 --nome-file IT01234567890_00001.xml.p7m > /tmp/n.xml`
Tipi: RC, NS, MC, NE (--esito EC01|EC02), DT, SE.
`curl -X POST http://localhost:4811/sdi/ricezione/trasmissione-fatture -H 'Content-Type: text/xml' --data-binary @/tmp/n.xml`
Fatture passive: POST /sdi/ricezione/ricezione-fatture con operazione RiceviFatture (IdentificativoSdI, NomeFile, File base64). DT e SE sono accettate anche su questo endpoint.

## API v1
Header X-API-Key. GET /api/v1/health e /api/v1/openapi.json pubblici. `curl -H 'X-API-Key: isk_...' http://localhost:4811/api/v1/invoices`. POST /api/v1/invoices con Idempotency-Key opzionale: 201 creata, 200 replay, 409 corpo diverso, 422 validazione. Altre rotte: /invoices/{id}, /invoices/{id}/file, /received-invoices, /received-invoices/{id}, /received-invoices/{id}/file.

## Variabili
DATABASE_URL, SDI_ENV, SDI_DEMO_TRASMISSIONE_URL (vuoto = fattura in coda). Nessun segreto nuovo. Il test usa il certificato di firma generato a runtime.


## Run #406 · builder · Backend SDI: notifiche, fatture passive e API v1 (copia 2, rifatto)

## Avvio
`node scripts/migrate.mjs` applica anche 0007_sdi_notifiche_passive.sql. L'API Fastify gira su API_PORT (4811 in preview); `server/app.ts` registra ricezione SdI, RicezioneFatture e /api/v1.

## Contratto (src/server/invoice-service.ts)
listInvoices(scope,{stato?,tenantId?,limit?,offset?}) (stato = valore esatto oppure `queued` per il gruppo In coda), getInvoice(scope,id) con `events` (null se altro tenant), getInvoiceFile(scope,id), createAndSendInvoice(scope,input,{actorUserId?,source?}) -> {id,status,queued?,warning?,replay?} oppure {errors:{campo:messaggio},conflict?} (chiavi speciali `_form`, `_xsd`), listReceived(scope,{tenantId?,limit?,offset?}), getReceived(scope,id) con `bytes`, `contentType`, `history`, listUnassigned(scope) (solo admin), assignReceived(scope,id,tenantId,actorUserId?) (solo admin), channelCounters(scope) -> {queued,errors24h,notifications,recentErrors[]}. Importi in centesimi (`importoCents`). Input fattura: cessionarioDenominazione, cessionarioPartitaIva, cessionarioCodiceFiscale?, destinazione:{tipo:'codice'|'pec',valore}, tipoDocumento TD01|TD04, formato? FPR12|FPA12, data AAAA-MM-GG, righe[{descrizione,quantita,prezzoUnitario in euro,aliquota 22|10|4|0}], idempotencyKey?, tenantId (solo admin).

## Notifiche demo (curl)
`npm run --silent sdi:notifica-demo -- --tipo MC --id 123 --nome-file IT01234567890_00001.xml.p7m > /tmp/n.xml`
Tipi: RC, NS, MC, NE (--esito EC01|EC02), DT, SE (--esito EN00|EN01).
`curl -X POST http://localhost:4811/sdi/ricezione/trasmissione-fatture -H 'Content-Type: text/xml' --data-binary @/tmp/n.xml`
Fatture passive: POST /sdi/ricezione/ricezione-fatture con operazione RiceviFatture (IdentificativoSdI, NomeFile, File base64 di XML o P7M). DT e SE sono accettate anche su questo endpoint. Instradamento per P.IVA poi codice fiscale del cessionario; senza corrispondenza la fattura e non assegnata (solo admin).

## API v1
Header X-API-Key (chiave isk_... creata da /api o /admin/account). GET /api/v1/health e /api/v1/openapi.json pubblici. `curl -H 'X-API-Key: isk_...' http://localhost:4811/api/v1/invoices`. POST /api/v1/invoices con Idempotency-Key opzionale: 201 creata, 200 replay, 409 corpo diverso, 422 validazione. Altre rotte: /invoices/{id}, /invoices/{id}/file, /received-invoices, /received-invoices/{id}, /received-invoices/{id}/file. 401 chiave mancante/errata/revocata; 404 risorsa di altro tenant.

## Variabili
DATABASE_URL, SDI_ENV, SDI_DEMO_TRASMISSIONE_URL (vuoto = fattura in coda con avviso), SDI_RETRY_*. Nessun segreto nuovo; senza certificato attivo in demo si usa il certificato di test generato a runtime.

## Test
`DATABASE_URL=... npx vitest run src/server/notifications.test.ts src/server/notifications-types.test.ts src/server/passive.test.ts src/server/api-v1.test.ts`
