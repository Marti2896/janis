"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/session";
import { createTenant } from "@/server/tenants";
import { resetPassword, setUserDisabled } from "@/server/users";

export type AccountState = {
  ok: boolean;
  error?: string;
  /** Password temporanea in chiaro: mostrata una sola volta, mai salvata. */
  tempPassword?: string;
  email?: string;
};

export async function createAccountAction(
  _prev: AccountState,
  formData: FormData,
): Promise<AccountState> {
  const session = await requireAdmin();
  const denominazione = String(formData.get("denominazione") ?? "").trim();
  const partitaIva = String(formData.get("partitaIva") ?? "").trim();
  const codiceFiscale = String(formData.get("codiceFiscale") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!denominazione) return { ok: false, error: "La denominazione è obbligatoria." };
  if (!/^\d{11}$/.test(partitaIva))
    return { ok: false, error: "La partita IVA deve avere 11 cifre." };
  if (!/^\S+@\S+\.\S+$/.test(email))
    return { ok: false, error: "Inserisci un indirizzo email valido." };
  let password: string;
  try {
    const res = await createTenant(
      session.scope,
      { denominazione, partitaIva, codiceFiscale: codiceFiscale || null, email },
      session.user.id,
    );
    password = res.temporaryPassword;
  } catch (e) {
    const msg = e instanceof Error && e.name === "ValidationError" ? e.message : "Account non creato: email o partita IVA già in uso.";
    return { ok: false, error: msg };
  }
  revalidatePath("/admin/account");
  return { ok: true, tempPassword: password, email };
}

export async function toggleUserAction(
  _prev: AccountState,
  formData: FormData,
): Promise<AccountState> {
  const session = await requireAdmin();
  const userId = String(formData.get("userId") ?? "");
  const disable = formData.get("disable") === "1";
  try {
    await setUserDisabled(session.scope, userId, disable, session.user.id);
  } catch {
    return { ok: false, error: "Operazione non riuscita." };
  }
  revalidatePath("/admin/account");
  return { ok: true };
}

export async function resetPasswordAction(
  _prev: AccountState,
  formData: FormData,
): Promise<AccountState> {
  const session = await requireAdmin();
  const userId = String(formData.get("userId") ?? "");
  const email = String(formData.get("email") ?? "");
  let password: string;
  try {
    const res = await resetPassword(session.scope, userId, session.user.id);
    if (!res) return { ok: false, error: "Utente non trovato." };
    password = res.temporaryPassword;
  } catch {
    return { ok: false, error: "Reset non riuscito." };
  }
  return { ok: true, tempPassword: password, email };
}
