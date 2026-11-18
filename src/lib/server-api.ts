/**
 * Adattatore unico tra le pagine di questa corsia e i moduli server scritti
 * dalle altre corsie (auth, repository, servizio fatture, tenant). Le pagine
 * non importano mai direttamente `@/server/*`: se un contratto cambia si
 * corregge qui, in un solo punto.
 */
import * as authModule from "@/server/auth";
import * as invoiceServiceModule from "@/server/invoice-service";
import * as tenantsModule from "@/server/tenants";

export const SESSION_COOKIE = "interscambio_session";

export type Role = "admin" | "cliente";

export interface SessionUser {
  id: string;
  email: string;
  role: Role;
  tenantId: string | null;
  mustChangePassword?: boolean;
}

export type Scope = { role: "admin" } | { role: "cliente"; tenantId: string };

export function toScope(user: SessionUser): Scope {
  if (user.role === "admin") return { role: "admin" };
  if (!user.tenantId) throw new Error("Utente cliente senza tenant");
  return { role: "cliente", tenantId: user.tenantId };
}

export type AuthResult =
  | { ok: true; token: string; expiresAt: Date; user: SessionUser }
  | { ok: false; reason: "invalid" | "locked" };


export interface InvoiceRow {
  id: string;
  numero: string;
  data: string;
  cessionario: string;
  importoCents: number;
  status: string;
  tenantName?: string | null;
}

export interface InvoiceEvent {
  at: string;
  kind: "invio" | "notifica" | "stato";
  label: string;
  /** Tipo di notifica SdI (RC, NS, MC, NE, DT, SE) per le notifiche. */
  type?: string;
  outcome?: string | null;
  /** Notifica registrata ma senza effetto sullo stato (arrivata fuori sequenza). */
  ignored?: boolean;
  /** Cambio di stato che non coincide con una notifica (es. esito riapplicato dopo la consegna). */
  standalone?: boolean;
  error?: string | null;
  errors?: { codice: string; descrizione: string }[];
}

export interface InvoiceDetail extends InvoiceRow {
  cedente: string;
  ambiente: string;
  sdiIdentifier: string | null;
  hasFile: boolean;
  replacedBy: string | null;
  replaces: string | null;
  events: InvoiceEvent[];
}

export interface InvoiceFile {
  fileName: string;
  bytes: Uint8Array;
}


export interface NewInvoiceInput {
  tenantId?: string;
  idempotencyKey: string;
  cessionario: {
    denominazione: string;
    partitaIva: string;
    codiceFiscale?: string;
    sede?: { indirizzo: string; cap: string; comune: string; provincia?: string };
  };
  destinazione: { tipo: "codice" | "pec"; valore: string };
  tipoDocumento: "TD01" | "TD04";
  formato: "FPR12" | "FPA12";
  data: string;
  righe: { descrizione: string; quantita: number; prezzoUnitario: number; aliquota: number; natura?: string }[];
}

export type CreateInvoiceResult =
  | { ok: true; invoiceId: string; queued: boolean }
  | { ok: false; error: string; path?: string };

export interface TenantOption {
  id: string;
  denominazione: string;
  partitaIva: string;
  indirizzo: string | null;
  cap: string | null;
  comune: string | null;
  provincia: string | null;
}

const toRow = (r: invoiceServiceModule.InvoiceRow): InvoiceRow => ({
  id: r.id,
  numero: r.numero,
  data: r.data,
  cessionario: r.cessionarioDenominazione ?? "",
  importoCents: r.importoCents ?? 0,
  status: r.status,
  tenantName: r.tenantName,
});

const iso = (d: Date | string) => (d instanceof Date ? d.toISOString() : String(d));

export async function authenticate(input: {
  email: string;
  password: string;
  ip: string | null;
}): Promise<AuthResult> {
  const res = await authModule.authenticate(input.email, input.password, input.ip ?? "");
  if (!res.ok) return res;
  const user = await authModule.getSession(res.token);
  if (!user) return { ok: false, reason: "invalid" };
  return { ok: true, token: res.token, expiresAt: res.expiresAt, user: toSessionUser(user) };
}

function toSessionUser(u: authModule.SessionUser): SessionUser {
  return { id: u.userId, email: u.email, role: u.role, tenantId: u.tenantId, mustChangePassword: u.mustChangePassword };
}

export async function getSessionUser(token: string): Promise<SessionUser | null> {
  const u = await authModule.getSession(token);
  return u ? toSessionUser(u) : null;
}

export const changeOwnPassword = authModule.changePassword;

export const destroySession = (token: string): Promise<void> => authModule.destroySession(token);

export async function listInvoices(
  scope: Scope,
  filters: { stato?: string; tenantId?: string; q?: string; limit?: number; offset?: number },
): Promise<InvoiceRow[]> {
  const rows = await invoiceServiceModule.listInvoices(scope, filters);
  return rows.map(toRow);
}

export async function getInvoiceDetail(scope: Scope, id: string): Promise<InvoiceDetail | null> {
  const d = await invoiceServiceModule.getInvoice(scope, id);
  if (!d) return null;
  return {
    ...toRow(d),
    cedente: d.cedenteDenominazione ?? "",
    ambiente: d.ambiente ?? "",
    sdiIdentifier: d.sdiIdentifier,
    hasFile: d.hasFile,
    replacedBy: d.replacedBy,
    replaces: d.replaces,
    events: d.events.map((e) => ({
      at: iso(e.at),
      kind: e.kind === "notification" ? ("notifica" as const) : ("stato" as const),
      label: e.description,
      type: e.kind === "notification" ? e.type : undefined,
      errors: e.errori ?? undefined,
      outcome: e.ignored ? null : e.esito,
      ignored: e.ignored ?? false,
      standalone: e.kind === "status" && e.description.startsWith("Esito già ricevuto"),
      error: e.errori?.length ? e.errori.map((x) => `${x.codice}: ${x.descrizione}`).join("; ") : null,
    })),
  };
}

export interface InvoicePrefill {
  replacesId: string;
  numero: string;
  data: string;
  tenantId: string;
  denominazione: string;
  partitaIva: string;
  codiceFiscale: string;
  indirizzo: string;
  cap: string;
  comune: string;
  provincia: string;
  destTipo: "codice" | "pec";
  destValore: string;
  tipoDocumento: string;
  formato: string;
  righe: { descrizione: string; quantita: string; prezzo: string; aliquota: string; natura: string }[];
  /** Motivo dello scarto, già in frase leggibile. */
  motivo: string[];
}

const dec = (n: number) => String(n).replace(".", ",");

/** Dati di una fattura scartata (NS) per ripartire da una nuova fattura già compilata. Altro tenant o stato diverso: null. */
export async function getInvoicePrefill(scope: Scope, id: string): Promise<InvoicePrefill | null> {
  const d = await invoiceServiceModule.getInvoice(scope, id);
  if (!d || d.status !== "rejected") return null;
  const file = await invoiceServiceModule.getInvoiceFile(scope, id);
  if (!file) return null;
  let f;
  try {
    const { parseFatturaRicevuta } = await import("@/sdi/fatturapa/parse");
    f = parseFatturaRicevuta(file.bytes, file.fileName);
  } catch {
    return null;
  }
  const doc = f.documenti[0];
  const sede = f.cliente.sede ?? "";
  const m = /^(.*?),?\s*(\d{5})\s+(.*?)(?:\s+\(([A-Za-z]{2})\))?$/.exec(sede);
  const dest = d.destinazione ?? "";
  const isPec = dest.includes("@");
  const motivo = d.events
    .filter((e) => e.type === "NS")
    .flatMap((e) => (e.errori ?? []).map((x) => `${x.descrizione} (${x.codice})`));
  return {
    replacesId: d.id,
    numero: d.numero,
    data: d.data,
    tenantId: d.tenantId,
    denominazione: f.cliente.denominazione ?? "",
    partitaIva: f.cliente.partitaIva ?? "",
    codiceFiscale: f.cliente.codiceFiscale ?? "",
    indirizzo: m?.[1] ?? "",
    cap: m?.[2] ?? "",
    comune: m?.[3] ?? "",
    provincia: m?.[4] ?? "",
    destTipo: isPec ? "pec" : "codice",
    destValore: dest,
    tipoDocumento: d.tipoDocumento ?? "TD01",
    formato: d.formato ?? "FPR12",
    righe: (doc?.righe ?? []).map((r) => ({
      descrizione: r.descrizione,
      quantita: dec(r.quantita ?? 1),
      prezzo: dec((r.prezzoUnitarioCents ?? 0) / 100),
      aliquota: String(Math.round(r.aliquota ?? 22)),
      natura: r.natura ?? "",
    })),
    motivo,
  };
}

export async function getInvoiceFile(scope: Scope, id: string): Promise<InvoiceFile | null> {
  return invoiceServiceModule.getInvoiceFile(scope, id);
}

export async function createAndSendInvoice(
  scope: Scope,
  input: NewInvoiceInput,
  replacesInvoiceId?: string,
): Promise<CreateInvoiceResult> {
  const res = await invoiceServiceModule.createAndSendInvoice(scope, {
    tenantId: input.tenantId,
    cessionarioDenominazione: input.cessionario.denominazione,
    cessionarioPartitaIva: input.cessionario.partitaIva,
    cessionarioCodiceFiscale: input.cessionario.codiceFiscale,
    cessionarioSede: input.cessionario.sede,
    destinazione: input.destinazione,
    tipoDocumento: input.tipoDocumento,
    formato: input.formato,
    data: input.data,
    righe: input.righe as invoiceServiceModule.NewInvoiceInput["righe"],
    idempotencyKey: input.idempotencyKey,
  }, replacesInvoiceId ? { replacesInvoiceId } : {});
  if ("errors" in res) {
    const [path, error] = Object.entries(res.errors)[0] ?? ["", "Dati non validi"];
    return { ok: false, error, path: path || undefined };
  }
  return { ok: true, invoiceId: res.id, queued: Boolean(res.queued) };
}

export async function listTenants(scope: Scope): Promise<TenantOption[]> {
  const rows = await tenantsModule.listTenants(scope, undefined, { onlyActive: true });
  return rows.map((t) => ({
    id: t.id,
    denominazione: t.denominazione,
    partitaIva: t.partitaIva,
    indirizzo: t.indirizzo,
    cap: t.cap,
    comune: t.comune,
    provincia: t.provincia,
  }));
}
