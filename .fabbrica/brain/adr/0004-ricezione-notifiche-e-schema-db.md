# ADR 0004 - Ricezione notifiche SdI e schema database

Stato: accettata (run #405)

## Endpoint
- Servizio `TrasmissioneFatture` (WSDL ufficiale `TrasmissioneFatture_v1.1.wsdl`) esposto da Fastify su `POST /sdi/ricezione/trasmissione-fatture` (porta API 4000), content-type `text/xml`.
- Operazioni implementate ora: `RicevutaConsegna` e `NotificaScarto`. Le altre (MC, NE, DT, AT) rispondono con SOAP Fault «operazione non ancora supportata» e vengono comunque registrate nel log di audit.
- Ogni messaggio contiene `fileSdI` (`IdentificativoSdI`, `NomeFile`, `File` base64). Il `File` è l'XML della notifica (schema `MessaggiTypes_v1.1.xsd`, versionato insieme agli altri XSD) che va decodificato, validato e letto: RC -> `DataOraRicezione`, `DataOraConsegna`, `Destinatario`, `MessageId`; NS -> `ListaErrori/Errore` (Codice, Descrizione, Suggerimento).
- Idempotenza in ricezione: la stessa notifica (stesso `IdentificativoSdI` + tipo + `MessageId`) ricevuta due volte non crea un secondo cambio di stato, ma risponde comunque OK a SdI.
- Notifica per fattura sconosciuta: si registra e si risponde OK, la fattura non si crea.

## Schema database (migrazione 0002)
- `tenants` (id uuid, name, vat_id, created_at). Isolamento: ogni query su fatture filtra per `tenant_id`.
- `invoices` (id uuid, tenant_id fk, file_name unique, progressivo, sdi_identifier, status, status_reason, status_updated_at, created_at). Stati: `draft`, `ready`, `sending`, `sent`, `send_unknown`, `send_error`, `delivered` (RC), `rejected` (NS). XML e p7m cifrati a riposo arriveranno con la feature 1 della roadmap: in questa run non si salvano i contenuti fiscali in chiaro, solo metadati.
- `invoice_status_history` (append-only): invoice_id, from_status, to_status, occurred_at, source (`soap_send`, `sdi_notification`...), reason.
- `sdi_notifications` (append-only): id, invoice_id nullable, sdi_identifier, type (`RC`, `NS`, ...), message_id, file_name, received_at, sdi_timestamp, errors jsonb; unique (sdi_identifier, type, message_id).
- `audit_log` (append-only): id bigserial, occurred_at, actor, action, entity, entity_id, payload jsonb. Trigger che solleva eccezione su UPDATE e DELETE per `audit_log`, `invoice_status_history`, `sdi_notifications`.
- Aggiornamento stato e inserimento storico/notifica/audit nella stessa transazione.
