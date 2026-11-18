# ADR 0007 - Restyling: sidebar a gruppi, palette fintech, contenuto largo (run #421)

## Contesto
La cliente ha chiesto: navigazione oggi disordinata (nove link in fila nell'header), pagine troppo strette (`max-w-3xl`), palette del riferimento fintech minimal mai applicata (tutto in scala di grigi shadcn neutral), numerazione nelle tabelle, pagine admin separate.

## Decisione
- Navigazione: sidebar fissa custom in `src/components/app-shell.tsx`, costruita con i componenti già installati (Sheet per mobile, Separator, DropdownMenu, Badge, Button). NON si installa il blocco `sidebar` di shadcn: porta con sé tooltip, hook e decine di classi `sidebar-*` per un menu di nove voci; il guadagno non vale il rischio su un restyling solo estetico.
- Struttura dei gruppi e icone: vedi design.md, sezione Sidebar. Certificati va in Amministrazione (è solo admin), non in Canale.
- Larghezza: contenitore `max-w-7xl` per le pagine dell'app; il vincolo `max-w-3xl` del vecchio design.md è superato.
- Palette: due accenti (blu #2563EB primario, smeraldo #059669 esito positivo) su fondo slate chiaro; rosso e ambra solo semantici. Codici in design.md, scritti in `globals.css` come oklch.
- Numerazione tabelle: colonna «#» calcolata in render (offset della pagina + indice + 1), nessun dato nuovo, nessuna query cambiata.

## Conseguenze
- Nessuna rotta, query, server action o API cambia. I test esistenti devono restare verdi senza modifiche.
- I selettori testuali del QA (etichette delle voci) cambiano in parte: «API» diventa «API e chiavi», «Account» diventa «Account clienti», «Canale» (admin) diventa «Configurazione SdI».
