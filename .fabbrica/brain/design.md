# Design system

Stile: Apple moderno + shadcn/ui (style new-york, base neutral, `components.json` in radice).

- Tipografia: Inter (`--font-inter`) per il testo, Geist Mono per codici/ID; titoli con `tracking-tight` (già applicato a h1–h3 in `globals.css`).
- Raggi: `--radius` = 0.75rem (12px); usa `rounded-md/lg/xl`. Ombre morbide, bordi sottili 1px.
- Colori: solo token (`bg-background`, `text-muted-foreground`, `border`, `bg-primary`, `destructive`…) definiti in `src/app/globals.css`, con tema scuro tramite classe `.dark`. Mai hex a mano.
- Componenti: shadcn in `src/components/ui` (oggi Button, Card, Badge). Per aggiungerne: `npx shadcn@latest add <nome>`, poi verifica che importi `cn` da `@/lib/utils`. Prima di crearne uno custom controlla che non esista.
- Layout pagina: `main` centrato `max-w-3xl`, `px-6 py-16`, griglia di Card con `gap-4`.
- Stati obbligatori: vuoto, loading (skeleton), errore, successo.
- Motion: spring brevi, rispetto di `prefers-reduced-motion`.
