# Accesso e test

Mantenuto dall'orchestratore. Tutto ciò che serve a un agente (o a un umano) per avviare, autenticarsi e testare l'app.
Le sezioni "Run #N" in fondo vengono aggiunte automaticamente dagli artefatti `access` degli agenti: l'orchestratore le consolida qui sopra.

## Avvio
- Prerequisiti: Node >= 24, Docker (per Postgres e Redis).
- Servizi: `docker compose up -d` avvia Postgres 17 (localhost:54320, db `sdi_channel`, utente `sdi` / `sdi_dev_only`, solo sviluppo) e Redis 7 (localhost:63790).
- `.env`: copia di `.env.example` (lo fa `npm run dev` se manca). `SDI_ENV=demo` sempre: la produzione SdI non si tocca.
- Migrazioni: `npm run db:migrate` (applica `db/migrations/*.sql` in ordine, tracciate in `schema_migrations`). La 0002 crea lo schema SDICoop (ADR 0004).
- Dev server: `npm run dev` avvia web (Next, porta 3000) e API (Fastify, porta 4000). Gli agenti NON lo avviano a mano: la preview (http://127.0.0.1:4000, cioè l'API) è dell'infrastruttura e gira con `SDI_ENV=demo`. Non riconfigurarla.
- URL: dashboard http://localhost:3000 (solo scheletro), API http://localhost:4000.

## Autenticazione
- Non esiste autenticazione: nessun utente, nessuna API key, nessun login. Dashboard e API sono aperte in locale.
- API key per tenant e login operatore arriveranno con la roadmap, non nella run #405.
- L'endpoint di ricezione notifiche SdI in produzione sarà protetto da mutua TLS; in locale si chiama senza TLS.

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
