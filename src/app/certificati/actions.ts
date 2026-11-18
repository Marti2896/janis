"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/session";
import { addCertificate } from "@/server/certificates";

export type ActionState = { ok: boolean; error?: string };

export async function uploadCertificateAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireAdmin();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0)
    return { ok: false, error: "Seleziona un file." };
  if (file.size > 1024 * 1024)
    return { ok: false, error: "Password errata o file non valido." };
  const environment =
    formData.get("environment") === "production" ? "production" : "demo";
  const password = String(formData.get("password") ?? "") || undefined;
  try {
    await addCertificate({
      file: Buffer.from(await file.arrayBuffer()),
      fileName: file.name,
      password,
      environment,
      actorUserId: session.user.id,
    });
  } catch {
    return { ok: false, error: "Password errata o file non valido." };
  }
  revalidatePath("/certificati");
  return { ok: true };
}
