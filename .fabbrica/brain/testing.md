# Accesso e test

Mantenuto dall'orchestratore. Tutto ciò che serve a un agente (o a un umano) per avviare, autenticarsi e testare Janis (nome prodotto dalla run #422, prima «Interscambio»; il repository resta `sdi-channel`).
Le sezioni "Run #N" in fondo vengono aggiunte automaticamente dagli artefatti `access` degli agenti: l'orchestratore le consolida qui sopra.

## Avvio
- Prerequisiti: Node >= 24, Docker (Postgres e Redis).
- Servizi: `docker compose up -d` avvia Postgres 17 (localhost:54320, db `sdi_channel`, utente `sdi` / `sdi_dev_only`, solo sviluppo) e Redis 7 (localhost:63790).
- `.env`: copia di `.env.example` (lo fa `npm run dev` se manca). `SDI_ENV=demo` sempre: la produzione SdI non si tocca.
- Variabili: `DATABASE_URL=postgres://sdi:sdi_dev_only@localhost:54320/sdi_channel`, `SDI_ENV`, `SDI_DEMO_TRASMISSIONE_URL` (vuoto = la nuova fattura resta in coda con un avviso, non è un errore), `SDI_RETRY_*`, `SECRETS_MASTER_KEY` (chiave AES-256-GCM per i certificati; in sviluppo la genera il seed in `.env` se manca, mai nel repo).
- Migrazioni: `npm run db:migrate` applica in ordine `db/migrations/*.sql` (0001, 0002 schema SDICoop, 0006 utenti/sessioni/API key/certificati/canale, 0007 stati estesi, notifiche MC/NE/DT/SE, fatture passive, contatori numerazione, idempotenza API). Tracciate in `schema_migrations`.
- Seed: `npm run db:seed` (idempotente, vedi sotto).
- Attenzione `.env`: `scripts/dev.mjs` legge `.env` una sola volta all'avvio e passa quell'ambiente ai figli. Una variabile aggiunta dopo (es. `SECRETS_MASTER_KEY` scritta dal seed) NON arriva all'API finché la preview non viene riavviata, anche se `--watch` riavvia il processo Fastify. Sintomo: POST fatture risponde 500 «SECRETS_MASTER_KEY non configurata». Nella run #406 è successo due volte (preview riavviata alle 12:35 ancora senza la chiave, issue #115). Correzione assegnata al builder (triage it.15, #115): `server/index.ts` deve caricare `.env` da sé e riempire anche le variabili vuote. Finché non è fatta: se una POST fattura risponde 500 «SECRETS_MASTER_KEY non configurata», il QA NON riavvia la preview e apre UNA sola issue question per l'orchestratore.
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

  Stato verificato al triage it.12 (run #406): tutte e sei intatte, zero notifiche ricevute. Sono fixture DEDICATE alle prove di notifica, non dati di un'altra corsia: il QA della corsia notifiche le usa senza chiedere (issue #89). Ordine consigliato per non bruciarle: su Alfa 2/2026 (inviata) prima un NE o DT (fuori sequenza, nessuna regressione), poi MC; su Alfa 1/2026 (consegnata) prima un MC (fuori sequenza), poi NE EC01; su Beta 1/2026 il DT; Beta 2/2026 resta di riserva. Preferire comunque lo script `npm run qa:fattura-inviata` (sezione QA), che crea ogni volta una fattura nuova e non consuma queste fixture.
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
Atteso: 200 e stato aggiornato; ripetendo la stessa notifica nessun nuovo storico. Transizioni: MC solo dopo inviata, NE e DT solo dopo consegnata; fuori sequenza = registrata in timeline come «ignorata» (mai con l'etichetta dell'esito applicato) senza regressione di stato. Dopo il fix di #114: una NE o DT arrivata su una fattura inviata ma non ancora consegnata resta in attesa e viene applicata quando arriva la RC (storico: consegnata, poi accettata/rifiutata/termini scaduti); ogni cambio di stato da NE e DT compare nello storico; una seconda NE dopo un esito definitivo compare in timeline come ignorata. SE si registra sulla fattura ricevuta. XML non valido = 500 SOAP Fault, stato invariato. Rimuovi i file in /tmp a fine prova.

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
- Per provare come un altro utente usare «Esci» dal menu utente (o una finestra separata), non cancellare i cookie a mano: si perdono le sessioni salvate delle altre corsie.
- MAI inserire o modificare fatture, storico o notifiche direttamente nel DB con SQL: si saltano le regole di sequenza e audit e si producono falsi bug (issue #103, cancellata: QA3/9001 e QA3/9003 erano righe scritte a mano). Per avere fatture in un certo stato usa lo script qui sotto e il generatore di notifiche.

### Fattura Inviata o Consegnata di prova (script, autorizzato per tutte le corsie)
Migrazioni richieste: 0009_received_summary.sql (riepilogo ricevute) e 0010_fattura_sostituita.sql (stato Sostituita), applicate da `npm run db:migrate`.
```
npm run --silent qa:fattura-inviata -- --tenant alfa|beta --stato sent|delivered [--cessionario "qa2-Nome Srl"]
```
Crea una fattura NUOVA con numero dal contatore reale, file firmato col certificato di test, storico coerente (draft, signed, sent; con delivered anche la notifica RC) e audit. Stampa JSON con id, numero, nome_file, sdi_identifier, stato. Rifiuta di girare con SDI_ENV=production. Autorizzato al QA (decisione triage it.13, issue #99): sono dati di sviluppo. Usare sempre `--cessionario` con il prefisso della corsia e annotare nel report numero e id delle fatture create. Limite noto (issue #105, in correzione): lo script genera un `sdi_identifier` di 17 cifre, mentre lo schema delle notifiche accetta al massimo 12 cifre (la notifica dà 500 «totalDigits»). Finché #105 non è risolta non correggere a mano l'identificativo nel DB: segnalare il criterio come bloccato da #105.

Percorsi di prova:
- MC: `--stato sent`, poi notifica MC (atteso Mancata consegna).
- NE EC01/EC02 e DT: `--stato delivered`, poi NE o DT.
- Fuori sequenza: `--stato sent` e invia NE o DT (registrata in timeline, stato resta Inviata); oppure `--stato delivered` e invia MC.
- «Correggi e crea di nuovo»: `--stato sent`, notifica NS, poi come cliente.alfa apri la fattura Scartata e premi il pulsante.
Notifiche: `npm run --silent sdi:notifica-demo -- --tipo <T> --id <sdi_identifier> --nome-file <nome_file> > /tmp/n.xml` e curl verso `/sdi/ricezione/trasmissione-fatture` (sezione Endpoint API).

### Stati non riproducibili dalla preview
- Stato vuoto generico: crea da /admin/account un tenant `qa2-Vuoto Srl` con primo utente; quel cliente non ha fatture.
- Skeleton e Alert «Riprova»: con dati locali il caricamento è troppo veloce e un mock di rete non basta (sono server component). Si verificano leggendo `loading.tsx` ed `error.tsx` della pagina: se esistono e usano Skeleton e Alert con Riprova, il criterio passa per ispezione del codice (annotarlo nel report).

Test dello script: `DATABASE_URL=... npx vitest run src/server/qa-invoice.test.ts src/server/passive.test.ts`.

### Fatture passive di prova
POST `http://127.0.0.1:4811/sdi/ricezione/ricezione-fatture` con busta RiceviFatture costruita da `buildDemoReceivedInvoiceSoap` (`src/sdi/messaggi/demo-notification.ts`) e XML da `buildFatturaXml` (`src/sdi/fatturapa/build.ts`). Cessionario con P.IVA di un tenant = assegnata a quel tenant; solo codice fiscale = assegnata tramite CF; nessuna corrispondenza = non assegnata (solo admin). Notifica SE: `sdi:notifica-demo --tipo SE --id <IdentificativoSdI> --nome-file <nome> --esito EN00|EN01`, poi POST su `/sdi/ricezione/trasmissione-fatture`.

### Criteri verificati per ispezione o test (decisioni triage it.15)
- Errore XSD di Nuova fattura (#108): la validazione dei campi blocca prima tutti gli input che l'utente può scrivere, quindi un errore XSD reale non si provoca dalla UI. Il criterio si verifica con il test Vitest che il builder aggiunge (errore `_xsd` con percorso del campo restituito dal servizio e mostrato nell'Alert del form) e leggendo il componente del form. Non forzare XSD o DB per provocarlo.
- Flusso Nuova fattura: «Crea e invia» prima valida i campi sul server (validateInvoiceAction), poi apre il Dialog «Controlla prima di inviare»; la fattura si crea solo premendo la conferma nel Dialog (createInvoiceAction, «Invio in corso…»). Nel report di un fallimento indicare se il Dialog è comparso.
- Filtro «Firmata» (#113, #119 e #125, cancellate): una fattura firmata e non ancora inviata è mostrata come «In coda» (decisione #63, gruppo draft/signed/sending). Il filtro Stato quindi NON ha la voce Firmata: è voluto, non è un bug.
- Audit del canale con valori prima e dopo (#112): usare la procedura descritta sopra (endpoint di prova `http://127.0.0.1:9/qa-audit`, poi ripristino immediato del valore vuoto). È autorizzata e non disturba le altre corsie se il ripristino avviene subito.

### Account creati dal QA nella run #406 (solo sviluppo)
| Email | Password attuale | Tenant | Note |
|---|---|---|---|
| qa1-c1.attivo@interscambio.test | Qa1-attivo-nota-2026 | qa1-c1 Tenant Attivo (55500000011) | password già cambiata; 5 errori lo bloccano 15 minuti |
| qa1-c1.disattivato@interscambio.test | - | qa1-c1 Tenant Disattivato (55500000022) | disattivato, serve per il messaggio generico |
| qa1-c1.nuovo@interscambio.test | Qa1-nuovo-nota-2026 | qa1-c1 Tenant Nuovo (55500000033) | password già cambiata dalla temporanea |
| qa4.cliente@interscambio.test | Cliente-qa4-2026!x | qa4 Cliente Test (55555555555, CF QA4CFTEST0000001) | fatture ricevute di prova |
| qa4.vuoto@interscambio.test | Vuoto-qa4-2026!x | qa4 Cliente Vuoto (44444444444) | nessuna fattura ricevuta (stato vuoto) |
| qa2-c2.vuoto@interscambio.test | Qa2-cliente-nota-2026! | qa2-c2 Tenant Vuoto (66600000011) | nessuna fattura emessa (stato vuoto) |
| qa5.primo@interscambio.test | temporanea ccZrypRXcXD7UaQp (da cambiare al primo accesso) | qa5 Azienda Prova (55566677799) | usato per reset password e disattivazione |

Chiavi API lasciate dalla corsia 6: qa6-alfa-copia e qa6-alfa-file (attive, Alfa), qa6-alfa-nuova e qa6-beta-api (revocate). Per un nuovo utente: /admin/account, «Nuovo account» (password temporanea mostrata una volta; chiudere il dialog con Escape o ricaricando).
- Nota: il selettore Account di /audit e /fatture elenca anche molti tenant creati dai test automatici (Lock, Passive, T, Test...). Pulizia in corso (#117); intanto ignorarli.
- Lo script `qa:fattura-inviata` accetta anche `--cessionario "<nome>"` per dare un nome riconoscibile al cliente della fattura di prova.
- Pagina 403 in sviluppo (#111): l'avviso di console «negative time stamp» del Performance measure è un difetto noto del dev server di Next, non dell'app; conta solo l'errore «script tag».

## Restyling (run #421): cosa cambia per il test
Solo aspetto e navigazione: nessuna rotta, dato, utente o variabile d'ambiente nuova. Seed e utenti di test sono quelli sopra (admin@interscambio.test e cliente.alfa@interscambio.test bastano). Riferimento di stile: design.md (palette, layout, sidebar) e ADR 0007.
- Navigazione: non c'è più la fila di link nell'header. Da 768px in su sidebar fissa a sinistra con i gruppi Fatture, Canale, Audit e, solo per admin e dopo un separatore, Amministrazione. Sotto 768px barra in alto con il pulsante «Apri il menu» (Sheet da sinistra con gli stessi gruppi). Menu utente con email, ruolo ed «Esci» in fondo alla sidebar (o nella barra su mobile).
- Etichette nuove: «API e chiavi» (era «API»), «Account clienti» (era «Account»), «Configurazione SdI» (era «Canale» admin). Le altre voci restano uguali.
- Controlli per ruolo: cliente.alfa NON vede il gruppo Amministrazione; admin lo vede con Account clienti, Configurazione SdI, Certificati. Aprire a mano `/admin/account` da cliente dà ancora «Accesso negato».
- Larghezza (AC-13 riscritto dall'umano): il contenuto arriva al tetto di 1280px (`max-w-7xl`) da finestre di circa 1536px in su; a 1440px, con la sidebar da 16rem, occupa tutto lo spazio disponibile (circa 1184px meno il padding). Nessuno scroll orizzontale della pagina a 375px (la tabella scorre dentro il suo contenitore).
- Tabelle: prima colonna «#» numerata 1, 2, 3... in fatture emesse, ricevute, cronologia, account, certificati, chiavi API, righe del dettaglio ricevuta e righe del form Nuova fattura. In /fatture e /audit la pagina 2 riparte dal numero successivo all'ultimo della pagina 1 (es. 26 se la pagina ha 25 righe).
- Colori: bottoni primari e voce attiva della sidebar nel colore primario (verde petrolio #0B8277 dalla run #422, vedi sezione sotto); badge di stato arrotondati con fondo tenue (verde Consegnata/Accettata, blu Inviata, grigio In coda/Sostituita, rosso Scartata/Rifiutata/Errore invio, ambra Mancata consegna/Termini scaduti/Esito incerto). Il tema scuro deve restare leggibile.
- Contrasto dei badge: misurare dal DOM i colori computati, comporre la trasparenza del fondo sullo sfondo della Card e applicare la formula WCAG; soglia 4.5:1 in chiaro e in scuro (tema forzato con emulazione prefers-color-scheme). Token di riferimento in design.md, Palette.
- Decisioni di triage (run #421): lo stato vuoto delle tabelle resta un paragrafo al posto della tabella (AC-12 soddisfatto così, nessuna riga colSpan). Certificati: ambra entro 30 giorni, rosso entro 7 giorni o scaduto; scaduto e revocato non sono nel seed e si segnano come non verificabili. Consegnata e Scartata si ottengono con `qa:fattura-inviata --stato delivered` e con `--stato sent` più notifica NS (sezione QA sopra).
- Prima di ricontrollare una correzione di stile, verificare che il file modificato sia davvero cambiato (`git diff --stat`) e, se il CSS servito non cambia, chiedere il riavvio della preview nel summary: non avviarla a mano. Caso noto (#132): `.next` conteneva ancora `--info-ink` vecchio (`oklch(0.45 0.2 263)`, servito come `#1046c1`) anche in `.dark`, mentre `src/app/globals.css` riga 100 ha il valore corretto `oklch(0.809 0.105 252)`. Controllo rapido senza browser: `grep -rho "info-ink:[^;]*" .next | sort | uniq -c` deve mostrare anche il valore 0.809; se manca, la preview serve CSS vecchio.
- Screenshot da fare (cartella della run): /login, /fatture (admin e cliente), /fatture/nuova, /ricevute, /stato, /audit, /admin/account, /certificati, più /fatture a 375px con menu aperto.

## Rinomina «Janis» e colore #0B8277 (run #422): cosa cambia per il test
Solo nome visibile e colori: nessuna rotta, dato, utente, variabile d'ambiente o porta nuova. Avvio, login e seed restano quelli sopra. Decisione: ADR 0008; token in design.md, Palette.
- Restano invariati di proposito (identificatori tecnici, non nome visibile): cookie `interscambio_session`, email di test `@interscambio.test`, simbolo del pool DB, nome della cartella/repository `sdi-channel`. Le credenziali in questo file restano valide. «Sistema di Interscambio» (SdI, ente esterno) NON è il nome del prodotto e non va toccato.
- Cosa verificare: titolo della scheda «Janis» (e «Pagina - Janis» nelle pagine interne), logo testuale «Janis» su /login, nella sidebar desktop e nella barra/Sheet mobile; titolo «Janis API» in `GET http://127.0.0.1:4811/api/v1/openapi.json` (campo `info.title`); `package.json` name `janis`; README intitolato Janis.
- Nessun «Interscambio» residuo visibile: `grep -rIn "Interscambio" src server scripts README.md package.json | grep -v "Sistema di Interscambio"` non deve restituire testi visibili (ammessi solo gli identificatori tecnici sopra, che sono minuscoli).
- Colore: nel tema chiaro il colore computato di un bottone primario (es. «Accedi» su /login, «Nuova fattura» su /fatture) e del fondo pieno `bg-primary` deve essere esattamente `rgb(11, 130, 119)` (#0B8277); la voce attiva della sidebar ha fondo primary al 10% e testo `--info-ink` (#076A61, circa 5.7:1), non il primario pieno. Nel tema scuro (emulazione prefers-color-scheme) il primario è il petrolio schiarito #2DB3A5 con testo scuro. Contrasto AA 4.5:1 per testo su primary, voce attiva sidebar e badge (stesso metodo della sezione Restyling).
- Badge: «Inviata» in verde petrolio (testo #076A61), «Consegnata/Accettata» con fondo green 600 (#16A34A) al 10% e testo `--success-ink` green 800 **#166534** nel tema chiaro (circa 6.4:1; il vecchio #15803D dava 4.49:1, issue #138) e #86EFAC nel tema scuro. Devono restare distinguibili a colpo d'occhio.
- Controllo senza browser che la preview serva il CSS nuovo: scaricare il CSS indicato dalla pagina (`curl -s http://127.0.0.1:4810/login | grep -oE '/_next/static/[^"]+\.css'`) e cercarci `0b8277` e `166534`. Se compare ancora `15803d` (o `oklch(0.546 0.245 263)`) la preview serve CSS vecchio: va riavviata dall'infrastruttura (chiederlo nel summary, non a mano). Caso visto in run #422 it.1.
- Screenshot minimi: /login, /fatture da admin (sidebar con voce attiva e bottone primario), /fatture da cliente.alfa, /fatture a 375px con menu aperto, /fatture in tema scuro.
