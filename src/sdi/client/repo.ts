export type InvoiceStatus =
  | "draft"
  | "signed"
  | "sending"
  | "sent"
  | "send_error"
  | "send_unknown"
  | "delivered"
  | "rejected";

/** Contratto verso il repository (implementato altrove, iniettato). */
export interface InvoiceRepo {
  findByNomeFile(nomeFile: string): Promise<{ id: string; status: InvoiceStatus }[]>;
  transition(args: {
    invoiceId: string;
    to: InvoiceStatus;
    reason: string;
    payload?: Record<string, unknown>;
  }): Promise<void>;
  getInvoice(id: string): Promise<{ id: string; status: InvoiceStatus; tenantId: string } | null>;
  createRepair(args: { replacesInvoiceId: string; nomeFile: string }): Promise<{ id: string }>;
}
