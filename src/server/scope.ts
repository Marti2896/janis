// Scope obbligatorio per ogni lettura: l'isolamento tra tenant sta nel repository, non nelle pagine (ADR 0006).
export type Scope = { role: "admin" } | { role: "cliente"; tenantId: string };

export class ForbiddenError extends Error {
  constructor(message = "Accesso negato") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export class ValidationError extends Error {
  field: string | undefined;
  constructor(message: string, field?: string) {
    super(message);
    this.name = "ValidationError";
    this.field = field;
  }
}

export function requireAdmin(scope: Scope): void {
  if (scope.role !== "admin") throw new ForbiddenError();
}

/** Tenant effettivo: il cliente e inchiodato al proprio, l'admin puo filtrare (o no). */
export function effectiveTenant(scope: Scope, requested?: string | null): string | null {
  if (scope.role === "cliente") return scope.tenantId;
  return requested ? requested : null;
}

export function scopeFromSession(s: { role: "admin" | "cliente"; tenantId: string | null }): Scope {
  if (s.role === "admin") return { role: "admin" };
  if (!s.tenantId) throw new ForbiddenError();
  return { role: "cliente", tenantId: s.tenantId };
}
