"use client";

import { useActionState, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { assignAction, type ActionState } from "./actions";

export type AssignTenant = { id: string; nome: string; piva: string; cf: string | null };

function matches(t: AssignTenant, piva: string | null, cf: string | null): boolean {
  if (piva && t.piva === piva) return true;
  if (cf && (t.cf?.toUpperCase() === cf.toUpperCase() || t.piva === cf)) return true;
  return false;
}

export function AssignDialog({
  id,
  tenants,
  recipient,
  supplier,
}: {
  id: string;
  tenants: AssignTenant[];
  recipient: { denominazione: string | null; piva: string | null; cf: string | null };
  supplier: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [tenantId, setTenantId] = useState("");
  const [state, action, pending] = useActionState<ActionState, FormData>(
    async (prev, fd) => {
      const res = await assignAction(prev, fd);
      if (res.ok) setOpen(false);
      return res;
    },
    { ok: false },
  );

  const sorted = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tenants
      .map((t) => ({ ...t, match: matches(t, recipient.piva, recipient.cf) }))
      .filter((t) => !q || t.nome.toLowerCase().includes(q) || t.piva.includes(q) || (t.cf ?? "").toLowerCase().includes(q))
      .sort((a, b) => Number(b.match) - Number(a.match) || a.nome.localeCompare(b.nome, "it"));
  }, [tenants, query, recipient.piva, recipient.cf]);

  const chosen = tenants.find((t) => t.id === tenantId);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          Assegna
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form action={action} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Assegna fattura</DialogTitle>
            <DialogDescription>Scegli l&apos;account a cui assegnare la fattura ricevuta.</DialogDescription>
          </DialogHeader>
          <dl className="grid gap-1 rounded-md border p-4 text-sm">
            <div className="flex flex-wrap gap-2">
              <dt className="text-muted-foreground">Intestata a</dt>
              <dd className="font-medium">{recipient.denominazione ?? "-"}</dd>
            </div>
            <div className="flex flex-wrap gap-2">
              <dt className="text-muted-foreground">Partita IVA</dt>
              <dd>{recipient.piva ?? "-"}</dd>
              <dt className="text-muted-foreground">Codice fiscale</dt>
              <dd>{recipient.cf ?? "-"}</dd>
            </div>
            <div className="flex flex-wrap gap-2">
              <dt className="text-muted-foreground">Fornitore</dt>
              <dd>{supplier}</dd>
            </div>
          </dl>
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="tenantId" value={tenantId} />
          <div className="flex flex-col gap-2">
            <Label htmlFor={`cerca-${id}`}>Cerca account</Label>
            <Input
              id={`cerca-${id}`}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Nome o Partita IVA"
              autoComplete="off"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor={`tenant-${id}`}>Account</Label>
            <Select value={tenantId} onValueChange={setTenantId}>
              <SelectTrigger id={`tenant-${id}`}>
                <SelectValue placeholder="Seleziona un account" />
              </SelectTrigger>
              <SelectContent>
                {sorted.length === 0 && <p className="px-2 py-1.5 text-sm text-muted-foreground">Nessun account trovato.</p>}
                {sorted.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.nome} - P.IVA {t.piva}
                    {t.match ? " (Corrisponde al destinatario)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {chosen && (
            <p className="text-sm text-muted-foreground">
              La fattura sarà visibile a <span className="font-medium text-foreground">{chosen.nome}</span>.
            </p>
          )}
          {state.error && (
            <Alert variant="destructive">
              <AlertDescription>{state.error}</AlertDescription>
            </Alert>
          )}
          <DialogFooter>
            <Button type="submit" disabled={pending || !tenantId}>
              {pending && <Loader2 className="animate-spin" />}
              Conferma
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
