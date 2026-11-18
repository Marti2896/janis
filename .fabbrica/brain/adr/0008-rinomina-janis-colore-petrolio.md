# ADR 0008 - Rinomina in «Janis» e colore primario #0B8277

Stato: accettato (run #422). Sostituisce per nome e accento quanto scritto in ADR 0006 (nome «Interscambio») e ADR 0007 (accento blu).

## Contesto
La cliente ha chiesto di rinominare il prodotto in «Janis» e di adottare come colore primario di brand esattamente #0B8277 (verde petrolio), applicato da un punto centrale del tema.

## Decisioni
1. **Nome visibile.** «Janis» ovunque l'utente vede il nome del prodotto: `<title>` e template, descrizione metadata, logo testuale su login, sidebar e barra mobile, titolo OpenAPI («Janis API»), README, `package.json` `name: janis`, commenti che nominano il prodotto, CN del certificato di test autogenerato.
2. **Identificatori tecnici invariati.** Cookie `interscambio_session` (cambiarlo disconnetterebbe le sessioni e il proxy), email di seed `@interscambio.test` (documentate in testing.md), `Symbol.for("interscambio.pool")`, cartella del repository. «Sistema di Interscambio» è l'ente SdI e non si tocca.
3. **Colore.** Unico punto centrale: variabili CSS in `src/app/globals.css` (`--primary`, `--ring`, `--info-ink`), scritte in hex o oklch equivalente purché il valore computato sia esattamente rgb(11,130,119) nel tema chiaro. Nessun colore hardcoded nei componenti.
4. **Contrasto.** Bianco su #0B8277 = circa 4.7:1 (AA). Nel tema scuro #0B8277 come testo su #0F172A darebbe circa 3.8:1 (non AA), quindi `.dark` usa un petrolio schiarito (#2DB3A5) con `--primary-foreground` scuro (#042F2B).
5. **Separazione da success.** Il verde smeraldo #059669 di `--success` è troppo vicino al petrolio: «Inviata» e «Consegnata» diventerebbero indistinguibili. `--success` passa a green 600 (#16A34A, scuro #22C55E) e `--success-ink` a green 700 / green 300. Rosso, ambra e neutri invariati.

## Conseguenze
Valori di riferimento in design.md (Palette). Contrasti dei badge da rimisurare (metodo in testing.md, sezione Restyling).
