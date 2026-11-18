# ADR 0006 - Login, multi-tenant, dashboard e API esterna (run #406)

Stato: accettato (run #406). Prodotto rinominato «Interscambio» (package.json `name: interscambio`).

## Contesto
Fino alla run #405 esistono solo i moduli SDI (fatturapa, sign, client, messaggi) e la ricezione RC/NS su Fastify, senza alcuna autenticazione. Serve un prodotto usabile: login, isolamento totale tra tenant, dashboard, area admin, API REST con API key, notifiche complete e fatture passive.

## Decisioni
1. **Due processi, un solo strato dati.** La web app Next (porta 4810) gestisce login, sessione e pagine; le pagine leggono e scrivono tramite funzioni server in `src/server/` (mai SQL nei componenti). Fastify (porta 4811) espone gli endpoint SdI (SOAP) e l'API esterna `/api/v1` con API key. Entrambi usano lo stesso repository.
2. **Isolamento tenant nel repository, non nelle pagine.** Ogni funzione di lettura/scrittura riceve uno `Scope` obbligatorio (`{ role: 'admin' } | { role: 'cliente', tenantId }`) e filtra sempre per `tenant_id` quando il ruolo è cliente. Accesso a una risorsa di un altro tenant = «non trovato» (404), mai 403, per non rivelarne l'esistenza. Un test Vitest con due tenant verifica esplicitamente che nessuna funzione esponga dati dell'altro (lista, dettaglio, download, audit, API key).
3. **Password e sessioni.** Hash argon2id (o bcrypt cost >= 12 se argon2 non compila). Sessioni in tabella Postgres `sessions` con token casuale da 32 byte, salvato come hash SHA-256; cookie `interscambio_session` httpOnly, SameSite=Lax, Secure in produzione, scadenza 12 ore con rinnovo. Logout cancella la sessione. Login con messaggio di errore generico e limitazione tentativi per email/IP. Niente registrazione pubblica: gli account li crea l'admin.
4. **API key** per tenant: formato `isk_<prefisso>_<segreto>`, salvate come hash SHA-256 con prefisso visibile, mostrate in chiaro una sola volta, revocabili. Le chiamate API vanno in audit come quelle web. OpenAPI 3.1 servito da `/api/v1/openapi.json`.
5. **Certificati.** Interfaccia `SecretStore` (get/put per riferimento). Implementazione di sviluppo: cifratura AES-256-GCM con chiave master da variabile d'ambiente `SECRETS_MASTER_KEY` (mai nel repo; il seed di sviluppo ne genera una in `.env` se manca). Nel DB solo metadati (soggetto, emittente, numero seriale, impronta, `not_after`, ambiente) e il riferimento al segreto. In produzione l'implementazione sarà il vault, senza cambiare chi la usa. Avviso scadenza: rosso se scaduto o entro 7 giorni, giallo entro 30.
6. **Configurazione canale** in tabella `channel_settings` (ambiente attivo, endpoint demo/prod), modificabile solo da admin e registrata in audit. Il passaggio a `production` è bloccato se non c'è un certificato valido per produzione e un endpoint configurato. `.env` resta il default iniziale.
7. **Stati fattura emessa** estesi: `not_delivered` (MC), `accepted` / `refused` (NE EC01/EC02, solo PA), `terms_expired` (DT). Etichette UI: in coda (draft, signed, sending, send_unknown), inviata (sent), consegnata (delivered), scartata (rejected), mancata consegna (not_delivered), accettata, rifiutata, decorrenza termini, errore invio (send_error). SE (scarto esito committente) riguarda gli esiti inviati da noi come destinatari e si registra sulla fattura ricevuta.
8. **Fatture passive.** Endpoint SOAP `RicezioneFatture` (RiceviFatture, NotificaDecorrenzaTermini). File originale (XML o P7M) e metadati salvati così come arrivano, con hash SHA-256; tenant assegnato per partita IVA o codice fiscale del cessionario/committente. Se nessun tenant corrisponde la fattura resta «non assegnata», visibile solo all'admin. Idempotenza per IdentificativoSdI.
9. **Audit** resta append-only (trigger di 0002). Ogni login, logout, creazione account, API key, cambio configurazione, upload certificato, invio, ricezione e notifica scrive un evento con `tenant_id`.

## Conseguenze
- Le tabelle storiche restano append-only: le correzioni si fanno con nuovi eventi.
- La validità crittografica della firma sulle notifiche resta rinviata (ADR 0005).
- Nessuna chiamata a SdI reale: in sviluppo l'invio usa l'endpoint demo configurato oppure, se vuoto, la fattura resta «in coda» con avviso visibile.
