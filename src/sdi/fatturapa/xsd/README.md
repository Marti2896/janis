# XSD FatturaPA FPR12

Fonti ufficiali, scaricate il 2026-11-17 (versione schema 1.2.2, quella oggi pubblicata):

- `Schema_del_file_xml_FatturaPA_v1.2.2.xsd`
  - Origine: https://www.fatturapa.gov.it/export/documenti/fatturapa/v1.2.2/Schema_del_file_xml_FatturaPA_v1.2.2.xsd
  - SHA-256 originale: `cedaeece91d7a5334960143f0735ee020e6e94f33685b512f5899eb85c507e18`
  - Unica modifica: `schemaLocation` dell'import xmldsig reso locale (`xmldsig-core-schema.xsd`) per validare senza rete.
  - SHA-256 della copia versionata: `b5b203619a5b4d136904491ddd008a23be91badaba97237c78cacd67a30bdec4`
- `xmldsig-core-schema.xsd`
  - Origine: https://www.w3.org/TR/2002/REC-xmldsig-core-20020212/xmldsig-core-schema.xsd (non modificato)
  - SHA-256: `35cf8197da812c85e40d57891b35c94187569ed474a2dac813ce5090dafcd35c`

Lo schema ammette CodiceDestinatario di 6 o 7 caratteri (6 vale per la PA, FPA12); per FPR12 il
controllo dei 7 caratteri e in `validate.ts`.
