"use client";

import { startTransition, useActionState, useState } from "react";
import { AlertCircle, Loader2, Plus, Send, Trash2 } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { NATURE_OPTIONS } from "@/lib/nature-iva";
import type { InvoicePrefill } from "@/lib/server-api";
import { createInvoiceAction, validateInvoiceAction, type NewInvoiceState } from "./actions";

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="text-sm text-destructive">{message}</p>;
}

interface Props {
  idempotencyKey: string;
  today: string;
  role: "admin" | "cliente";
  tenants: {
    id: string;
    denominazione: string;
    partitaIva: string;
    indirizzo: string | null;
    cap: string | null;
    comune: string | null;
    provincia: string | null;
  }[];
  /** Dati della fattura scartata da rifare (stesso numero e stessa data). */
  prefill?: InvoicePrefill;
}

function sedeText(t: Props["tenants"][number] | undefined): string {
  if (!t?.indirizzo || !t.cap || !t.comune) return "Indirizzo non ancora indicato";
  return `${t.indirizzo}, ${t.cap} ${t.comune}${t.provincia ? ` (${t.provincia})` : ""}`;
}

interface Row {
  id: number;
  quantita: string;
  prezzo: string;
  aliquota: string;
  descrizione: string;
  natura: string;
}

const eur = new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" });

function parseNum(v: string): number {
  const n = Number(v.replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

/** Importi in centesimi per riga: arrotondamento per riga, come nel file XML. */
function totals(rows: { quantita: string; prezzo: string; aliquota: string }[]) {
  let imponibile = 0;
  let iva = 0;
  for (const r of rows) {
    const base = Math.round(parseNum(r.quantita) * parseNum(r.prezzo) * 100);
    imponibile += base;
    iva += Math.round((base * parseNum(r.aliquota)) / 100);
  }
  return { imponibile: imponibile / 100, iva: iva / 100, totale: (imponibile + iva) / 100 };
}

const TIPI: Record<string, string> = { TD01: "Fattura (TD01)", TD04: "Nota di credito (TD04)" };
const FORMATI: Record<string, string> = { FPR12: "Privati e aziende (FPR12)", FPA12: "Pubblica amministrazione (FPA12)" };

export function InvoiceForm({ idempotencyKey, today, role, tenants, prefill }: Props) {
  const [state, action, pending] = useActionState<NewInvoiceState, FormData>(
    async (prev, fd) => {
      try {
        return await createInvoiceAction(prev, fd);
      } catch (err) {
        // Il redirect del server arriva come eccezione di controllo del framework: va rilanciato.
        if (err && typeof err === "object" && "digest" in err) throw err;
        return {
          fieldErrors: {},
          error: "Errore di comunicazione con il server. Riprova: i dati inseriti sono ancora nel modulo.",
        };
      }
    },
    { fieldErrors: {}, error: null },
  );
  const [rows, setRows] = useState<Row[]>(
    prefill && prefill.righe.length
      ? prefill.righe.map((r, i) => ({ id: i, quantita: r.quantita, prezzo: r.prezzo, aliquota: r.aliquota, descrizione: r.descrizione, natura: r.natura }))
      : [{ id: 0, quantita: "1", prezzo: "", aliquota: "22", descrizione: "", natura: "" }],
  );
  const [nextId, setNextId] = useState(prefill?.righe.length || 1);
  const [destTipo, setDestTipo] = useState<string>(prefill?.destTipo ?? "codice");
  const [summary, setSummary] = useState<FormData | null>(null);
  const [pre, setPre] = useState<Record<string, string>>({});
  const [checking, setChecking] = useState(false);
  const [tenantSel, setTenantSel] = useState(prefill?.tenantId ?? "");
  const e = Object.keys(pre).length ? pre : state.fieldErrors;
  const tot = totals(rows);
  const cedente = role === "admin" ? tenants.find((t) => t.id === tenantSel) : tenants[0];

  function patchRow(id: number, patch: Partial<Row>) {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  function onSubmit(ev: React.FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    if (pending || checking) return;
    const fd = new FormData(ev.currentTarget);
    fd.set("righe.count", String(rows.length));
    setChecking(true);
    validateInvoiceAction(fd)
      .then((res) => {
        setPre(res.fieldErrors);
        if (Object.keys(res.fieldErrors).length === 0 && !res.error) setSummary(fd);
      })
      .catch(() => setSummary(fd))
      .finally(() => setChecking(false));
  }

  function confirmSend() {
    if (!summary || pending) return;
    const fd = summary;
    setSummary(null);
    setPre({});
    startTransition(() => action(fd));
  }

  const sv = (k: string) => String(summary?.get(k) ?? "");
  const summaryRows = summary
    ? rows.map((r, i) => ({
        descrizione: sv(`righe.${i}.descrizione`),
        quantita: sv(`righe.${i}.quantita`),
        prezzo: sv(`righe.${i}.prezzoUnitario`),
        aliquota: sv(`righe.${i}.aliquota`),
      }))
    : [];

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6" noValidate>
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      {prefill && <input type="hidden" name="replacesId" value={prefill.replacesId} />}

      {prefill && (
        <Alert variant="warning">
          <AlertCircle />
          <AlertTitle>Stai rifacendo la fattura {prefill.numero}, scartata dal Sistema di Interscambio</AlertTitle>
          <AlertDescription>
            {prefill.motivo.length > 0 && (
              <ul className="list-disc pl-5">
                {prefill.motivo.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            )}
            <p>Correggi i dati: la nuova fattura avrà lo stesso numero e la stessa data della fattura scartata.</p>
          </AlertDescription>
        </Alert>
      )}

      {state.error && (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>Impossibile inviare la fattura</AlertTitle>
          <AlertDescription>
            <p>{state.error}</p>
            <Button type="submit" variant="outline" size="sm" className="mt-2" disabled={pending}>
              Riprova
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Cedente</CardTitle>
          <CardDescription>Il cedente è il tuo account e non si può modificare.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {role === "admin" ? (
            <>
              <Label htmlFor="tenantId">Account</Label>
              <Select name="tenantId" value={tenantSel} onValueChange={setTenantSel}>
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
          ) : null}
          {cedente && (
            <dl className="grid gap-1 text-sm" data-testid="cedente">
              <div className="flex flex-wrap gap-2">
                <dt className="text-muted-foreground">Denominazione</dt>
                <dd className="font-medium">{cedente.denominazione}</dd>
              </div>
              <div className="flex flex-wrap gap-2">
                <dt className="text-muted-foreground">Partita IVA</dt>
                <dd className="font-mono">{cedente.partitaIva}</dd>
              </div>
              <div className="flex flex-wrap gap-2">
                <dt className="text-muted-foreground">Sede</dt>
                <dd>{sedeText(cedente)}</dd>
              </div>
            </dl>
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
            <Input id="denominazione" name="cessionario.denominazione" defaultValue={prefill?.denominazione} aria-invalid={e["cessionario.denominazione"] ? true : undefined} />
            <FieldError message={e["cessionario.denominazione"]} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="piva">Partita IVA</Label>
            <Input id="piva" name="cessionario.partitaIva" inputMode="numeric" defaultValue={prefill?.partitaIva} aria-invalid={e["cessionario.partitaIva"] ? true : undefined} />
            <FieldError message={e["cessionario.partitaIva"]} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="cf">Codice fiscale</Label>
            <Input id="cf" name="cessionario.codiceFiscale" defaultValue={prefill?.codiceFiscale} aria-invalid={e["cessionario.codiceFiscale"] ? true : undefined} />
            <FieldError message={e["cessionario.codiceFiscale"]} />
          </div>
          <p className="text-sm text-muted-foreground sm:col-span-2">
            Inserisci la Partita IVA oppure, per un privato, solo il codice fiscale. Per un privato usa il codice destinatario 0000000 o la PEC.
          </p>
          <div className="flex flex-col gap-2 sm:col-span-2">
            <Label htmlFor="indirizzo">Indirizzo</Label>
            <Input id="indirizzo" name="cessionario.indirizzo" autoComplete="off" defaultValue={prefill?.indirizzo} aria-invalid={e["cessionario.indirizzo"] ? true : undefined} />
            <FieldError message={e["cessionario.indirizzo"]} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="cap">CAP</Label>
            <Input id="cap" name="cessionario.cap" inputMode="numeric" maxLength={5} defaultValue={prefill?.cap} aria-invalid={e["cessionario.cap"] ? true : undefined} />
            <FieldError message={e["cessionario.cap"]} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="comune">Comune</Label>
            <Input id="comune" name="cessionario.comune" defaultValue={prefill?.comune} aria-invalid={e["cessionario.comune"] ? true : undefined} />
            <FieldError message={e["cessionario.comune"]} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="provincia">Provincia (sigla, opzionale)</Label>
            <Input id="provincia" name="cessionario.provincia" maxLength={2} placeholder="MI" defaultValue={prefill?.provincia} aria-invalid={e["cessionario.provincia"] ? true : undefined} />
            <FieldError message={e["cessionario.provincia"]} />
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
              defaultValue={prefill?.destValore}
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
          <CardDescription>Il numero fattura è assegnato dal sistema al momento dell&apos;invio.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <div className="flex flex-col gap-2">
            <Label htmlFor="tipoDocumento">Tipo documento</Label>
            <Select name="tipoDocumento" defaultValue={prefill?.tipoDocumento ?? "TD01"}>
              <SelectTrigger id="tipoDocumento" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(TIPI).map(([v, l]) => (
                  <SelectItem key={v} value={v}>
                    {l}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldError message={e["tipoDocumento"]} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="formato">Formato</Label>
            <Select name="formato" defaultValue={prefill?.formato ?? "FPR12"}>
              <SelectTrigger id="formato" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(FORMATI).map(([v, l]) => (
                  <SelectItem key={v} value={v}>
                    {l}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldError message={e["formato"]} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="data">Data fattura</Label>
            <Input
              id="data"
              name="data"
              type="date"
              defaultValue={prefill?.data ?? today}
              readOnly={Boolean(prefill)}
              aria-invalid={e["data"] ? true : undefined}
            />
            <FieldError message={e["data"]} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Righe</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          {rows.map((row, i) => (
            <div key={row.id} className="grid gap-4 border-b pb-6 last:border-b-0 last:pb-0 sm:grid-cols-6">
              <div className="flex flex-col gap-2 sm:col-span-6">
                <Label htmlFor={`desc-${row.id}`}>Descrizione</Label>
                <Input id={`desc-${row.id}`} name={`righe.${i}.descrizione`} defaultValue={row.descrizione} aria-invalid={e[`righe.${i}.descrizione`] ? true : undefined} />
                <FieldError message={e[`righe.${i}.descrizione`]} />
              </div>
              <div className="flex flex-col gap-2 sm:col-span-2">
                <Label htmlFor={`qta-${row.id}`}>Quantità</Label>
                <Input
                  id={`qta-${row.id}`}
                  name={`righe.${i}.quantita`}
                  inputMode="decimal"
                  value={row.quantita}
                  onChange={(ev) => patchRow(row.id, { quantita: ev.target.value })}
                  aria-invalid={e[`righe.${i}.quantita`] ? true : undefined}
                />
                <FieldError message={e[`righe.${i}.quantita`]} />
              </div>
              <div className="flex flex-col gap-2 sm:col-span-2">
                <Label htmlFor={`prz-${row.id}`}>Prezzo unitario (EUR)</Label>
                <Input
                  id={`prz-${row.id}`}
                  name={`righe.${i}.prezzoUnitario`}
                  inputMode="decimal"
                  value={row.prezzo}
                  onChange={(ev) => patchRow(row.id, { prezzo: ev.target.value })}
                  aria-invalid={e[`righe.${i}.prezzoUnitario`] ? true : undefined}
                />
                <FieldError message={e[`righe.${i}.prezzoUnitario`]} />
              </div>
              <div className="flex flex-col gap-2 sm:col-span-2">
                <Label htmlFor={`iva-${row.id}`}>Aliquota IVA</Label>
                <Select name={`righe.${i}.aliquota`} value={row.aliquota} onValueChange={(v) => patchRow(row.id, { aliquota: v })}>
                  <SelectTrigger id={`iva-${row.id}`} className="w-full">
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
              {row.aliquota === "0" && (
                <div className="flex flex-col gap-2 sm:col-span-6">
                  <Label htmlFor={`nat-${row.id}`}>Motivo dell&apos;esenzione</Label>
                  <Select name={`righe.${i}.natura`} defaultValue={row.natura || undefined}>
                    <SelectTrigger id={`nat-${row.id}`} className="w-full" aria-invalid={e[`righe.${i}.natura`] ? true : undefined}>
                      <SelectValue placeholder="Scegli il motivo" />
                    </SelectTrigger>
                    <SelectContent>
                      {NATURE_OPTIONS.map((n) => (
                        <SelectItem key={n.value} value={n.value}>
                          {n.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FieldError message={e[`righe.${i}.natura`]} />
                </div>
              )}
              {rows.length > 1 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="w-fit sm:col-span-6"
                  onClick={() => setRows((rs) => rs.filter((x) => x.id !== row.id))}
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
              setRows((rs) => [...rs, { id: nextId, quantita: "1", prezzo: "", aliquota: "22", descrizione: "", natura: "" }]);
              setNextId((n) => n + 1);
            }}
          >
            <Plus />
            Aggiungi riga
          </Button>
          <dl className="flex flex-col gap-1 rounded-md border bg-muted/40 p-4 text-sm" aria-live="polite">
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Imponibile</dt>
              <dd>{eur.format(tot.imponibile)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">IVA</dt>
              <dd>{eur.format(tot.iva)}</dd>
            </div>
            <div className="flex justify-between gap-4 text-base font-semibold">
              <dt>Totale documento</dt>
              <dd>{eur.format(tot.totale)}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <Button type="submit" disabled={pending} className="w-fit">
        {pending ? <Loader2 className="animate-spin" /> : <Send />}
        {pending ? "Invio in corso…" : "Crea e invia"}
      </Button>

      <Dialog open={summary !== null} onOpenChange={(o) => !o && setSummary(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Controlla prima di inviare</DialogTitle>
            <DialogDescription>
              Dopo l&apos;invio la fattura non si può modificare: per correggerla servirà una nota di credito.
            </DialogDescription>
          </DialogHeader>
          <dl className="grid gap-2 text-sm sm:grid-cols-[auto_1fr]">
            <dt className="text-muted-foreground">Cliente</dt>
            <dd>
              {sv("cessionario.denominazione")}
              {sv("cessionario.partitaIva") ? ` (P.IVA ${sv("cessionario.partitaIva")})` : ""}
              {!sv("cessionario.partitaIva") && sv("cessionario.codiceFiscale") ? ` (CF ${sv("cessionario.codiceFiscale")})` : ""}
            </dd>
            <dt className="text-muted-foreground">{sv("destinazione.tipo") === "pec" ? "PEC" : "Codice destinatario"}</dt>
            <dd>{sv("destinazione.valore")}</dd>
            <dt className="text-muted-foreground">Documento</dt>
            <dd>
              {TIPI[sv("tipoDocumento")] ?? sv("tipoDocumento")} del {sv("data").split("-").reverse().join("/")}
            </dd>
          </dl>
          <div className="max-w-full overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Descrizione</TableHead>
                  <TableHead className="text-right">Quantità</TableHead>
                  <TableHead className="text-right">Prezzo</TableHead>
                  <TableHead className="text-right">IVA</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summaryRows.map((r, i) => (
                  <TableRow key={i}>
                    <TableCell>{r.descrizione}</TableCell>
                    <TableCell className="text-right whitespace-nowrap">{r.quantita}</TableCell>
                    <TableCell className="text-right whitespace-nowrap">{eur.format(parseNum(r.prezzo))}</TableCell>
                    <TableCell className="text-right whitespace-nowrap">{r.aliquota}%</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <p className="text-right text-base font-semibold">Totale documento: {eur.format(tot.totale)}</p>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setSummary(null)}>
              Torna a modificare
            </Button>
            <Button type="button" onClick={confirmSend} disabled={pending}>
              <Send />
              Conferma e invia
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </form>
  );
}
