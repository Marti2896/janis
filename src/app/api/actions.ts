"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/session";
import { createApiKey, revokeApiKey } from "@/server/api-keys";

export type KeyState = { ok: boolean; error?: string; key?: string };

export async function createKeyAction(
  _prev: KeyState,
  formData: FormData,
): Promise<KeyState> {
  const session = await requireSession();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { ok: false, error: "Il nome è obbligatorio." };
  const tenantId =
    session.user.role === "admin"
      ? String(formData.get("tenantId") ?? "")
      : session.user.tenantId;
  if (!tenantId) return { ok: false, error: "Seleziona un account." };
  try {
    const created = await createApiKey(session.scope, { tenantId, name }, session.user.id);
    revalidatePath("/api");
    return { ok: true, key: created.secret };
  } catch {
    return { ok: false, error: "Chiave non creata." };
  }
}

export async function revokeKeyAction(
  _prev: KeyState,
  formData: FormData,
): Promise<KeyState> {
  const session = await requireSession();
  const id = String(formData.get("id") ?? "");
  try {
    await revokeApiKey(session.scope, id, session.user.id);
  } catch {
    return { ok: false, error: "Revoca non riuscita." };
  }
  revalidatePath("/api");
  return { ok: true };
}
