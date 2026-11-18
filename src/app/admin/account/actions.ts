"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/session";
import { createTenant } from "@/server/tenants";
import { createUser, resetUserPassword, setUserDisabled } from "@/server/users";

export type AccountState = {
  ok: boolean;
  error?: string;
  /** Password temporanea in chiaro: mostrata una sola volta, mai salvata. */
  tempPassword?: string;
  email?: string;
};

function tempPassword(): string {
  return randomBytes(12).toString("base64url");
}

export async function createAccountAction(
  _prev: AccountState,
  formData: FormData,
): Promise<AccountState> {
  const session = await requireAdmin();
  const denominazione = String(formData.get("denominazione") ?? "").trim();
  const partitaIva = String(formData.get("partitaIva") ?? "").trim();
  const codiceFiscale = String(formData.get("codiceFiscale") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!denominazione) return { ok: false, error: "La denominazione e obbligatoria." };
  if (!/^\d{11}$/.test(partitaIva))
    return { ok: false, error: "La partita IVA deve avere 11 cifre." };
  if (!/^\S+@\S+\.\S+$/.test(email))
    return { ok: false, error: "Inserisci un indirizzo email valido." };
  const password = tempPassword();
  try {
    const tenant = await createTenant({
      denominazione,
      partitaIva,
      codiceFiscale: codiceFiscale || null,
      actorUserId: session.user.id,
    });
    await createUser({
      email,
      password,
      role: "cliente",
      tenantId: tenant.id,
      mustChangePassword: true,
      actorUserId: session.user.id,
    });
  } catch {
    return { ok: false, error: "Account non creato: email o partita IVA gia in uso." };
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
    await setUserDisabled(userId, disable, session.user.id);
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
  const password = tempPassword();
  try {
    await resetUserPassword(userId, password, session.user.id);
  } catch {
    return { ok: false, error: "Reset non riuscito." };
  }
  return { ok: true, tempPassword: password, email };
}
