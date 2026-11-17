# ADR 0005 - Notifiche SdI: ds:Signature obbligatoria e fixture di prova

Stato: accettata (run #405, iterazione 2)

## Contesto
Lo XSD ufficiale `MessaggiTypes_v1.0.xsd` (versionato in `src/sdi/messaggi/xsd`) dichiara `ds:Signature` obbligatoria in tutti i messaggi SdI (RC, NS, MC, NE, DT, SE), più l'attributo `versione` sulla radice, `Destinatario/Codice` e `Destinatario/Descrizione`. I messaggi reali di SdI sono sempre firmati XMLDSig enveloped. Le fixture di test e l'esempio curl di testing.md non lo erano, quindi dopo la validazione XSD (fix #9 e #10) RC e NS valide venivano rifiutate (issue #16).

## Decisione
- La validazione XSD delle notifiche resta stretta: nessun allentamento dello schema, nessuna rimozione di `ds:Signature`.
- Le fixture di prova (test Vitest e curl manuale) diventano conformi allo schema: `versione="1.0"`, `Destinatario` con `Codice` e `Descrizione` secondo il tipo dello XSD, `MessageId`, e una firma XMLDSig enveloped strutturalmente valida (SignedInfo, SignatureValue, KeyInfo con X509Certificate) prodotta a runtime con il certificato di test di `src/sdi/sign/test-cert.ts`. Nessuna chiave nel repo.
- Un generatore unico di notifiche di prova (codice condiviso tra test e script `npm run sdi:notifica-demo`) produce la busta SOAP completa per RC e NS, così testing.md non contiene XML scritto a mano.
- La verifica crittografica della firma SdI (catena verso la CA di SdI) NON è in questa run: oggi si controlla solo la presenza e la struttura via XSD. Sarà un work package dedicato quando avremo il certificato SdI dell'ambiente demo.

## Conseguenze
- In questa run un messaggio con `ds:Signature` strutturalmente valida ma crittograficamente falsa viene accettato. Accettabile solo in demo/locale; in production la rotta è disabilitata (ADR 0004).
- Prima del collaudo sul demo reale: aggiungere la verifica XMLDSig e la catena di fiducia SdI.
