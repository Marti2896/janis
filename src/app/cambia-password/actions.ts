"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, changeOwnPassword } from "@/lib/server-api";
import { getCurrentUser } from "@/lib/session";

export interface ChangeState {
  error: string | null;
}

export async function changePasswordAction(_prev: ChangeState, formData: FormData): Promise<ChangeState> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const current = String(formData.get("current") ?? "");
  const next = String(formData.get("next") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  if (next !== confirm) return { error: "Le due password non coincidono." };
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  try {
    const res = await changeOwnPassword(user.id, current, next, token);
    if (!res.ok) return { error: "La password attuale non e corretta." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Password non valida." };
  }
  redirect("/fatture");
}
