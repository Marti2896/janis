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

## Aggiornamento (run #405, implementazione: vale questo schema)
Migrazione `db/migrations/0002_sdi_core.sql`, che sostituisce le colonne descritte sopra:
- `tenants` (id uuid, partita_iva char(11) unique, denominazione, created_at).
- `invoices` (id, tenant_id, numero, data, `nome_file` UNIQUE, sha256_xml, sha256_p7m, sdi_identifier unique per tenant se valorizzato, `replaces_invoice_id` nullable, status con check su draft/signed/sending/sent/send_error/send_unknown/delivered/rejected, created_at, updated_at). Nessun XML o p7m in chiaro.
- `invoice_status_history` (append-only): invoice_id, tenant_id, from_status, to_status, causale, sdi_timestamp, recorded_at, source (client | sdi_notification | seed).
- `sdi_notifications` (append-only): tenant_id e invoice_id nullable, sdi_identifier, type (RC | NS), message_id NOT NULL default '', nome_file, file_sha256, received_at, sdi_timestamp, data_consegna, destinatario, errori jsonb; UNIQUE (sdi_identifier, type, message_id).
- `audit_log` (append-only): tenant_id, event, entity, entity_id, detail jsonb, created_at.
- Trigger `forbid_mutation` su UPDATE e DELETE delle tre tabelle append-only.

Ricezione (`src/server/notifications.ts`, registrata da `server/index.ts`): fast-xml-parser con `removeNSPrefix`; RC porta a `delivered`, NS a `rejected`, entrambe accettate solo da `sent` o `send_unknown`. Abbinamento fattura: prima per `sdi_identifier`, poi per NomeFile (con o senza `.p7m`). Duplicati, fatture sconosciute e stati incompatibili rispondono 200 (con audit dove serve); XML malformato, operazione non supportata e ambiente production rispondono 500 con SOAP Fault. Tutto in una transazione; il lock `FOR UPDATE` sulla fattura evita corse.
Transizioni consentite (`canTransition`): draft>signed>sending>sent|send_error|send_unknown; sent|send_unknown>delivered|rejected; send_error, delivered e rejected sono terminali.
