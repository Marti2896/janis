# Design system

Stile: fintech minimal su shadcn/ui (style new-york, `components.json` in radice). Sfondo chiaro, al massimo due colori di accento usati con parsimonia, badge di stato arrotondati con fondo tenue. Decisione: ADR 0007 (run #421).

- Tipografia: Inter (`--font-inter`) per il testo, Geist Mono per codici e ID; titoli con `tracking-tight` (già applicato a h1-h3 in `globals.css`).
- Raggi: `--radius` = 0.75rem (12px); `rounded-md/lg/xl`; i badge di stato sono `rounded-full`. Ombre morbide, bordi sottili 1px.
- Colori: solo token definiti in `src/app/globals.css` (`bg-background`, `text-muted-foreground`, `border`, `bg-primary`, `bg-success`, `destructive`...), tema scuro con classe `.dark`. Mai hex a mano nel codice: i codici qui sotto sono il riferimento, in CSS si scrivono come oklch.
- Componenti: shadcn in `src/components/ui` (Alert, AlertDialog, Badge, Button, Card, Dialog, DropdownMenu, Input, Label, RadioGroup, Select, Separator, Sheet, Skeleton, Sonner, Table, Tabs, Textarea). Per aggiungerne: `npx shadcn@latest add <nome>`, poi verifica che importi `cn` da `@/lib/utils`. Prima di crearne uno custom controlla che non esista.
- Stati obbligatori: vuoto, loading (skeleton), errore, successo.
- Motion: spring brevi, rispetto di `prefers-reduced-motion`.

## Palette (run #421, accento cambiato nella run #422: ADR 0008)
Prodotto: **Janis** (prima «Interscambio»). Colore di brand: **#0B8277** (verde petrolio), valore ESATTO di `--primary` nel tema chiaro.
Due accenti: verde petrolio #0B8277 (azione, elemento attivo, stato «Inviata», brand) e verde prato (esito positivo, spostato su green 600 per non confondersi con il petrolio). Rosso e ambra sono colori SEMANTICI, usati solo per badge e avvisi di errore o attenzione, mai come decorazione.

| Token | Chiaro | Scuro | Uso |
|---|---|---|---|
| `--background` | #F8FAFC (slate 50) | #020617 | sfondo dell'app |
| `--card`, `--popover`, `--sidebar` | #FFFFFF | #0F172A | card, sidebar, menu |
| `--foreground` | #0F172A (slate 900) | #F8FAFC | testo |
| `--muted-foreground` | #64748B (slate 500) | #94A3B8 | testo secondario, etichette di gruppo |
| `--muted`, `--secondary`, `--accent` | #F1F5F9 (slate 100) | #1E293B | hover, fondi neutri, badge «In coda» |
| `--border`, `--input` | #E2E8F0 (slate 200) | #1E293B | bordi |
| `--primary` (accento 1, brand) | #0B8277 (esatto) | #2DB3A5 (petrolio schiarito, leggibile su fondo scuro) | bottoni primari, link attivi, voce attiva sidebar, icona logo, focus ring |
| `--primary-foreground` | #FFFFFF (4.7:1 su #0B8277) | #042F2B | testo su primary |
| `--success` (accento 2) | #16A34A (green 600) | #22C55E | Consegnata, Accettata, certificato valido |
| `--destructive` | #DC2626 (red 600) | #EF4444 | Scartata, Rifiutata, Errore invio, azioni distruttive |
| `--warning` | #D97706 (amber 600) | #F59E0B | Mancata consegna, Termini scaduti, Esito incerto, certificato in scadenza |
| `--ring` | #0B8277 | #2DB3A5 | focus |

Badge di stato (`StatusBadge`): `rounded-full`, fondo del colore al 10-15% e testo nel colore pieno (scuro abbastanza per contrasto AA), niente bordo pieno.
- neutro (muted): In coda, Invio in corso, Sostituita
- verde petrolio (primary): Inviata
- verde (success): Consegnata, Accettata
- rosso (destructive): Scartata, Rifiutata, Errore invio
- ambra (warning): Mancata consegna, Termini scaduti, Esito incerto

Testo dei badge tenui (token «ink», contrasto AA 4.5:1 misurato sul fondo composto; triage it.1 run #421, issue #131-#133). Il colore pieno NON va usato come testo a 12px.

| Token | Chiaro | Scuro | Variante Badge |
|---|---|---|---|
| `--neutral-ink` | #475569 (slate 600) | #CBD5E1 (slate 300) | `neutral` = `bg-muted text-neutral-ink` |
| `--info-ink` | #076A61 circa (petrolio scuro) | #5EEAD4 circa (teal 300) | `info` = `bg-primary/10 text-info-ink` |
| `--success-ink` | #166534 (green 800; green 700 #15803D misurava 4,49:1 su success/10, issue #138) | #86EFAC circa (green 300) | `success-soft` |
| `--warning-ink` | #B45309 circa (amber 700) | #FDE047 circa | `warning` |
| `--destructive-ink` | #B91C1C circa (red 700) | #FCA5A5 circa | `danger` |

`--muted-foreground` resta slate 500 per testo secondario normale (non per i badge). Il badge «Valido» in /certificati usa `success-soft`, non `success` pieno (bianco su emerald 600 = 3.66:1, non passa).

## Layout (run #421)
- Shell: sidebar fissa a sinistra larga 16rem (`w-64`) da `md` in su, fondo `bg-card` con bordo destro; sotto `md` barra superiore con hamburger che apre la stessa navigazione in un `Sheet` da sinistra.
- Contenuto: colonna a destra della sidebar, contenitore `mx-auto w-full max-w-7xl px-6 py-10 lg:px-10` per tutte le pagine dell'app (liste, dashboard, dettagli, Nuova fattura). Restano strette (`max-w-3xl` o meno) solo login, cambia password, errore, accesso negato, non trovato.
- Tabelle: prima colonna «#» con numerazione progressiva (`w-12 text-muted-foreground tabular-nums`), che continua tra le pagine (offset + indice + 1).

## Sidebar (run #421)
Logo «Janis» (icona Network in `text-primary`) in alto, gruppi con etichetta piccola maiuscola `text-muted-foreground`, voce attiva `bg-primary/10 text-primary font-medium`, hover `bg-accent`. In fondo: email, badge ruolo, menu utente con «Esci».

| Gruppo | Voce | Rotta | Icona lucide |
|---|---|---|---|
| Fatture | Fatture emesse | /fatture | FileText |
| Fatture | Fatture ricevute | /ricevute | Inbox |
| Fatture | Nuova fattura | /fatture/nuova | FilePlus2 |
| Canale | Stato canale | /stato | Activity |
| Canale | API e chiavi | /api | KeyRound |
| Audit | Cronologia attività | /audit | ScrollText |
| Amministrazione (solo admin, dopo un Separator) | Account clienti | /admin/account | Users |
| Amministrazione | Configurazione SdI | /admin/canale | Settings2 |
| Amministrazione | Certificati | /certificati | ShieldCheck |

Con `mustChangePassword` la sidebar non mostra voci (solo logo e menu utente), come prima.
