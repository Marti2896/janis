import { getPool } from "./pool.ts";
import type { Db } from "./pool.ts";
import { effectiveTenant } from "./scope.ts";
import type { Scope } from "./scope.ts";

export type AuditInput = {
  tenantId?: string | null;
  actorUserId?: string | null;
  event: string;
  entity: string;
  entityId?: string | null;
  detail?: Record<string, unknown>;
  outcome?: "ok" | "error";
};

/** Scrive in audit_log (append-only). Mai segreti nel detail. */
export async function logEvent(input: AuditInput, db: Db = getPool()): Promise<void> {
  await db.query(
    `insert into audit_log (tenant_id, actor_user_id, event, entity, entity_id, detail, outcome)
     values ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
    [
      input.tenantId ?? null,
      input.actorUserId ?? null,
      input.event,
      input.entity,
      input.entityId ?? null,
      JSON.stringify(input.detail ?? {}),
      input.outcome ?? "ok",
    ],
  );
}

export type AuditRow = {
  id: string;
  createdAt: Date;
  tenantId: string | null;
  tenantName: string | null;
  actorUserId: string | null;
  event: string;
  entity: string;
  entityId: string | null;
  outcome: string;
  detail: Record<string, unknown>;
};

export type AuditFilter = { from?: Date | string | null; to?: Date | string | null; tenantId?: string | null; limit?: number; offset?: number };

/** Il cliente vede solo gli eventi del proprio tenant, qualunque filtro passi. */
export async function listAudit(scope: Scope, filter: AuditFilter = {}, db: Db = getPool()): Promise<AuditRow[]> {
  const tenant = effectiveTenant(scope, filter.tenantId);
  const params: unknown[] = [];
  const where: string[] = [];
  if (tenant) {
    params.push(tenant);
    where.push(`a.tenant_id = $${params.length}`);
  }
  if (filter.from) {
    params.push(filter.from);
    where.push(`a.created_at >= $${params.length}`);
  }
  if (filter.to) {
    // "Data a" e inclusiva: se e una data senza ora si arriva a fine giornata.
    const to = typeof filter.to === "string" && /^\d{4}-\d{2}-\d{2}$/.test(filter.to) ? `${filter.to}T23:59:59.999Z` : filter.to;
    params.push(to);
    where.push(`a.created_at <= $${params.length}`);
  }
  params.push(Math.min(filter.limit ?? 50, 200), filter.offset ?? 0);
  const r = await db.query(
    `select a.id, a.created_at, a.tenant_id, t.denominazione as tenant_name, a.actor_user_id,
            a.event, a.entity, a.entity_id, a.outcome, a.detail
       from audit_log a left join tenants t on t.id = a.tenant_id
      ${where.length ? "where " + where.join(" and ") : ""}
      order by a.created_at desc, a.id desc
      limit $${params.length - 1} offset $${params.length}`,
    params,
  );
  return r.rows.map((x) => ({
    id: String(x.id),
    createdAt: x.created_at,
    tenantId: x.tenant_id,
    tenantName: x.tenant_name,
    actorUserId: x.actor_user_id,
    event: x.event,
    entity: x.entity,
    entityId: x.entity_id,
    outcome: x.outcome,
    detail: x.detail,
  }));
}
