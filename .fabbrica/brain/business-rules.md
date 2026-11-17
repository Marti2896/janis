# Business rules

Regole di dominio che nessun agente può violare. Obiettivo: superare il collaudo reale SdI (canale Web Service SDICoop, non PEC/FTP); nessuna scorciatoia sulle specifiche tecniche ufficiali (fatturapa.gov.it, Provvedimento AdE 30/04/2018 e successivi).

## Prodotto
Canale telematico accreditato: i clienti (tenant) inviano e ricevono fatture elettroniche tramite API REST con API key per cliente; un operatore usa la dashboard admin.

## Regole non negoziabili
- Demo/test e produzione SdI hanno configurazione ed endpoint separati; il test si costruisce prima della produzione.
- Segreti, chiavi private e certificati stanno in vault/secret manager, mai nel repo né in chiaro nel DB.
- Dati fiscali cifrati a riposo; isolamento totale tra tenant.
- Log di audit append-only e immutabile per ogni invio, ricezione e notifica.
- Mai duplicare un invio al SdI (idempotenza); retry con backoff esponenziale.
- Nome file: IdPaese + IdCodice + `_` + progressivo (`.xml` / `.xml.p7m`). Firma CAdES-BES (ETSI TS 101 733). XML validato contro gli XSD ufficiali. Mutua autenticazione TLS.
- Notifiche gestite: RC, NS, MC, NE, DT, SE; ogni notifica aggiorna lo stato con storico (timestamp, tipo, causale errore).
- Codice destinatario a 7 cifre; instradamento delle passive al tenant per partita IVA/codice fiscale.

## Prime feature (roadmap MVP, non ancora implementate)
1. Configurazione demo/prod, schema PostgreSQL multi-tenant con cifratura, vault, audit log.
2. Generazione FatturaPA (FPR12/FPA12, xmlbuilder2), validazione XSD e controlli formali pre-invio.
3. Firma CAdES-BES con verifica.
4. Client SOAP SDICoop-Trasmissione + coda BullMQ idempotente.
5. Servizio SOAP SDICoop-Ricezione (notifiche e fatture passive) con archiviazione XML/P7M.
6. Routing per codice destinatario e API REST OpenAPI con API key.
7. Dashboard admin (stato canale, SLA, code, errori, tenant/API key, certificati con alert scadenza).
8. Suite Vitest dei casi di collaudo (base, scarto, PA, privato, nota di credito, split payment, reverse charge) contro SdI simulato; documento di mappatura requisiti→moduli e checklist pre-collaudo.
