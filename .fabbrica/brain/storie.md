# User story

Le funzionalità del prodotto raccontate come percorsi dell'utente. I diagrammi completi stanno in .fabbrica/storie/*.json e si vedono nella pagina User story della fabbrica.



## Emettere e inviare una fattura al Sistema di Interscambio (emissione-fattura-sdicoop)
Dal modello della fattura al file FatturaPA validato, firmato in CAdES-BES e inviato al demo SdI senza duplicati.
Attori: chiamante interno, SdI demo
- [inizio] Il chiamante richiede l'emissione · chiamante interno
  Passa il modello della fattura al modulo di generazione.
- [azione] Compila cedente, cessionario, righe e pagamento · chiamante interno
  Il modello contiene i dati obbligatori del tracciato FPR12.
- [decisione] Il modello è completo? · sistema
  Controllo delle righe, dei campi obbligatori e dei codici.
- [uscita] Errore di validazione · sistema
  Lista dei campi mancanti o non validi.
- [sistema] Genera l'XML FPR12 e lo valida contro gli XSD · sistema
  Calcola il DatiRiepilogo e formatta gli importi in centesimi.
- [decisione] L'XML è valido? · sistema
  Validazione contro lo schema ufficiale versionato.
- [uscita] Rifiuto con errore XSD leggibile · sistema
  Messaggio con percorso del campo.
- [sistema] Firma in CAdES-BES e produce il p7m · sistema
  Certificato incluso, signing-certificate-v2, NomeFile con .xml.p7m.
- [sistema] La fattura passa a signed · sistema
  Transizione con storico e audit nella stessa transazione.
- [decisione] Esiste già un invio con questo NomeFile? · sistema
  Controllo di idempotenza prima di qualsiasi chiamata HTTP.
- [uscita] Invio rifiutato come duplicato · sistema
  L'endpoint non viene chiamato.
- [sistema] Invia SdIRiceviFile al demo · sistema
  Busta SOAP con NomeFile e File in base64. Retry solo su rete e 5xx.
- [decisione] Qual è l'esito? · SdI demo
  Risposta con IdentificativoSdI, Errore SdI o nessuna risposta.
- [sistema] Fattura in stato sent · sistema
  IdentificativoSdI salvato, storico e audit scritti.
- [uscita] Stato send_error · sistema
  Errore SdI: nessun retry. Richiede una nuova fattura.
- [uscita] Stato send_unknown · sistema
  Rete o 5xx esauriti: nessun retry automatico, si attende una notifica.
- [fine] Fattura inviata, in attesa di notifica · sistema
  Le notifiche RC o NS aggiornano lo stato.
- Il chiamante richiede l'emissione → Compila cedente, cessionario, righe e pagamento (avvia)
- Compila cedente, cessionario, righe e pagamento → Il modello è completo? (invia modello)
- Il modello è completo? ↯ Errore di validazione (no)
- Il modello è completo? → Genera l'XML FPR12 e lo valida contro gli XSD (sì)
- Genera l'XML FPR12 e lo valida contro gli XSD → L'XML è valido? (genera)
- L'XML è valido? ↯ Rifiuto con errore XSD leggibile (no)
- L'XML è valido? → Firma in CAdES-BES e produce il p7m (sì)
- Firma in CAdES-BES e produce il p7m → La fattura passa a signed (firmato)
- La fattura passa a signed → Esiste già un invio con questo NomeFile? (verifica)
- Esiste già un invio con questo NomeFile? ⇢ Invio rifiutato come duplicato (sì)
- Esiste già un invio con questo NomeFile? → Invia SdIRiceviFile al demo (no)
- Invia SdIRiceviFile al demo → Qual è l'esito? (risposta)
- Qual è l'esito? → Fattura in stato sent (IdentificativoSdI)
- Qual è l'esito? ↯ Stato send_error (Errore SdI)
- Qual è l'esito? ↯ Stato send_unknown (rete o 5xx esauriti)
- Fattura in stato sent → Fattura inviata, in attesa di notifica (completato)

Fatto quando:
- Il modello valido produce un XML che passa la validazione XSD
- Il file firmato viene verificato e restituisce il contenuto identico
- L'invio riuscito porta la fattura a sent con IdentificativoSdI
- Un errore di rete esaurito porta a send_unknown senza retry automatico
- Un secondo invio con lo stesso NomeFile non chiama l'endpoint

## Ricevere gli esiti SdI su una fattura inviata (ricezione-notifiche-sdi)
SdI chiama l'endpoint con RC o NS; il sistema registra la notifica e aggiorna lo stato della fattura una sola volta.
Attori: SdI demo, sistema di ricezione
- [inizio] SdI invia una notifica · SdI demo
  POST SOAP con fileSdI.
- [sistema] Verifica busta SOAP e Content-Type · sistema
  Controllo della struttura e del text/xml.
- [decisione] Operazione supportata? · sistema
  Sono supportate RicevutaConsegna e NotificaScarto.
- [uscita] SOAP Fault: operazione non ancora supportata · sistema
  Audit dell'operazione ricevuta.
- [sistema] Decodifica il file e lo valida contro XSD · sistema
  Il file notifica viene decodificato dal base64.
- [decisione] XML e XSD sono validi? · sistema
  Controllo della notifica.
- [uscita] SOAP Fault: XML non valido · sistema
  Nessuna transizione di stato.
- [decisione] La fattura è conosciuta? · sistema
  Ricerca per IdentificativoSdI.
- [uscita] Notifica registrata senza fattura · sistema
  invoice_id nullo, audit, risposta OK.
- [decisione] La notifica è già registrata? · sistema
  Chiave unica su IdentificativoSdI, tipo e MessageId.
- [uscita] Duplicato: risposta OK, nessuna modifica · sistema
  Nessuna riga nuova e nessun cambio di stato.
- [decisione] Che tipo di notifica è? · sistema
  RC o NS.
- [sistema] RC: la fattura passa a delivered · sistema
  Salvataggio di DataOraConsegna e Destinatario.
- [sistema] NS: la fattura passa a rejected · sistema
  Salvataggio dei codici errore in ListaErrori.
- [sistema] Transazione: notifica, storico e audit · sistema
  Scrittura atomica in tabelle append-only.
- [fine] Risposta SOAP vuota conforme al WSDL · sistema
  HTTP 200.
- SdI invia una notifica → Verifica busta SOAP e Content-Type (ricevuta)
- Verifica busta SOAP e Content-Type → Operazione supportata? (busta valida)
- Operazione supportata? ↯ SOAP Fault: operazione non ancora supportata (altra operazione)
- Operazione supportata? → Decodifica il file e lo valida contro XSD (RC o NS)
- Decodifica il file e lo valida contro XSD → XML e XSD sono validi? (decodifica)
- XML e XSD sono validi? ↯ SOAP Fault: XML non valido (no)
- XML e XSD sono validi? → La fattura è conosciuta? (sì)
- La fattura è conosciuta? ⇢ Notifica registrata senza fattura (no)
- La fattura è conosciuta? → La notifica è già registrata? (sì)
- La notifica è già registrata? ⇢ Duplicato: risposta OK, nessuna modifica (sì)
- La notifica è già registrata? → Che tipo di notifica è? (no)
- Che tipo di notifica è? → RC: la fattura passa a delivered (RC)
- Che tipo di notifica è? → NS: la fattura passa a rejected (NS)
- RC: la fattura passa a delivered → Transazione: notifica, storico e audit (scrive)
- NS: la fattura passa a rejected → Transazione: notifica, storico e audit (scrive)
- Notifica registrata senza fattura ⇢ Transazione: notifica, storico e audit (solo notifica e audit)
- Duplicato: risposta OK, nessuna modifica ⇢ Risposta SOAP vuota conforme al WSDL (risposta OK)
- Transazione: notifica, storico e audit → Risposta SOAP vuota conforme al WSDL (completato)

Fatto quando:
- RC sulla fattura demo porta a delivered con data consegna
- NS porta a rejected con i codici errore salvati
- Una notifica ripetuta non duplica né lo storico né la riga di notifica
- Operazioni non supportate ricevono un SOAP Fault e un audit
- UPDATE e DELETE sulle tabelle append-only sono bloccati
