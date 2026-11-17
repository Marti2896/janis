# Da dove nasce sdi-channel

Costruisci da zero un sistema di INVIO E GESTIONE della fatturazione elettronica italiana, finalizzato a diventare un canale telematico ACCREDITATO presso il Sistema di Interscambio (SDI) dell'Agenzia delle Entrate. Il progetto deve essere PERFETTO e conforme al 100% alle specifiche tecniche ufficiali, perche il suo obiettivo finale e superare il collaudo/accreditamento SDI reale (canale Web Service SDICoop, non PEC, non FTP).

REQUISITI FUNZIONALI OBBLIGATORI, seguendo il Provvedimento Agenzia delle Entrate del 30 aprile 2018 e successive modifiche, e le Specifiche Tecniche SdI (ultima versione pubblicata su fatturapa.gov.it):

1. TRASMISSIONE (invio fatture al SdI):
   - Generazione file FatturaPA in formato XML conforme al tracciato ufficiale (fattura ordinaria FPR12 e fattura PA FPA12), validato contro gli XSD ufficiali pubblicati da fatturapa.gov.it.
   - Firma digitale del file XML in formato CAdES-BES (p7m), conforme a ETSI TS 101 733, con certificato di firma qualificato.
   - Nome file conforme alla nomenclatura ufficiale (IdPaese + IdCodice + _ + progressivo, con eventuale .xml.p7m).
   - Invio tramite Web Service SDICoop: implementare il client SOAP/WS per l'invio (NomeFile, File in base64) secondo il WSDL ufficiale SdI.
   - Gestione della coda di invio con retry e backoff in caso di errore di rete, senza mai duplicare invii.

2. RICEZIONE ESITI E NOTIFICHE (fondamentale per il collaudo):
   - Implementare il servizio di RICEZIONE esposto dal canale (l'interfaccia che SdI chiama per notificare gli esiti), secondo le specifiche SDICoop-Ricezione.
   - Gestire TUTTI i tipi di notifica/esito previsti: Ricevuta di Consegna (RC), Notifica di Scarto (NS), Notifica di Mancata Consegna (MC), Notifica Esito (NE accettazione/rifiuto da parte del cliente PA o B2B), Notifica di Decorrenza Termini (DT), Notifica di Scarto Esito Committente (SE).
   - Ogni notifica deve aggiornare lo stato della fattura nel database con tracciabilita completa (timestamp, tipo esito, causale errore se scarto).
   - Validazione formale dei controlli che SdI effettua prima di accettare una fattura (partita IVA esistente in Anagrafe Tributaria, campi obbligatori presenti, formato data, coerenza importi/aliquote IVA) cosi da minimizzare gli scarti in produzione.

3. RICEZIONE FATTURE (fatture dirette al cliente tramite il nostro canale):
   - Gestione del "codice destinatario" a 7 cifre assegnato dal SdI al nostro canale.
   - Consegna delle fatture ricevute al cliente corretto in base alla partita IVA/codice fiscale destinatario, con area multi-tenant (piu clienti diversi sullo stesso canale, ognuno vede solo le sue fatture).
   - Download e archiviazione sicura del file XML/P7M originale ricevuto da SdI.

4. AMBIENTE DI TEST (fondamentale, va costruito PRIMA della produzione):
   - Configurazione separata per ambiente demo/test SdI (endpoint demo distinti da quelli di produzione, come da specifiche tecniche: ambiente di test ha base URL differenti).
   - Suite di test automatici che replica i casi di collaudo richiesti da SdI prima di abilitare il canale in produzione (invio base, fattura con errori attesi -> verifica scarto corretto, fattura verso PA, fattura verso privato, nota di credito, split payment, reverse charge).

5. SICUREZZA E CONFORMITA:
   - Mutua autenticazione TLS con certificati client/server, come richiesto dal canale Web Service SdI.
   - Conservazione sicura delle chiavi private e dei certificati (mai in chiaro nel repo, uso di vault/secret manager).
   - Log di audit completo e immutabile di ogni invio/ricezione/notifica per responsabilita legale verso i clienti.
   - GDPR: dati fiscali di terzi (i clienti che useranno il canale), quindi cifratura a riposo dei dati fiscali sensibili e controllo accessi granulare.

6. AREA ADMIN/OPERATIVA:
   - Dashboard per monitorare stato del canale, SLA (uptime, tempi di consegna), code di invio, errori da gestire manualmente.
   - Gestione certificati con alert di scadenza (i certificati vanno rinnovati, un certificato scaduto blocca tutto il canale).
   - API REST documentate (OpenAPI/Swagger) per permettere ai nostri stessi CRM client (es. il progetto CRM-solleciti-pagamenti per il cliente Cristian) di leggere/inviare fatture tramite questo canale, con autenticazione a chiave API per singolo cliente finale (analogo al modello Aruba/Fatture in Cloud: ogni cliente finale genera/riceve una API key).

7. DOCUMENTAZIONE RICHIESTA PER L'ACCREDITAMENTO:
   - Documento tecnico che mappa ogni requisito delle Specifiche Tecniche SdI al relativo modulo implementato (serve per compilare la richiesta di accreditamento su fatturapa.gov.it con tutti gli endpoint e dati tecnici richiesti).
   - Checklist pre-collaudo con tutti i casi di test richiesti spuntati.

STACK: TypeScript, Node.js backend, PostgreSQL per stato fatture/notifiche, libreria SOAP per il client/server WS (es. soap o strong-soap), xmlbuilder2/fast-xml-parser per generazione/parsing XML, node-forge o modulo equivalente per firma CAdES-BES, Redis o coda equivalente per retry invio.

OBIETTIVO FINALE: codice e documentazione tecnica COMPLETA e CORRETTA al 100%, perche serve letteralmente a passare il collaudo reale con l'Agenzia delle Entrate per diventare canale accreditato SDI con partita IVA individuale (confermato possibile, nessun requisito di forma societaria). Non semplificare nessun passaggio delle specifiche tecniche: ogni scorciatoia qui significa un fallimento reale nel collaudo ufficiale.

