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
  actorEmail: string | null;
  event: string;
  entity: string;
  entityId: string | null;
  outcome: string;
  detail: Record<string, unknown>;
  /** Oggetto concreto (es. «Fattura 11/2026», email utente, nome chiave) e, se esiste, il suo dettaglio. */
  objectLabel: string | null;
  objectHref: string | null;
};

export type AuditCategory = "fatture" | "accessi" | "api";

export type AuditFilter = {
  from?: Date | string | null;
  to?: Date | string | null;
  tenantId?: string | null;
  category?: AuditCategory | null;
  limit?: number;
  offset?: number;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  if (filter.category === "fatture") where.push(`a.entity in ('invoice', 'received_invoice', 'sdi_notification')`);
  else if (filter.category === "accessi") where.push(`a.event like 'auth.%'`);
  else if (filter.category === "api") where.push(`(a.event like 'api.%' or a.entity = 'api_key')`);
  params.push(Math.min(filter.limit ?? 50, 200), filter.offset ?? 0);
  const r = await db.query(
    `select a.id, a.created_at, a.tenant_id, t.denominazione as tenant_name, a.actor_user_id,
            a.event, a.entity, a.entity_id, a.outcome, a.detail,
            i.numero as invoice_numero, ri.numero as received_numero, u.email as user_email, k.name as key_name, ua.email as actor_email
       from audit_log a left join tenants t on t.id = a.tenant_id
       left join users ua on ua.id = a.actor_user_id
       left join invoices i on a.entity = 'invoice' and a.entity_id = i.id::text
       left join received_invoices ri on a.entity = 'received_invoice' and a.entity_id = ri.id::text
       left join users u on a.entity = 'user' and a.entity_id = u.id::text
       left join api_keys k on a.entity = 'api_key' and a.entity_id = k.id::text
      ${where.length ? "where " + where.join(" and ") : ""}
      order by a.created_at desc, a.id desc
      limit $${params.length - 1} offset $${params.length}`,
    params,
  );
  return r.rows.map((x) => {
    const detail = (x.detail ?? {}) as Record<string, unknown>;
    let objectLabel: string | null = null;
    let objectHref: string | null = null;
    if (x.entity === "invoice" && x.invoice_numero) {
      objectLabel = `Fattura ${x.invoice_numero}`;
      if (UUID_RE.test(String(x.entity_id))) objectHref = `/fatture/${x.entity_id}`;
    } else if (x.entity === "received_invoice" && x.received_numero) {
      objectLabel = `Fattura ricevuta ${x.received_numero}`;
      if (UUID_RE.test(String(x.entity_id))) objectHref = `/ricevute/${x.entity_id}`;
    } else if (x.entity === "user") {
      objectLabel = x.user_email ?? (typeof detail.email === "string" ? detail.email : null);
    } else if (x.entity === "api_key") {
      objectLabel = x.key_name ? `Chiave ${x.key_name}` : typeof detail.name === "string" ? `Chiave ${detail.name}` : null;
    } else if (x.entity === "sdi_notification" && typeof detail.type === "string") {
      objectLabel = "Notifica SdI";
    } else if (x.entity === "channel_settings") {
      objectLabel = "Impostazioni del canale";
    } else if (typeof detail.numero === "string") {
      objectLabel = `Fattura ${detail.numero}`;
    }
    return {
    id: String(x.id),
    createdAt: x.created_at,
    tenantId: x.tenant_id,
    tenantName: x.tenant_name,
    actorUserId: x.actor_user_id,
    actorEmail: x.actor_email ?? null,
    event: x.event,
    entity: x.entity,
    entityId: x.entity_id,
    outcome: x.outcome,
    detail,
    objectLabel,
    objectHref,
    };
  });
}
