"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/session";
import { assignReceived } from "@/server/invoice-service";

export type ActionState = { ok: boolean; error?: string };

export async function assignAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const tenantId = String(formData.get("tenantId") ?? "");
  if (!id || !tenantId) return { ok: false, error: "Seleziona un account." };
  try {
    await assignReceived(session.scope, id, tenantId, session.user.id);
  } catch {
    return { ok: false, error: "Assegnazione non riuscita." };
  }
  revalidatePath("/ricevute");
  return { ok: true };
}
