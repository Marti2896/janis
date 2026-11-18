import { cache } from "react";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import {
  SESSION_COOKIE,
  getSessionUser,
  toScope,
  type Scope,
  type SessionUser,
} from "@/lib/server-api";

/** Utente della sessione corrente, o null. Una sola lettura per richiesta. */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return getSessionUser(token);
});

/** Per le pagine protette: senza sessione valida porta a /login. */
export async function requireSession(next?: string): Promise<{ user: SessionUser; scope: Scope }> {
  const user = await getCurrentUser();
  if (!user) {
    const target = next && next.startsWith("/") && !next.startsWith("//") ? `?next=${encodeURIComponent(next)}` : "";
    redirect(`/login${target}`);
  }
  if (user.mustChangePassword) redirect("/cambia-password");
  return { user, scope: toScope(user) };
}

/** Per le pagine admin: il cliente riceve 404 (nessuna rivelazione dell'area). */
export async function requireAdmin(next?: string): Promise<{ user: SessionUser; scope: Scope }> {
  const session = await requireSession(next);
  if (session.user.role !== "admin") notFound();
  return session;
}
