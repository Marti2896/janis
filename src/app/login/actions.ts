"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, authenticate, destroySession } from "@/lib/server-api";

export interface LoginState {
  error: string | null;
  email: string;
  next: string;
}

const MSG_INVALID = "Email o password non corretti.";
const MSG_LOCKED = "Troppi tentativi. Riprova tra 15 minuti.";

/** Accetta solo percorsi interni: niente redirect verso altri siti. */
function safeNext(value: string): string {
  if (value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/login")) return value;
  return "/fatture";
}

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "");

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length === 0) {
    return { error: MSG_INVALID, email, next };
  }

  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null;

  const result = await authenticate({ email, password, ip });
  if (!result.ok) {
    return { error: result.reason === "locked" ? MSG_LOCKED : MSG_INVALID, email, next };
  }

  const store = await cookies();
  store.set(SESSION_COOKIE, result.token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: result.expiresAt,
  });
  redirect(safeNext(next));
}

export async function logoutAction(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) await destroySession(token);
  store.delete(SESSION_COOKIE);
  redirect("/login?uscito=1");
}
