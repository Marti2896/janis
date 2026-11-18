"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/session";
import { saveChannelSettings } from "@/server/channel-settings";

export type CanaleState = { ok: boolean; error?: string };

export async function saveChannelAction(
  _prev: CanaleState,
  formData: FormData,
): Promise<CanaleState> {
  const session = await requireAdmin();
  const environment =
    formData.get("environment") === "production" ? "production" : "demo";
  const endpoint = String(formData.get("endpoint") ?? "").trim();
  try {
    await saveChannelSettings(session.scope, { environment, endpoint }, session.user.id);
  } catch (e) {
    const msg = e instanceof Error && e.name === "ValidationError" ? e.message : "Salvataggio non riuscito.";
    return { ok: false, error: msg };
  }
  revalidatePath("/admin/canale");
  return { ok: true };
}
