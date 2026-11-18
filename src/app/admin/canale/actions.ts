"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/session";
import { updateChannelSettings } from "@/server/channel-settings";
import { listCertificates } from "@/server/certificates";

export type CanaleState = { ok: boolean; error?: string };

export async function saveChannelAction(
  _prev: CanaleState,
  formData: FormData,
): Promise<CanaleState> {
  const session = await requireAdmin();
  const environment =
    formData.get("environment") === "production" ? "production" : "demo";
  const endpoint = String(formData.get("endpoint") ?? "").trim();
  if (endpoint) {
    try {
      const u = new URL(endpoint);
      if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error();
    } catch {
      return { ok: false, error: "L'endpoint deve essere un URL http o https valido." };
    }
  }
  if (environment === "production") {
    const now = Date.now();
    const certs = await listCertificates();
    const valid = certs.some(
      (c) => c.environment === "production" && new Date(c.notAfter).getTime() > now,
    );
    if (!valid || !endpoint)
      return {
        ok: false,
        error:
          "Produzione bloccata: servono un certificato valido per la produzione e un endpoint.",
      };
  }
  try {
    await updateChannelSettings({
      environment,
      endpoint,
      actorUserId: session.user.id,
    });
  } catch {
    return { ok: false, error: "Salvataggio non riuscito." };
  }
  revalidatePath("/admin/canale");
  return { ok: true };
}
