import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type pg from "pg";
import { authenticateApiKey } from "../api-keys.ts";
import { logEvent } from "../audit.ts";
import {
  createAndSendInvoice,
  getInvoice,
  getInvoiceFile,
  getReceived,
  listInvoices,
  listReceived,
} from "../invoice-service.ts";
import type { InvoiceDetail, InvoiceRow, NewInvoiceInput, ReceivedRow } from "../invoice-service.ts";
import type { Scope } from "../scope.ts";
import { openApiDocument } from "./openapi.ts";

declare module "fastify" {
  interface FastifyRequest {
    apiAuth?: { scope: Scope; tenantId: string; keyId: string };
  }
}

const unauthorized = (reply: FastifyReply) => reply.code(401).send({ error: "unauthorized" });
const notFound = (reply: FastifyReply) => reply.code(404).send({ error: "not_found" });

const invoiceJson = (i: InvoiceRow) => ({
  id: i.id,
  numero: i.numero,
  data: i.data,
  status: i.status,
  nomeFile: i.nomeFile,
  sdiIdentifier: i.sdiIdentifier,
  cessionarioDenominazione: i.cessionarioDenominazione,
  cessionarioPartitaIva: i.cessionarioPiva,
  importoCents: i.importoCents,
  tipoDocumento: i.tipoDocumento,
  formato: i.formato,
  ambiente: i.ambiente,
  createdAt: i.createdAt,
});

const detailJson = (i: InvoiceDetail) => ({
  ...invoiceJson(i),
  notifications: i.events
    .filter((e) => e.kind === "notification")
    .map((e) => ({ type: e.type, at: e.at, esito: e.esito, description: e.description, errori: e.errori })),
  events: i.events.map((e) => ({ at: e.at, kind: e.kind, type: e.type, from: e.from, to: e.to, description: e.description })),
});

const receivedJson = (r: ReceivedRow) => ({
  id: r.id,
  sdiIdentifier: r.sdiIdentifier,
  fileName: r.fileName,
  fileKind: r.fileKind,
  sha256: r.sha256,
  cedenteDenominazione: r.cedenteDenominazione,
  cedentePiva: r.cedentePiva,
  numero: r.numero,
  data: r.data,
  importoCents: r.importoCents,
  receivedAt: r.receivedAt,
});

/** Cursore = offset numerico: semplice e stabile finche l'ordinamento e per data di creazione decrescente. */
function page(query: { cursor?: string; limit?: string }): { limit: number; offset: number } {
  const limit = Math.min(Math.max(Number.parseInt(query.limit ?? "50", 10) || 50, 1), 200);
  const offset = Math.max(Number.parseInt(query.cursor ?? "0", 10) || 0, 0);
  return { limit, offset };
}

/** API REST v1 con X-API-Key (una chiave per account, separata dal login umano). Scope = tenant della chiave. */
export function registerApiV1(app: FastifyInstance, deps: { pool: pg.Pool }): void {
  const db = deps.pool;

  app.register(
    async (api) => {
      api.get("/health", async () => ({ status: "ok" }));
      api.get("/openapi.json", async () => openApiDocument);

      api.register(async (secured) => {
        secured.addHook("onRequest", async (req: FastifyRequest, reply: FastifyReply) => {
          const raw = req.headers["x-api-key"];
          const auth = await authenticateApiKey(Array.isArray(raw) ? raw[0] : raw, db);
          if (!auth) return unauthorized(reply);
          req.apiAuth = auth;
        });

        secured.get("/invoices", async (req) => {
          const q = req.query as { stato?: string; cursor?: string; limit?: string };
          const { limit, offset } = page(q);
          const rows = await listInvoices(req.apiAuth!.scope, { stato: q.stato || null, limit: limit + 1, offset }, { db });
          return { data: rows.slice(0, limit).map(invoiceJson), nextCursor: rows.length > limit ? String(offset + limit) : null };
        });

        secured.get("/invoices/:id", async (req, reply) => {
          const inv = await getInvoice(req.apiAuth!.scope, (req.params as { id: string }).id, { db });
          return inv ? detailJson(inv) : notFound(reply);
        });

        secured.get("/invoices/:id/file", async (req, reply) => {
          const f = await getInvoiceFile(req.apiAuth!.scope, (req.params as { id: string }).id, { db });
          if (!f) return notFound(reply);
          return reply
            .type("application/pkcs7-mime")
            .header("content-disposition", `attachment; filename="${f.fileName}"`)
            .send(f.bytes);
        });

        secured.post("/invoices", async (req, reply) => {
          const auth = req.apiAuth!;
          const idem = req.headers["idempotency-key"];
          const key = (Array.isArray(idem) ? idem[0] : idem)?.trim() || null;
          if (key && key.length > 128) return reply.code(422).send({ error: "validation", fields: { idempotencyKey: "Chiave troppo lunga (massimo 128 caratteri)" } });
          const body = (req.body && typeof req.body === "object" ? req.body : {}) as Partial<NewInvoiceInput>;
          const input = { ...body, tenantId: auth.tenantId, idempotencyKey: key } as NewInvoiceInput;
          const res = await createAndSendInvoice(auth.scope, input, { db, source: "api" });
          let code: number;
          let payload: unknown;
          if ("errors" in res) {
            code = res.conflict ? 409 : 422;
            payload = res.conflict ? { error: "conflict", message: Object.values(res.errors)[0] } : { error: "validation", fields: res.errors };
          } else {
            code = res.replay ? 200 : 201;
            const { replay: _replay, ...rest } = res;
            void _replay;
            payload = rest;
          }
          await logEvent(
            {
              tenantId: auth.tenantId,
              event: "api.invoice.post",
              entity: "api_key",
              entityId: auth.keyId,
              detail: { httpStatus: code, invoiceId: "id" in res ? res.id : null, replay: "replay" in res ? Boolean(res.replay) : false },
              outcome: code < 300 ? "ok" : "error",
            },
            db,
          );
          return reply.code(code).send(payload);
        });

        secured.get("/received-invoices", async (req) => {
          const q = req.query as { cursor?: string; limit?: string };
          const { limit, offset } = page(q);
          const rows = await listReceived(req.apiAuth!.scope, { limit: limit + 1, offset }, { db });
          return { data: rows.slice(0, limit).map(receivedJson), nextCursor: rows.length > limit ? String(offset + limit) : null };
        });

        secured.get("/received-invoices/:id", async (req, reply) => {
          const r = await getReceived(req.apiAuth!.scope, (req.params as { id: string }).id, { db });
          return r ? receivedJson(r) : notFound(reply);
        });

        secured.get("/received-invoices/:id/file", async (req, reply) => {
          const r = await getReceived(req.apiAuth!.scope, (req.params as { id: string }).id, { db });
          if (!r) return notFound(reply);
          return reply
            .type(r.contentType === "application/pkcs7-mime" ? "application/pkcs7-mime" : "application/octet-stream")
            .header("content-disposition", `attachment; filename="${r.fileName}"`)
            .send(r.bytes);
        });
      });
    },
    { prefix: "/api/v1" },
  );
}
