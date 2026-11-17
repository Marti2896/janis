# ADR 0002 - Firma CAdES-BES

Stato: accettata (run #405)

## Decisione
- Libreria: `pkijs` + `asn1js` con la WebCrypto nativa di Node (`globalThis.crypto`).
- Motivo: CAdES-BES (ETSI TS 101 733) richiede l'attributo firmato `signing-certificate-v2` (ESSCertIDv2, OID 1.2.840.113549.1.9.16.2.47) oltre a content-type, message-digest e signing-time. `node-forge` non permette di aggiungerlo in modo pulito; `pkijs` gestisce attributi arbitrari e anche la verifica.
- Formato: CMS SignedData attached (il p7m contiene l'XML), SHA-256, RSA PKCS#1 v1.5, certificato del firmatario incluso. Output DER (`.xml.p7m`); la decodifica accetta anche p7m in base64 (alcuni sistemi lo producono).
- Interfaccia: un `Signer` astratto (sign(bytes) -> p7m) così il certificato qualificato reale (da vault/HSM, fornito dal titolare) si collega senza cambiare il codice chiamante.
- Test: certificato self-signed generato a runtime con `@peculiar/x509` (dev dependency); nessuna chiave nel repo.

## Alternative scartate
- `node-forge`: manca il supporto a signing-certificate-v2.
- Shell verso `openssl cms`: dipendenza di sistema e gestione chiavi su file.

## Aggiornamento (run #405, implementazione)
La libreria effettivamente usata è `node-forge`, non `pkijs`: forge fornisce hash SHA-256, firma RSA PKCS#1 v1.5 e parsing dei certificati, mentre la struttura CMS (ContentInfo/SignedData/SignerInfo) con gli attributi firmati content-type, signing-time, message-digest e signing-certificate-v2 è composta con `forge.asn1` (forge.pkcs7 non accetta attributi firmati personalizzati). Codice in `src/sdi/sign/cades.ts`, certificato di test generato a runtime in `src/sdi/sign/test-cert.ts`.
Conseguenza: con l'ASN.1 composto a mano la conformità strutturale non è garantita dalla libreria. Ogni attributo firmato deve avere un test che ne verifichi la struttura ASN.1 (non solo la presenza dei byte): vedi issue #12 su IssuerSerial/GeneralNames (RFC 5035). L'API pubblica di verifica è `verifyP7m(input: Buffer | string)` (DER o base64) che restituisce `{ xml }`; `verifyCadesBes` resta interna (issue #13).
