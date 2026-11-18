"use client";

import { startTransition, useActionState, useState } from "react";
import { AlertCircle, Loader2, Plus, Send, Trash2 } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createInvoiceAction, type NewInvoiceState } from "./actions";

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="text-sm text-destructive">{message}</p>;
}

interface Props {
  idempotencyKey: string;
  today: string;
  role: "admin" | "cliente";
  tenants: { id: string; denominazione: string }[];
}

export function InvoiceForm({ idempotencyKey, today, role, tenants }: Props) {
  const [state, action, pending] = useActionState<NewInvoiceState, FormData>(createInvoiceAction, {
    fieldErrors: {},
    error: null,
  });
  const [rowIds, setRowIds] = useState<number[]>([0]);
  const [nextId, setNextId] = useState(1);
  const [destTipo, setDestTipo] = useState("codice");
  const e = state.fieldErrors;

  function onSubmit(ev: React.FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    if (pending) return;
    const fd = new FormData(ev.currentTarget);
    fd.set("righe.count", String(rowIds.length));
    startTransition(() => action(fd));
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6" noValidate>
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />

      {state.error && (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>Impossibile inviare la fattura</AlertTitle>
          <AlertDescription>
            <p>{state.error}</p>
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Cedente</CardTitle>
          <CardDescription>Il cedente e il tuo account e non si puo modificare.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {role === "admin" ? (
            <>
              <Label htmlFor="tenantId">Account</Label>
              <Select name="tenantId">
                <SelectTrigger id="tenantId" className="w-full" aria-invalid={e["tenantId"] ? true : undefined}>
                  <SelectValue placeholder="Seleziona un account" />
                </SelectTrigger>
                <SelectContent>
                  {tenants.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.denominazione}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldError message={e["tenantId"]} />
            </>
          ) : (
            <>
              <Label htmlFor="cedente">Denominazione</Label>
              <Input id="cedente" value={tenants[0]?.denominazione ?? ""} readOnly disabled />
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Cessionario</CardTitle>
          <CardDescription>Dati del cliente a cui emetti la fattura.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2 sm:col-span-2">
            <Label htmlFor="denominazione">Denominazione</Label>
            <Input id="denominazione" name="cessionario.denominazione" aria-invalid={e["cessionario.denominazione"] ? true : undefined} />
            <FieldError message={e["cessionario.denominazione"]} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="piva">Partita IVA</Label>
            <Input id="piva" name="cessionario.partitaIva" inputMode="numeric" aria-invalid={e["cessionario.partitaIva"] ? true : undefined} />
            <FieldError message={e["cessionario.partitaIva"]} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="cf">Codice fiscale (opzionale)</Label>
            <Input id="cf" name="cessionario.codiceFiscale" aria-invalid={e["cessionario.codiceFiscale"] ? true : undefined} />
            <FieldError message={e["cessionario.codiceFiscale"]} />
          </div>
          <div className="flex flex-col gap-3 sm:col-span-2">
            <Label>Destinazione</Label>
            <RadioGroup name="destinazione.tipo" value={destTipo} onValueChange={setDestTipo} className="flex gap-6">
              <div className="flex items-center gap-2">
                <RadioGroupItem value="codice" id="dest-codice" />
                <Label htmlFor="dest-codice">Codice destinatario</Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="pec" id="dest-pec" />
                <Label htmlFor="dest-pec">PEC</Label>
              </div>
            </RadioGroup>
            <Input
              name="destinazione.valore"
              aria-label={destTipo === "pec" ? "Indirizzo PEC" : "Codice destinatario"}
              placeholder={destTipo === "pec" ? "nome@pec.esempio.it" : "7 caratteri"}
              aria-invalid={e["destinazione.valore"] ? true : undefined}
            />
            <FieldError message={e["destinazione.valore"]} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Documento</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <div className="flex flex-col gap-2">
            <Label htmlFor="tipoDocumento">Tipo documento</Label>
            <Select name="tipoDocumento" defaultValue="TD01">
              <SelectTrigger id="tipoDocumento" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="TD01">TD01 Fattura</SelectItem>
                <SelectItem value="TD04">TD04 Nota di credito</SelectItem>
              </SelectContent>
            </Select>
            <FieldError message={e["tipoDocumento"]} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="formato">Formato</Label>
            <Select name="formato" defaultValue="FPR12">
              <SelectTrigger id="formato" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="FPR12">FPR12 Privati</SelectItem>
                <SelectItem value="FPA12">FPA12 Pubblica amministrazione</SelectItem>
              </SelectContent>
            </Select>
            <FieldError message={e["formato"]} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="data">Data fattura</Label>
            <Input id="data" name="data" type="date" defaultValue={today} aria-invalid={e["data"] ? true : undefined} />
            <FieldError message={e["data"]} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Righe</CardTitle>
          <CardDescription>Il numero fattura e assegnato dal sistema.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          {rowIds.map((id, i) => (
            <div key={id} className="grid gap-4 border-b pb-6 last:border-b-0 last:pb-0 sm:grid-cols-6">
              <div className="flex flex-col gap-2 sm:col-span-6">
                <Label htmlFor={`desc-${id}`}>Descrizione</Label>
                <Input id={`desc-${id}`} name={`righe.${i}.descrizione`} aria-invalid={e[`righe.${i}.descrizione`] ? true : undefined} />
                <FieldError message={e[`righe.${i}.descrizione`]} />
              </div>
              <div className="flex flex-col gap-2 sm:col-span-2">
                <Label htmlFor={`qta-${id}`}>Quantita</Label>
                <Input id={`qta-${id}`} name={`righe.${i}.quantita`} inputMode="decimal" defaultValue="1" aria-invalid={e[`righe.${i}.quantita`] ? true : undefined} />
                <FieldError message={e[`righe.${i}.quantita`]} />
              </div>
              <div className="flex flex-col gap-2 sm:col-span-2">
                <Label htmlFor={`prz-${id}`}>Prezzo unitario (EUR)</Label>
                <Input id={`prz-${id}`} name={`righe.${i}.prezzoUnitario`} inputMode="decimal" aria-invalid={e[`righe.${i}.prezzoUnitario`] ? true : undefined} />
                <FieldError message={e[`righe.${i}.prezzoUnitario`]} />
              </div>
              <div className="flex flex-col gap-2 sm:col-span-2">
                <Label htmlFor={`iva-${id}`}>Aliquota IVA</Label>
                <Select name={`righe.${i}.aliquota`} defaultValue="22">
                  <SelectTrigger id={`iva-${id}`} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {["22", "10", "4", "0"].map((a) => (
                      <SelectItem key={a} value={a}>
                        {a}%
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldError message={e[`righe.${i}.aliquota`]} />
              </div>
              {rowIds.length > 1 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="w-fit sm:col-span-6"
                  onClick={() => setRowIds((ids) => ids.filter((x) => x !== id))}
                >
                  <Trash2 />
                  Rimuovi riga
                </Button>
              )}
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            className="w-fit"
            onClick={() => {
              setRowIds((ids) => [...ids, nextId]);
              setNextId((n) => n + 1);
            }}
          >
            <Plus />
            Aggiungi riga
          </Button>
        </CardContent>
      </Card>

      <Button type="submit" disabled={pending} className="w-fit">
        {pending ? <Loader2 className="animate-spin" /> : <Send />}
        {pending ? "Invio in corso…" : "Crea e invia"}
      </Button>
    </form>
  );
}
