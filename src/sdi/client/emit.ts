import type { InvoiceRepo } from "./repo";
import { riceviFile, type RiceviFileResult, type SoapClientConfig } from "./soap";

export type EmitResult =
  | { ok: true; result: RiceviFileResult }
  | { ok: false; error: string };

export async function emitInvoice(
  input: { invoiceId: string; nomeFile: string; p7m: Buffer },
  deps: { repo: InvoiceRepo; cfg: SoapClientConfig },
): Promise<EmitResult> {
  const { repo, cfg } = deps;
  if (cfg.sdiEnv === "production") {
    return { ok: false, error: "Invio bloccato: sdiEnv production non è abilitato in questa versione" };
  }
  const existing = await repo.findByNomeFile(input.nomeFile);
  if (existing.some((i) => i.status !== "signed")) {
    return { ok: false, error: `Fattura già inviata: NomeFile ${input.nomeFile} presente` };
  }
  const invoice = await repo.getInvoice(input.invoiceId);
  if (!invoice) return { ok: false, error: `Fattura non trovata: ${input.invoiceId}` };
  if (invoice.status !== "signed") {
    return { ok: false, error: `Transizione non consentita: da ${invoice.status} a sending` };
  }

  await repo.transition({ invoiceId: input.invoiceId, to: "sending", reason: "Invio a SdI avviato" });
  const result = await riceviFile({ nomeFile: input.nomeFile, p7m: input.p7m }, cfg);

  if (result.status === "sent") {
    await repo.transition({
      invoiceId: input.invoiceId,
      to: "sent",
      reason: "Accettata da SdI",
      payload: { identificativoSdi: result.identificativoSdi, dataOraRicezione: result.dataOraRicezione },
    });
  } else if (result.status === "send_error") {
    await repo.transition({
      invoiceId: input.invoiceId,
      to: "send_error",
      reason: `${result.codice}: ${result.messaggio}`,
      payload: { codice: result.codice },
    });
  } else {
    await repo.transition({
      invoiceId: input.invoiceId,
      to: "send_unknown",
      reason: "Esito invio sconosciuto: tentativi di rete esauriti",
    });
  }
  return { ok: true, result };
}

export async function repairInvoice(
  input: { invoiceId: string; nomeFile: string },
  deps: { repo: InvoiceRepo },
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const invoice = await deps.repo.getInvoice(input.invoiceId);
  if (!invoice) return { ok: false, error: `Fattura non trovata: ${input.invoiceId}` };
  if (invoice.status !== "rejected" && invoice.status !== "send_error") {
    return { ok: false, error: `Riparazione non consentita: la fattura è in stato ${invoice.status}` };
  }
  const created = await deps.repo.createRepair({
    replacesInvoiceId: input.invoiceId,
    nomeFile: input.nomeFile,
  });
  return { ok: true, id: created.id };
}
