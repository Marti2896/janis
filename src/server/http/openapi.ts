/** Documento OpenAPI 3.1 dell'API REST v1 di Janis. Autenticazione: header X-API-Key (una chiave per account). */

const err = (description: string) => ({
  description,
  content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
});

const id = { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } };
const unauthorized = { "401": err("Chiave mancante, errata o revocata") };

export const openApiDocument = {
  openapi: "3.1.0",
  info: {
    title: "Janis API",
    version: "1.0.0",
    description:
      "Lettura e invio di fatture elettroniche per il proprio account. Ogni chiave API appartiene a un solo account e vede solo i dati di quell'account: una risorsa di un altro account risponde 404.",
  },
  servers: [{ url: "/api/v1" }],
  security: [{ ApiKey: [] }],
  paths: {
    "/health": {
      get: { summary: "Stato del servizio", security: [], responses: { "200": { description: "Servizio attivo" } } },
    },
    "/openapi.json": {
      get: { summary: "Questo documento", security: [], responses: { "200": { description: "OpenAPI 3.1" } } },
    },
    "/invoices": {
      get: {
        summary: "Elenco delle fatture emesse",
        parameters: [
          { name: "stato", in: "query", schema: { $ref: "#/components/schemas/InvoiceStatus" } },
          { name: "cursor", in: "query", schema: { type: "string" }, description: "Valore nextCursor della pagina precedente" },
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 200, default: 50 } },
        ],
        responses: {
          "200": {
            description: "Pagina di fatture",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    data: { type: "array", items: { $ref: "#/components/schemas/Invoice" } },
                    nextCursor: { type: ["string", "null"] },
                  },
                },
              },
            },
          },
          ...unauthorized,
        },
      },
      post: {
        summary: "Crea, firma e invia una fattura",
        description:
          "Il numero fattura è assegnato dal server (progressivo per anno). Con Idempotency-Key, la stessa chiave con lo stesso corpo restituisce la risposta originale (200); con corpo diverso 409. La chiave vale 24 ore.",
        parameters: [{ name: "Idempotency-Key", in: "header", required: false, schema: { type: "string", maxLength: 128 } }],
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/NewInvoice" } } } },
        responses: {
          "201": { description: "Fattura creata", content: { "application/json": { schema: { $ref: "#/components/schemas/CreatedInvoice" } } } },
          "200": { description: "Replay: risposta originale", content: { "application/json": { schema: { $ref: "#/components/schemas/CreatedInvoice" } } } },
          "409": err("Idempotency-Key gia usata con un corpo diverso"),
          "422": err("Validazione fallita: il campo fields elenca i messaggi per campo"),
          ...unauthorized,
        },
      },
    },
    "/invoices/{id}": {
      get: {
        summary: "Dettaglio fattura con notifiche",
        parameters: [id],
        responses: {
          "200": { description: "Fattura", content: { "application/json": { schema: { $ref: "#/components/schemas/InvoiceDetail" } } } },
          "404": err("Non trovata (o di un altro account)"),
          ...unauthorized,
        },
      },
    },
    "/invoices/{id}/file": {
      get: {
        summary: "File firmato inviato (.xml.p7m)",
        parameters: [id],
        responses: {
          "200": { description: "Byte del file", content: { "application/pkcs7-mime": { schema: { type: "string", format: "binary" } } } },
          "404": err("Non trovata"),
          ...unauthorized,
        },
      },
    },
    "/received-invoices": {
      get: {
        summary: "Elenco delle fatture ricevute",
        parameters: [
          { name: "cursor", in: "query", schema: { type: "string" } },
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 200, default: 50 } },
        ],
        responses: {
          "200": {
            description: "Pagina di fatture ricevute",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    data: { type: "array", items: { $ref: "#/components/schemas/ReceivedInvoice" } },
                    nextCursor: { type: ["string", "null"] },
                  },
                },
              },
            },
          },
          ...unauthorized,
        },
      },
    },
    "/received-invoices/{id}": {
      get: {
        summary: "Dettaglio fattura ricevuta",
        parameters: [id],
        responses: {
          "200": { description: "Fattura ricevuta", content: { "application/json": { schema: { $ref: "#/components/schemas/ReceivedInvoice" } } } },
          "404": err("Non trovata"),
          ...unauthorized,
        },
      },
    },
    "/received-invoices/{id}/file": {
      get: {
        summary: "File originale ricevuto, byte per byte",
        parameters: [id],
        responses: {
          "200": {
            description: "XML o P7M originale",
            content: {
              "application/octet-stream": { schema: { type: "string", format: "binary" } },
              "application/pkcs7-mime": { schema: { type: "string", format: "binary" } },
            },
          },
          "404": err("Non trovata"),
          ...unauthorized,
        },
      },
    },
  },
  components: {
    securitySchemes: { ApiKey: { type: "apiKey", in: "header", name: "X-API-Key" } },
    schemas: {
      Error: {
        type: "object",
        required: ["error"],
        properties: {
          error: { enum: ["unauthorized", "not_found", "validation", "conflict"] },
          fields: { type: "object", additionalProperties: { type: "string" } },
        },
      },
      InvoiceStatus: {
        enum: [
          "queued", "draft", "signed", "sending", "sent", "send_error", "send_unknown", "delivered", "rejected",
          "not_delivered", "accepted", "refused", "terms_expired",
        ],
        description: "queued raggruppa gli stati in coda: draft, signed, sending, send_unknown",
      },
      Invoice: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          numero: { type: "string", examples: ["1/2026"] },
          data: { type: "string", format: "date" },
          status: { $ref: "#/components/schemas/InvoiceStatus" },
          nomeFile: { type: "string" },
          sdiIdentifier: { type: ["string", "null"] },
          cessionarioDenominazione: { type: ["string", "null"] },
          cessionarioPartitaIva: { type: ["string", "null"] },
          importoCents: { type: ["integer", "null"] },
          tipoDocumento: { type: ["string", "null"] },
          formato: { type: ["string", "null"] },
          ambiente: { type: ["string", "null"] },
          createdAt: { type: "string", format: "date-time" },
        },
      },
      InvoiceDetail: {
        allOf: [
          { $ref: "#/components/schemas/Invoice" },
          {
            type: "object",
            properties: {
              notifications: { type: "array", items: { $ref: "#/components/schemas/Notification" } },
              events: { type: "array", items: { $ref: "#/components/schemas/Event" } },
            },
          },
        ],
      },
      Notification: {
        type: "object",
        properties: {
          type: { enum: ["RC", "NS", "MC", "NE", "DT", "SE"] },
          at: { type: "string", format: "date-time" },
          esito: { type: ["string", "null"] },
          description: { type: "string" },
          errori: { type: ["array", "null"], items: { type: "object", properties: { codice: { type: "string" }, descrizione: { type: "string" } } } },
        },
      },
      Event: {
        type: "object",
        properties: {
          at: { type: "string", format: "date-time" },
          kind: { enum: ["status", "notification"] },
          type: { type: "string" },
          from: { type: ["string", "null"] },
          to: { type: ["string", "null"] },
          description: { type: "string" },
        },
      },
      NewInvoice: {
        type: "object",
        required: ["cessionarioDenominazione", "cessionarioPartitaIva", "destinazione", "tipoDocumento", "data", "righe"],
        properties: {
          cessionarioDenominazione: { type: "string" },
          cessionarioPartitaIva: { type: "string", pattern: "^[0-9]{11}$" },
          cessionarioCodiceFiscale: { type: "string" },
          destinazione: {
            type: "object",
            required: ["tipo", "valore"],
            properties: { tipo: { enum: ["codice", "pec"] }, valore: { type: "string", description: "Codice destinatario (7 caratteri, 6 con FPA12) oppure indirizzo PEC" } },
          },
          tipoDocumento: { enum: ["TD01", "TD04"] },
          formato: { enum: ["FPR12", "FPA12"], default: "FPR12" },
          data: { type: "string", format: "date" },
          righe: {
            type: "array",
            minItems: 1,
            items: {
              type: "object",
              required: ["descrizione", "quantita", "prezzoUnitario", "aliquota"],
              properties: {
                descrizione: { type: "string" },
                quantita: { type: "number", exclusiveMinimum: 0 },
                prezzoUnitario: { type: "number", minimum: 0, description: "In euro, al massimo 2 decimali" },
                aliquota: { enum: [22, 10, 4, 0] },
              },
            },
          },
        },
      },
      CreatedInvoice: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          status: { $ref: "#/components/schemas/InvoiceStatus" },
          queued: { type: "boolean" },
          warning: { type: "string" },
        },
      },
      ReceivedInvoice: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          sdiIdentifier: { type: "string" },
          fileName: { type: "string" },
          fileKind: { enum: ["xml", "p7m"] },
          sha256: { type: "string" },
          cedenteDenominazione: { type: ["string", "null"] },
          cedentePiva: { type: ["string", "null"] },
          numero: { type: ["string", "null"] },
          data: { type: ["string", "null"], format: "date" },
          importoCents: { type: ["integer", "null"] },
          receivedAt: { type: "string", format: "date-time" },
        },
      },
    },
  },
} as const;
