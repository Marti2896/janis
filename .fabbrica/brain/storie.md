# User story

Le funzionalità del prodotto raccontate come percorsi dell'utente. I diagrammi completi stanno in .fabbrica/storie/*.json e si vedono nella pagina User story della fabbrica.



## Accedere alla piattaforma con il proprio account (accesso-login-multi-tenant)
Login con email e password; ogni utente entra nella propria area in base al ruolo e al tenant.
Attori: cliente, admin
- [inizio] Apre l'app · utente
  Senza sessione viene reindirizzato al login.
- [azione] Inserisce email e password · utente
  Form con Card, Input email e password, Button Accedi.
- [sistema] Verifica credenziali e stato account · sistema
  Hash argon2id o bcrypt; email case-insensitive.
- [decisione] Credenziali valide e account attivo? · sistema
  Stesso messaggio generico in caso di errore.
- [uscita] Messaggio generico di errore · sistema
  Email o password non corretti. Dopo 5 errori in 15 minuti scatta il blocco.
- [decisione] Ruolo admin? · sistema
  Il ruolo determina il menu e le pagine accessibili.
- [sistema] Apre la dashboard del cliente · sistema
  Cookie interscambio_session httpOnly, redirect a /fatture con soli dati del tenant.
- [sistema] Apre l'area admin · sistema
  Vede tutti i tenant, certificati e canale.
- [fine] Area autenticata pronta · utente
  Logout cancella il cookie e invalida la sessione.
- Apre l'app → Inserisce email e password (apre login)
- Inserisce email e password → Verifica credenziali e stato account (invia)
- Verifica credenziali e stato account → Credenziali valide e account attivo? (verifica)
- Credenziali valide e account attivo? ↯ Messaggio generico di errore (no)
- Credenziali valide e account attivo? → Ruolo admin? (sì)
- Ruolo admin? ⇢ Apre la dashboard del cliente (cliente)
- Ruolo admin? ⇢ Apre l'area admin (admin)
- Apre la dashboard del cliente → Area autenticata pronta (completato)
- Apre l'area admin → Area autenticata pronta (completato)

Fatto quando:
- Senza sessione ogni pagina porta a /login
- Credenziali errate mostrano un messaggio generico
- Un cliente vede solo i dati del proprio tenant
- Dopo il logout la sessione non è più valida

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

## Navigare nell'app con la sidebar a gruppi (restyling-navigazione-palette)
Il cliente o l'admin passa da una sidebar a gruppi (desktop) o da un menu a scomparsa (mobile) alle pagine operative e admin.
Attori: cliente, admin
- [inizio] Apre l'area autenticata · utente
  Login gia fatto, con sessione valida
- [decisione] Schermo sopra o sotto 768px? · sistema
  Decide la forma della navigazione
- [sistema] Mostra la sidebar fissa a sinistra · sistema
  Gruppi Fatture, Canale, Audit; Amministrazione solo per admin
- [sistema] Mostra la barra con Apri il menu · sistema
  Il menu si apre da sinistra con gli stessi gruppi
- [azione] Sceglie una voce · utente
  Clic su una voce del menu
- [sistema] Apre la pagina e marca la voce attiva · sistema
  Il menu mobile si chiude; la voce attiva e blu
- [decisione] Utente admin? · sistema
  Solo admin vede il gruppo Amministrazione
- [uscita] Nessun gruppo Amministrazione · sistema
  Il cliente che apre /admin/account riceve Accesso negato
- [fine] Pagina operativa con colonna # · utente
  Contenuto largo fino a 1280px e tabelle numerate
- Apre l'area autenticata → Schermo sopra o sotto 768px?
- Schermo sopra o sotto 768px? → Mostra la sidebar fissa a sinistra (desktop)
- Schermo sopra o sotto 768px? ⇢ Mostra la barra con Apri il menu (mobile)
- Mostra la sidebar fissa a sinistra → Sceglie una voce (clic voce)
- Mostra la barra con Apri il menu → Sceglie una voce (scelta voce)
- Sceglie una voce → Apre la pagina e marca la voce attiva (naviga)
- Apre la pagina e marca la voce attiva → Utente admin? (controllo ruolo)
- Utente admin? ↯ Nessun gruppo Amministrazione (cliente)
- Utente admin? → Pagina operativa con colonna # (admin vede gruppo)

Fatto quando:
- Il cliente vede tre gruppi senza Amministrazione
- L'admin vede anche il gruppo Amministrazione separato
- Su mobile il menu si apre e si chiude e una voce chiude il menu
- La voce attiva resta evidenziata dopo il reload

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

## Ricevere una fattura passiva e renderla disponibile al destinatario (ricezione-fatture-passive)
SdI consegna una fattura; il sistema conserva il file originale e la assegna all'account giusto.
Attori: SdI demo, cliente, admin
- [inizio] SdI consegna la fattura · SdI demo
  RiceviFatture con file e metadati.
- [sistema] Legge l'XML o estrae il file dal P7M · sistema
  Estrae cedente e cessionario per instradare.
- [decisione] Il file è valido? · sistema
  Controllo di struttura e firma.
- [uscita] Rifiuto con motivo · sistema
  Nessun record creato.
- [sistema] Salva file originale e sha256 · sistema
  Storico append-only e audit.
- [decisione] IdentificativoSdI già noto? · sistema
  Vincolo unique su sdi_identifier.
- [uscita] Duplicato ignorato · sistema
  Risposta positiva senza nuovo record.
- [decisione] Il cessionario corrisponde a un account? · sistema
  Partita IVA, poi codice fiscale.
- [sistema] Assegna all'account · sistema
  Visibile nelle Fatture ricevute del cliente.
- [sistema] Lascia non assegnata · sistema
  Visibile solo all'admin, che può assegnarla.
- [fine] Il destinatario la scarica · cliente
  Download del file originale byte per byte.
- SdI consegna la fattura → Legge l'XML o estrae il file dal P7M (ricezione)
- Legge l'XML o estrae il file dal P7M → Il file è valido? (verifica)
- Il file è valido? ↯ Rifiuto con motivo (no)
- Il file è valido? → Salva file originale e sha256 (sì)
- Salva file originale e sha256 → IdentificativoSdI già noto? (salvataggio)
- IdentificativoSdI già noto? ⇢ Duplicato ignorato (sì)
- IdentificativoSdI già noto? → Il cessionario corrisponde a un account? (no)
- Il cessionario corrisponde a un account? → Assegna all'account (sì)
- Il cessionario corrisponde a un account? ⇢ Lascia non assegnata (no)
- Assegna all'account → Il destinatario la scarica (completato)
- Lascia non assegnata ⇢ Il destinatario la scarica (dopo assegnazione)

Fatto quando:
- Il download restituisce un file identico per sha256
- Un duplicato con lo stesso IdentificativoSdI non crea un nuovo record
- Una fattura senza destinatario noto resta visibile solo all'admin

## Riconoscere Janis e la palette petrolio (rinomina-janis-palette)
Il visitatore e il cliente vedono il nuovo nome Janis e il colore principale petrolio su login, sidebar e badge.
Attori: visitatore, cliente, admin
- [inizio] Apre Janis nel browser · utente
  Pagina di login senza sessione
- [azione] Apre il login o l'area autenticata · utente
  Scheda e logo sono i primi segni del nome
- [sistema] Mostra Janis nel titolo, nel logo e nella sidebar · sistema
  Titolo Accedi - Janis; logo testuale Janis
- [decisione] Tema chiaro o scuro? · sistema
  Decide il colore primario in uso
- [sistema] Tema chiaro: primario #0B8277 · sistema
  Bottoni con testo bianco; voce attiva con testo --info-ink
- [sistema] Tema scuro: primario #2DB3A5 · sistema
  Bottoni con testo #042F2B
- [sistema] Badge: Inviata petrolio, Consegnata verde · sistema
  Inviata e Consegnata si distinguono a colpo d'occhio
- [fine] Janis con palette petrolio · utente
  Nessun blu residuo, contrasti AA
- Apre Janis nel browser → Apre il login o l'area autenticata (apre)
- Apre il login o l'area autenticata → Mostra Janis nel titolo, nel logo e nella sidebar (mostra)
- Mostra Janis nel titolo, nel logo e nella sidebar → Tema chiaro o scuro? (verifica tema)
- Tema chiaro o scuro? → Tema chiaro: primario #0B8277 (chiaro)
- Tema chiaro o scuro? ⇢ Tema scuro: primario #2DB3A5 (scuro)
- Tema chiaro: primario #0B8277 → Badge: Inviata petrolio, Consegnata verde (badge)
- Tema scuro: primario #2DB3A5 → Badge: Inviata petrolio, Consegnata verde (badge)
- Badge: Inviata petrolio, Consegnata verde → Janis con palette petrolio (completato)

Fatto quando:
- Il titolo della scheda e la sidebar mostrano Janis
- I bottoni primari e la voce attiva sono #0B8277 nel tema chiaro e #2DB3A5 nel tema scuro
- Inviata e Consegnata sono distinguibili
- Il testo resta leggibile con contrasto AA

## Usare l'API con una chiave per account (api-esterna-chiavi)
Il cliente genera una chiave; un sistema esterno legge e invia fatture solo per il proprio tenant.
Attori: cliente, sistema esterno
- [inizio] Il cliente crea una API key · cliente
  Dalla sezione API, con un nome.
- [sistema] Mostra la chiave una volta e salva l'hash · sistema
  Formato isk_<prefisso>_<segreto>.
- [azione] Il CRM chiama l'API con X-API-Key · sistema esterno
  Ad esempio GET /api/v1/invoices.
- [decisione] Chiave presente e attiva? · sistema
  Non revocata.
- [uscita] 401 non autorizzato · sistema
  Chiave mancante o revocata.
- [sistema] Applica lo scope del tenant della chiave · sistema
  Ogni query passa dal repository con Scope.
- [decisione] La risorsa appartiene al tenant? · sistema
  Altrimenti non viene nemmeno letta.
- [uscita] 404 non trovato · sistema
  Stessa risposta di una risorsa inesistente.
- [fine] Risposta JSON e audit della chiamata · sistema esterno
  Le scritture creano un evento di audit.
- Il cliente crea una API key → Mostra la chiave una volta e salva l'hash (crea)
- Mostra la chiave una volta e salva l'hash → Il CRM chiama l'API con X-API-Key (usa la chiave)
- Il CRM chiama l'API con X-API-Key → Chiave presente e attiva? (verifica)
- Chiave presente e attiva? ↯ 401 non autorizzato (no)
- Chiave presente e attiva? → Applica lo scope del tenant della chiave (sì)
- Applica lo scope del tenant della chiave → La risorsa appartiene al tenant? (verifica)
- La risorsa appartiene al tenant? ↯ 404 non trovato (no)
- La risorsa appartiene al tenant? → Risposta JSON e audit della chiamata (sì)

Fatto quando:
- La chiave è mostrata una sola volta
- Una chiave revocata dà 401
- Una risorsa di un altro tenant dà 404
