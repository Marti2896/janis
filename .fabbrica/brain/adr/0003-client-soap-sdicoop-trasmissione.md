# ADR 0003 - Client SOAP SDICoop Trasmissione

Stato: accettata (run #405)

## Decisione
- Niente libreria SOAP generica (`soap`/`strong-soap`): il servizio ha una sola operazione (`SdIRiceviFile`), si costruisce la busta SOAP 1.1 a mano secondo il WSDL ufficiale `SdIRiceviFile_v1.0.wsdl` e i tipi `SdIRiceviFile_v1.0.xsd`, si invia con `fetch` (undici) e si legge la risposta con un parser XML (`fast-xml-parser`).
- Richiesta: elemento `fileSdIAccoglienza` con `NomeFile` e `File` (base64 del p7m). Il WSDL prevede MTOM: il client supporta l'invio inline base64 e lascia un punto di estensione per MTOM; l'esito sul demo reale va verificato prima del collaudo (rischio aperto).
- Risposta: `rispostaSdIRiceviFile` con `IdentificativoSdI`, `DataOraRicezione`, eventuale `Errore` (EI01, EI02, EI03...). Un Fault SOAP è un errore applicativo, non di rete.
- Endpoint solo da config (`SDI_DEMO_TRASMISSIONE_URL`). Il client rifiuta di partire se `SDI_ENV=production` in questa fase.
- Mutua TLS: il client accetta un `dispatcher` undici iniettato; il certificato client arriverà dal vault, non in questa run.
- Retry: backoff esponenziale con jitter, solo su errore di rete, timeout o HTTP 5xx/503; mai su risposta applicativa (Errore SdI o Fault). Parametri configurabili (tentativi, base, tetto).
- Idempotenza: prima di inviare si marca la fattura `sending` con una transizione condizionale in DB (solo da `ready`); un secondo invio dello stesso `NomeFile` viene rifiutato. Se la rete cade dopo l'invio senza risposta, lo stato resta `send_unknown` e non si ritenta in automatico (il duplicato verrebbe scartato da SdI con EI01/00404 ma va evitato).
