"use server";

import { redirect } from "next/navigation";
import { createAndSendInvoice, type NewInvoiceInput } from "@/lib/server-api";
import { requireSession } from "@/lib/session";
import { NATURE_VALUES } from "@/lib/nature-iva";

export interface NewInvoiceState {
  /** Chiave: nome del campo (es. cessionario.partitaIva, righe.0.descrizione). */
  fieldErrors: Record<string, string>;
  error: string | null;
}

const ALIQUOTE = [22, 10, 4, 0];

function str(fd: FormData, key: string): string {
  return String(fd.get(key) ?? "").trim();
}

function num(value: string): number {
  return Number(value.replace(",", "."));
}

/** Solo controlli sui campi (nessuna fattura creata): serve ad aprire il riepilogo solo quando il form è valido. */
export async function validateInvoiceAction(formData: FormData): Promise<NewInvoiceState> {
  return runInvoiceAction(formData, true);
}

export async function createInvoiceAction(_prev: NewInvoiceState, formData: FormData): Promise<NewInvoiceState> {
  return runInvoiceAction(formData, false);
}

async function runInvoiceAction(formData: FormData, validateOnly: boolean): Promise<NewInvoiceState> {
  const { user, scope } = await requireSession("/fatture/nuova");
  const errors: Record<string, string> = {};

  const tenantId = str(formData, "tenantId");
  if (user.role === "admin" && !tenantId) errors["tenantId"] = "Seleziona l'account che emette la fattura";

  const denominazione = str(formData, "cessionario.denominazione");
  if (!denominazione) errors["cessionario.denominazione"] = "La denominazione è obbligatoria";

  const indirizzo = str(formData, "cessionario.indirizzo");
  if (!indirizzo) errors["cessionario.indirizzo"] = "L'indirizzo è obbligatorio";
  const cap = str(formData, "cessionario.cap");
  if (!/^\d{5}$/.test(cap)) errors["cessionario.cap"] = "Il CAP deve avere 5 cifre";
  const comune = str(formData, "cessionario.comune");
  if (!comune) errors["cessionario.comune"] = "Il comune è obbligatorio";
  const provincia = str(formData, "cessionario.provincia").toUpperCase();
  if (provincia && !/^[A-Z]{2}$/.test(provincia)) errors["cessionario.provincia"] = "La provincia deve avere 2 lettere (es. MI)";

  const partitaIva = str(formData, "cessionario.partitaIva");
  const codiceFiscale = str(formData, "cessionario.codiceFiscale").toUpperCase();
  if (!partitaIva && !codiceFiscale) errors["cessionario.partitaIva"] = "Inserisci la Partita IVA o il codice fiscale";
  else if (partitaIva && !/^\d{11}$/.test(partitaIva)) errors["cessionario.partitaIva"] = "La partita IVA deve avere 11 cifre";
  if (codiceFiscale &&!/^(\d{11}|[A-Z0-9]{16})$/.test(codiceFiscale)) {
    errors["cessionario.codiceFiscale"] = "Il codice fiscale deve avere 11 cifre o 16 caratteri";
  }

  const tipoDest = str(formData, "destinazione.tipo") === "pec" ? "pec" : "codice";
  const valoreDest = str(formData, "destinazione.valore");
  if (tipoDest === "codice") {
    if (!/^[A-Za-z0-9]{7}$/.test(valoreDest)) errors["destinazione.valore"] = "Il codice destinatario deve avere 7 caratteri";
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(valoreDest)) {
    errors["destinazione.valore"] = "Inserisci un indirizzo PEC valido";
  }

  const tipoDocumento = str(formData, "tipoDocumento");
  if (tipoDocumento !== "TD01" && tipoDocumento !== "TD04") errors["tipoDocumento"] = "Seleziona il tipo documento";
  const formato = str(formData, "formato");
  if (formato !== "FPR12" && formato !== "FPA12") errors["formato"] = "Seleziona il formato";

  const data = str(formData, "data");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || Number.isNaN(new Date(data).getTime())) {
    errors["data"] = "Inserisci una data valida";
  }

  const righe: NewInvoiceInput["righe"] = [];
  const count = Number(str(formData, "righe.count")) || 0;
  for (let i = 0; i < Math.min(count, 100); i++) {
    const descrizione = str(formData, `righe.${i}.descrizione`);
    const quantita = num(str(formData, `righe.${i}.quantita`));
    const prezzoRaw = str(formData, `righe.${i}.prezzoUnitario`);
    const prezzoUnitario = num(prezzoRaw);
    const aliquota = num(str(formData, `righe.${i}.aliquota`));
    const natura = str(formData, `righe.${i}.natura`);
    if (!descrizione) errors[`righe.${i}.descrizione`] = "La descrizione è obbligatoria";
    else if (descrizione.length > 1000) errors[`righe.${i}.descrizione`] = "La descrizione supera il limite di 1000 caratteri";
    if (!Number.isFinite(quantita) || quantita <= 0) errors[`righe.${i}.quantita`] = "La quantità deve essere maggiore di zero";
    if (!prezzoRaw) errors[`righe.${i}.prezzoUnitario`] = "Inserisci il prezzo (anche 0)";
    else if (!Number.isFinite(prezzoUnitario) || prezzoUnitario < 0) errors[`righe.${i}.prezzoUnitario`] = "Prezzo non valido";
    if (!ALIQUOTE.includes(aliquota)) errors[`righe.${i}.aliquota`] = "Aliquota non valida";
    if (aliquota === 0 && !NATURE_VALUES.includes(natura)) errors[`righe.${i}.natura`] = "Indica il motivo dell'esenzione";
    righe.push({ descrizione, quantita, prezzoUnitario, aliquota, ...(aliquota === 0 ? { natura } : {}) });
  }
  if (righe.length === 0) return { fieldErrors: errors, error: "Aggiungi almeno una riga." };
  if (validateOnly && Object.keys(errors).length > 0) return { fieldErrors: errors, error: null };

  if (Object.keys(errors).length > 0) return { fieldErrors: errors, error: null };
  if (validateOnly) return { fieldErrors: {}, error: null };

  const idempotencyKey = str(formData, "idempotencyKey");
  const replacesId = str(formData, "replacesId");
  let result: Awaited<ReturnType<typeof createAndSendInvoice>>;
  try {
    result = await createAndSendInvoice(scope, {
    tenantId: user.role === "admin" ? tenantId : undefined,
    idempotencyKey,
    cessionario: { denominazione, partitaIva, codiceFiscale: codiceFiscale || undefined, sede: { indirizzo, cap, comune, ...(provincia ? { provincia } : {}) } },
    destinazione: { tipo: tipoDest, valore: tipoDest === "codice" ? valoreDest.toUpperCase() : valoreDest },
    tipoDocumento: tipoDocumento as "TD01" | "TD04",
    formato: formato as "FPR12" | "FPA12",
    data,
    righe,
    }, replacesId || undefined);
  } catch (err) {
    console.error("createInvoiceAction", err);
    return { fieldErrors: {}, error: "Errore imprevisto durante l'invio. Riprova: i dati inseriti sono ancora nel modulo." };
  }

  if (!result.ok) {
    if (result.path === "descrizione" || result.path?.startsWith("righe")) return { fieldErrors: {}, error: result.error };
    if (result.path && !result.path.startsWith("_")) return { fieldErrors: {}, error: `${result.error} (campo: ${result.path})` };
    return { fieldErrors: {}, error: result.error };
  }
  redirect(`/fatture/${result.invoiceId}${result.queued ? "?coda=1" : ""}`);
}
