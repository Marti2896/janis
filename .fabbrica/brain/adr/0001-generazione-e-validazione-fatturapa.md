# ADR 0001 - Generazione e validazione FatturaPA

Stato: accettata (run #405)

## Decisione
- Generazione XML con `xmlbuilder2` (già indicato in business-rules) a partire da un modello TypeScript tipizzato del documento (`server/fatturapa/`).
- Validazione XSD con `xmllint-wasm` (libxml2 compilato in WebAssembly): nessun binding nativo, funziona su Node 24 e in CI senza toolchain C.
- Gli XSD ufficiali (schema FatturaPA nella versione oggi pubblicata su fatturapa.gov.it, più `xmldsig-core-schema.xsd` che importa) sono versionati in `server/fatturapa/xsd/` con un README che riporta URL di origine, versione e SHA-256. Sono documenti pubblici, non segreti. Le validazioni non scaricano nulla a runtime.
- Importi formattati come stringhe decimali con 2 cifre (8 per prezzi unitari dove ammesso): niente aritmetica float sui totali, si usano interi in centesimi.

## Alternative scartate
- `libxmljs2`: binding nativo, problemi ricorrenti di build su Node recenti.
- Validazione solo "a mano" senza XSD: viola la regola non negoziabile.
