# Accesso e test

Mantenuto dall'orchestratore. Tutto ciò che serve a un agente (o a un umano) per avviare, autenticarsi e testare Interscambio.
Le sezioni "Run #N" in fondo vengono aggiunte automaticamente dagli artefatti `access` degli agenti: l'orchestratore le consolida qui sopra.

## Avvio
- Prerequisiti: Node >= 24, Docker (Postgres e Redis).
- Servizi: `docker compose up -d` avvia Postgres 17 (localhost:54320, db `sdi_channel`, utente `sdi` / `sdi_dev_only`, solo sviluppo) e Redis 7 (localhost:63790).
- `.env`: copia di `.env.example` (lo fa `npm run dev` se manca). `SDI_ENV=demo` sempre: la produzione SdI non si tocca.
- Variabili: `DATABASE_URL=postgres://sdi:sdi_dev_only@localhost:54320/sdi_channel`, `SDI_ENV`, `SDI_DEMO_TRASMISSIONE_URL` (vuoto = la nuova fattura resta in coda con un avviso, non è un errore), `SDI_RETRY_*`, `SECRETS_MASTER_KEY` (chiave AES-256-GCM per i certificati; in sviluppo la genera il seed in `.env` se manca, mai nel repo).
- Migrazioni: `npm run db:migrate` applica in ordine `db/migrations/*.sql` (0001, 0002 schema SDICoop, 0006 utenti/sessioni/API key/certificati/canale, 0007 stati estesi, notifiche MC/NE/DT/SE, fatture passive, contatori numerazione, idempotenza API). Tracciate in `schema_migrations`.
- Seed: `npm run db:seed` (idempotente, vedi sotto).
- Attenzione `.env`: `scripts/dev.mjs` legge `.env` una sola volta all'avvio e passa quell'ambiente ai figli. Una variabile aggiunta dopo (es. `SECRETS_MASTER_KEY` scritta dal seed) NON arriva all'API finché la preview non viene riavviata, anche se `--watch` riavvia il processo Fastify. Sintomo: POST fatture risponde 500 «SECRETS_MASTER_KEY non configurata». Run #406: preview partita alle 09:14, chiave scritta alle 09:44. Correzione in corso (issue #85): `server/index.ts` carica `.env` da sé all'avvio.
- Dev server: `npm run dev` avvia web (Next 16) e API (Fastify) con `WEB_PORT=4810` e `API_PORT=4811`. Gli agenti NON lo avviano a mano: la preview è dell'infrastruttura e gira con `SDI_ENV=demo`. Se serve un riavvio (es. dopo una migrazione o una nuova dipendenza), scriverlo nel summary.
- URL: web http://127.0.0.1:4810, API http://127.0.0.1:4811 (`/health`, `/api/v1/health`).
- Controllo rapido: `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:4810/login` = 200; `/fatture` senza cookie = 307 verso /login; `curl http://127.0.0.1:4811/health` = 200.

## Autenticazione
- Login web: `/login` (email + password, hash argon2id). Nessuna registrazione pubblica: gli account li crea l'admin da `/admin/account`.
- Sessione: cookie `interscambio_session` httpOnly, SameSite=Lax, Secure in produzione, 12 ore; in DB solo l'hash SHA-256 del token. Logout dal menu utente («Esci»).
- Blocco tentativi: 5 login falliti in 15 minuti sulla stessa email/IP = rifiuto per 15 minuti anche con la password giusta («Troppi tentativi. Riprova tra 15 minuti.»). Se il QA si blocca da solo, usa un altro utente o aspetta 15 minuti.
- Reset password: solo dall'admin, password temporanea mostrata una volta.
- Ruoli: `admin` (tutti gli account, certificati, canale, assegnazione fatture passive) e `cliente` (solo il proprio tenant; le pagine admin danno «Accesso negato»).

### Utenti di test (SOLO sviluppo, creati da `npm run db:seed`)
| Email | Password | Ruolo | Tenant |
|---|---|---|---|
| admin@interscambio.test | Admin-dev-2026! | admin | nessuno (vede tutti) |
| cliente.alfa@interscambio.test | Cliente-dev-2026! | cliente | Alfa Srl, P.IVA 01234567890 |
| cliente.beta@interscambio.test | Cliente-dev-2026! | cliente | Beta Spa, P.IVA 09876543210 |

### API key (sistemi esterni)
- Il seed NON crea API key. Si creano dalla pagina web `/api` (cliente, per il proprio tenant) o da `/admin/account` (admin). Formato `isk_<prefisso>_<segreto>`, mostrata una sola volta, salvata solo come hash.
- Uso: header `X-API-Key: isk_...` sulla porta 4811. Chiave mancante, errata o revocata = 401; risorsa di un altro tenant = 404.
- L'endpoint di ricezione SdI non ha login (lo chiama SdI; in produzione sarà protetto da mutua TLS).

## Dati di seed
- Tenant Alfa Srl (01234567890) e Beta Spa (09876543210), ciascuno con 4 fatture emesse di seed (`scripts/seed.ts`).
- Fatture di seed utilizzabili per le notifiche SdI (nell'anteprima l'endpoint demo è vuoto, quindi le fatture create dal form o via API restano in coda SENZA IdentificativoSdI e non ricevono notifiche: per MC, NE, DT e fuori sequenza usa queste):

| Tenant | Numero | nome_file | IdentificativoSdI | Stato | Notifiche provabili |
|---|---|---|---|---|---|
| Alfa | 1/2026 | IT01234567890_alfa1.xml.p7m | 990000001 | consegnata | NE (EC01/EC02), DT; MC = fuori sequenza |
| Alfa | 2/2026 | IT01234567890_alfa2.xml.p7m | 990000002 | inviata | MC, RC, NS; NE/DT = fuori sequenza |
| Alfa | 3/2026 | IT01234567890_alfa3.xml.p7m | 990000003 | scartata | qualsiasi = fuori sequenza |
| Beta | 1/2026, 2/2026, 3/2026 | IT09876543210_beta1..3.xml.p7m | 991000001..3 | come Alfa | come Alfa |

  Stato verificato al triage it.12 (run #406): tutte e sei intatte, zero notifiche ricevute. Sono fixture DEDICATE alle prove di notifica, non dati di un'altra corsia: il QA della corsia notifiche le usa senza chiedere (issue #89). Ordine consigliato per non bruciarle: su Alfa 2/2026 (inviata) prima un NE o DT (fuori sequenza, nessuna regressione), poi MC; su Alfa 1/2026 (consegnata) prima un MC (fuori sequenza), poi NE EC01; su Beta 1/2026 il DT; Beta 2/2026 resta di riserva. Quando sarà disponibile lo script `npm run qa:fattura-inviata` (work package aperto in it.12) usare quello, che crea ogni volta una fattura nuova.
  Sono dati di test condivisi: il QA può inviarci notifiche (servono a questo). Ogni notifica che cambia stato è definitiva (append-only): annota nel report quali hai consumato. Il seed è idempotente su nome_file, quindi rilanciarlo non le ripristina.
- Sede dei tenant (migrazione 0008, seed solo se vuota): Alfa Srl = Via Roma 1, 20121 Milano (MI); Beta Spa = Via Torino 20, 10121 Torino (TO). Un tenant senza indirizzo, CAP e comune non può emettere fatture (messaggio nel form, 422 in API con campo `_form`). I nuovi account da /admin/account richiedono indirizzo, CAP (5 cifre), comune; provincia opzionale.
- Fattura demo storica: DEMO-0001, nome_file `IT01234567890_00001.xml.p7m`, sdi_identifier `9900000001`.
- Certificati: l'upload richiede `SECRETS_MASTER_KEY` in `.env` (la scrive `npm run db:seed` se manca). Dopo averla aggiunta la preview va riavviata dall'infrastruttura.
- Il seed non riporta indietro gli stati (tabelle append-only). Per ripetere test di notifiche crea fatture nuove (dal form o via API) oppure ricrea il DB: `docker compose down -v && docker compose up -d`, poi migrate e seed.
- Dati lasciati dal QA run #406: ricevuta 7300003001 (QA3-PASS-001, tenant Alfa) e 7300003002 (QA3-NOMATCH-002, non assegnata); fatture con cessionario «qa2-...» su Alfa; account «qa4-Azienda Prova» (P.IVA 55566677781) e certificato demo «qa4-upload-c4». Tutto con prefisso qa: ignorabile.

## Pagine web (porta 4810)
`/login`, `/fatture` (filtro stato, per admin anche account), `/fatture/[id]` (timeline, download XML firmato), `/fatture/nuova`, `/ricevute` e `/ricevute/[id]` (download originale; admin: «Non assegnate» con «Assegna»), `/stato`, `/audit` (filtri date, per admin account), `/api` (chiavi), `/api/docs`. Solo admin: `/certificati`, `/admin/account`, `/admin/canale`.

## Endpoint API (porta 4811)
- `GET /health`: database, Redis e `sdiEnv`. 200 ok, 503 degradato.
- `POST /sdi/ricezione/trasmissione-fatture` (text/xml): notifiche RC, NS, MC, NE, DT, SE. In `SDI_ENV=production` risponde sempre SOAP Fault senza toccare il DB.
- `POST /sdi/ricezione/ricezione-fatture` (text/xml): operazione RiceviFatture (IdentificativoSdI, NomeFile, File base64 di XML o P7M); accetta anche DT e SE. Instradamento per P.IVA poi codice fiscale del cessionario; senza corrispondenza la fattura è non assegnata (solo admin). IdentificativoSdI duplicato non crea doppioni; dopo il fix di #88 la seconda ricezione deve rispondere con un SOAP Fault (motivo duplicato), non 200 vuoto.
- `/api/v1` (X-API-Key): `GET /health` e `GET /openapi.json` pubblici; `GET /invoices?stato=&cursor=`, `GET /invoices/{id}`, `GET /invoices/{id}/file`, `POST /invoices` (Idempotency-Key opzionale: 201 creata, 200 replay, 409 stessa chiave con corpo diverso, 422 validazione), `GET /received-invoices`, `GET /received-invoices/{id}`, `GET /received-invoices/{id}/file`.

### Simulare notifiche SdI con curl
Le notifiche devono essere conformi a `MessaggiTypes_v1.0.xsd` con `ds:Signature` (ADR 0005): non scriverle a mano, usa il generatore (firma con certificato di test a runtime).
```
npm run --silent sdi:notifica-demo -- --tipo RC --id <sdi_identifier> --nome-file <nome_file> --message-id M1 > /tmp/n.xml
curl -i -X POST http://127.0.0.1:4811/sdi/ricezione/trasmissione-fatture -H 'Content-Type: text/xml' --data-binary @/tmp/n.xml
```
Tipi: `RC`, `NS` (`--errore 00200:"File non conforme"`), `MC`, `NE` (`--esito EC01|EC02`), `DT`, `SE` (`--esito EN00|EN01`).
Atteso: 200 e stato aggiornato; ripetendo la stessa notifica nessun nuovo storico. Transizioni: MC solo dopo inviata, NE e DT solo dopo consegnata; fuori sequenza = registrata in timeline senza regressione di stato. SE si registra sulla fattura ricevuta. XML non valido = 500 SOAP Fault, stato invariato. Rimuovi i file in /tmp a fine prova.

### Caso SDI_ENV=production
Non si prova sulla preview (gira in demo, non va riconfigurata). Coperto da test Vitest con `app.inject` e `sdiEnv: 'production'`: atteso Fault 500 e zero query.

## Test automatici
- `npm run test` (Vitest, `*.test.ts` accanto al codice). Devono passare anche `npm run typecheck`, `npm run lint`, `npm run build`.
- Test con DB: `DATABASE_URL=postgres://sdi:sdi_dev_only@localhost:54320/sdi_channel npx vitest run src/server`. Senza Postgres i test DB sono saltati con avviso.
- File chiave: `src/server/auth.test.ts` (login, sessioni, blocco), `src/server/isolation.test.ts` (isolamento a due tenant), `notifications.test.ts`, `notifications-types.test.ts`, `passive.test.ts`, `api-v1.test.ts`.
- Nessun test chiama SdI reale: l'endpoint demo è simulato su porta effimera. Certificati di test generati a runtime (`src/sdi/sign/test-cert.ts`), mai nel repo.
- Verifica firma: `openssl cms -verify -inform DER -in file.p7m -noverify -out out.xml`; `openssl asn1parse -inform DER -in file.p7m -i`.

## QA (UI, run #406 e successive)
- Prima: `npm run db:migrate && npm run db:seed`, poi controllo rapido delle porte (sezione Avvio).
- Browser sulla preview: login con i tre utenti; senza sessione ogni pagina reindirizza a `/login`.
- Isolamento: da Beta aprire l'URL di una fattura o ricevuta di Alfa deve dare «non trovato»; stessa prova via API con una chiave di Beta creata da `/api`.
- Notifiche e fatture passive: generatore `sdi:notifica-demo` e curl su 4811 (sezione sopra).
- Audit del canale (/admin/canale): l'anteprima è condivisa, ma il QA PUÒ salvare. Procedura: annotare ambiente ed endpoint attuali, salvare l'endpoint con il valore di prova `http://127.0.0.1:9/qa-audit` (porta chiusa, nessuna chiamata reale), verificare in /audit la voce del canale con valori prima e dopo, poi RIPRISTINARE subito il valore originale (vuoto in anteprima) e salvare di nuovo. Non passare mai a Produzione e non lasciare l'endpoint di prova: con endpoint vuoto le nuove fatture restano in coda, ed è il comportamento che le altre corsie si aspettano.
- Fattura accodata (endpoint demo vuoto): la fattura viene firmata (status DB `signed`) e appartiene al gruppo «In coda» (draft, signed, sending; send_unknown ha la sua etichetta «Esito incerto»). Atteso dopo il fix di #63: badge «In coda» in lista e dettaglio anche dopo il ricaricamento senza `?coda=1`, filtro «In coda» (`?stato=queued`) che la restituisce, banner «L'endpoint SdI non è configurato: la fattura resta in coda.» nel dettaglio dopo il redirect.
- /stato per il cliente: ambiente, contatori e «Ultimi errori» del SOLO proprio tenant (decisione triage it.9, #67). Endpoint ed esito /health solo admin.
- Password minima: il form /cambia-password mostra sotto il campo «La password deve avere almeno 12 caratteri.» senza inviare nulla al server.
- Loop di ricaricamento di /login (issue #58, risolto in it.7): causa era Tailwind che scansionava la radice del progetto più l'inoltro dei log del browser. Correzione in `globals.css` (`source("../")`) e `next.config.ts` (`logging.browserToTerminal: false`). Prima del QA: aprire /login e aspettare 10 secondi; se compaiono Fast Refresh ripetuti senza modifiche, aprire UNA sola issue question. L'avviso di idratazione su `<body inject_vt_svd>` è un'estensione del browser.
- Il typecheck può segnalare errori in `.next/types/validator.ts` (file generato dalla preview): non sono errori dei sorgenti.
- Preview su 127.0.0.1 e idratazione: Next 16 in dev blocca con 403 gli asset `/_next/*` richiesti da origini diverse da `localhost` (`allowedDevOrigins`). Senza `allowedDevOrigins: ['127.0.0.1']` in `next.config.ts` la pagina arriva dal server ma React non si idrata (menu, Dialog, Select e form non rispondono, i form fanno GET). Controllo rapido: `curl -s -o /dev/null -w "%{http_code}" -H "Sec-Fetch-Site: same-origin" -H "Sec-Fetch-Mode: no-cors" http://127.0.0.1:4810/_next/static/chunks/<un chunk .js preso dall'HTML>` deve dare 200, non 403. Dopo una modifica a `next.config.ts` la preview va riavviata dall'infrastruttura.

- Database del QA: `docker compose exec -T postgres psql -U sdi -d sdi_channel` (psql non è installato sull'host).


## Run #406 · builder · Script fattura di prova, migrazioni 0009 e 0010

## Avvio dati
- `export DATABASE_URL=postgres://sdi:sdi_dev_only@localhost:54320/sdi_channel`
- `node scripts/migrate.mjs` applica 0009_received_summary.sql (riepilogo fatture ricevute) e 0010_fattura_sostituita.sql (stato Sostituita e numero riusabile).

## Script di sviluppo
`npm run qa:fattura-inviata -- --tenant alfa|beta --stato sent|delivered`
Crea una fattura nuova per il tenant con numero dal contatore reale, file firmato con il certificato di test, storico coerente (draft, signed, sent e per delivered anche una notifica RC) e audit. Stampa su stdout JSON con id, numero, nome_file, sdi_identifier, stato. Rifiuta di girare se SDI_ENV=production.

## Prova di «Correggi e crea di nuovo»
1. Crea una fattura inviata con lo script (--stato sent).
2. Genera una notifica NS: `npm run --silent sdi:notifica-demo -- --tipo NS --id <sdi_identifier> --nome-file <nome_file> > /tmp/ns.xml` e inviala con `curl -X POST http://localhost:4811/sdi/ricezione/trasmissione-fatture -H 'Content-Type: text/xml' --data-binary @/tmp/ns.xml`.
3. Entra come cliente.alfa@interscambio.test (Cliente-dev-2026!), apri la fattura Scartata e premi «Correggi e crea di nuovo».

## Test
`DATABASE_URL=... npx vitest run src/server/qa-invoice.test.ts src/server/passive.test.ts`

Nessuna nuova variabile d'ambiente.
