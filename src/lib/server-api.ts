/**
 * Adattatore unico tra le pagine di questa corsia e i moduli server scritti
 * dalle altre corsie (auth, repository, servizio fatture, tenant). Le pagine
 * non importano mai direttamente `@/server/*`: se un contratto cambia si
 * corregge qui, in un solo punto.
 */
import * as authModule from "@/server/auth";
import * as invoiceRepoModule from "@/server/invoice-repo";
import * as invoiceServiceModule from "@/server/invoice-service";
import * as tenantsModule from "@/server/tenants";

export const SESSION_COOKIE = "interscambio_session";

export type Role = "admin" | "cliente";

export interface SessionUser {
  id: string;
  email: string;
  role: Role;
  tenantId: string | null;
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

interface AuthApi {
  authenticate(input: { email: string; password: string; ip: string | null }): Promise<AuthResult>;
  getSessionUser(token: string): Promise<SessionUser | null>;
  destroySession(token: string): Promise<void>;
}

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
  outcome?: string | null;
  error?: string | null;
}

export interface InvoiceDetail extends InvoiceRow {
  cedente: string;
  ambiente: string;
  sdiIdentifier: string | null;
  hasFile: boolean;
  events: InvoiceEvent[];
}

export interface InvoiceFile {
  fileName: string;
  bytes: Uint8Array;
}

interface InvoiceReadApi {
  listInvoices(scope: Scope, filters: { stato?: string; tenantId?: string }): Promise<InvoiceRow[]>;
  getInvoiceDetail(scope: Scope, id: string): Promise<InvoiceDetail | null>;
  getInvoiceFile(scope: Scope, id: string): Promise<InvoiceFile | null>;
}

export interface NewInvoiceInput {
  tenantId?: string;
  idempotencyKey: string;
  cessionario: { denominazione: string; partitaIva: string; codiceFiscale?: string };
  destinazione: { tipo: "codice" | "pec"; valore: string };
  tipoDocumento: "TD01" | "TD04";
  formato: "FPR12" | "FPA12";
  data: string;
  righe: { descrizione: string; quantita: number; prezzoUnitario: number; aliquota: number }[];
}

export type CreateInvoiceResult =
  | { ok: true; invoiceId: string; queued: boolean }
  | { ok: false; error: string; path?: string };

interface InvoiceServiceApi {
  createAndSendInvoice(scope: Scope, input: NewInvoiceInput): Promise<CreateInvoiceResult>;
}

export interface TenantOption {
  id: string;
  denominazione: string;
}

interface TenantsApi {
  listTenants(scope: Scope): Promise<TenantOption[]>;
}

const auth = authModule as unknown as AuthApi;
const invoiceRepo = invoiceRepoModule as unknown as InvoiceReadApi;
const invoiceService = invoiceServiceModule as unknown as InvoiceServiceApi;
const tenants = tenantsModule as unknown as TenantsApi;

export const authenticate = (input: { email: string; password: string; ip: string | null }) =>
  auth.authenticate(input);
export const getSessionUser = (token: string) => auth.getSessionUser(token);
export const destroySession = (token: string) => auth.destroySession(token);
export const listInvoices = invoiceRepo.listInvoices.bind(invoiceRepo);
export const getInvoiceDetail = invoiceRepo.getInvoiceDetail.bind(invoiceRepo);
export const getInvoiceFile = invoiceRepo.getInvoiceFile.bind(invoiceRepo);
export const createAndSendInvoice = invoiceService.createAndSendInvoice.bind(invoiceService);
export const listTenants = tenants.listTenants.bind(tenants);
