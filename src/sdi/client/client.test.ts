import { describe, expect, it, vi } from "vitest";
import { emitInvoice, repairInvoice } from "./emit";
import type { InvoiceRepo, InvoiceStatus } from "./repo";
import { backoffDelay } from "./retry";
import { riceviFile, SOAP_ACTION, type SoapClientConfig } from "./soap";

const OK = `<soap:Envelope xmlns:soap="x"><soap:Body><types:rispostaSdIRiceviFile xmlns:types="t"><IdentificativoSdI>123</IdentificativoSdI><DataOraRicezione>2026-01-01T10:00:00Z</DataOraRicezione></types:rispostaSdIRiceviFile></soap:Body></soap:Envelope>`;
const ERR = `<soap:Envelope xmlns:soap="x"><soap:Body><r><Errore>EI01</Errore></r></soap:Body></soap:Envelope>`;
const res = (status: number, body = "") => new Response(body, { status });

function cfg(f: typeof fetch, over: Partial<SoapClientConfig> = {}): SoapClientConfig {
  return {
    sdiEnv: "demo",
    trasmissioneUrl: "http://demo.local/ws",
    fetch: f,
    sleep: async () => {},
    random: () => 1,
    ...over,
  };
}
const input = { nomeFile: "IT01234567890_00001.xml.p7m", p7m: Buffer.from("firma") };

function fakeRepo(status: InvoiceStatus = "signed", existing: { id: string; status: InvoiceStatus }[] = []) {
  const repo: InvoiceRepo = {
    findByNomeFile: vi.fn(async () => existing),
    transition: vi.fn(async () => {}),
    getInvoice: vi.fn(async (id: string) => ({ id, status, tenantId: "t1" })),
    createRepair: vi.fn(async () => ({ id: "new1" })),
  };
  return repo;
}

describe("riceviFile", () => {
  it("invia SOAPAction, content-type e corpo corretti", async () => {
    const f = vi.fn(async () => res(200, OK));
    const r = await riceviFile(input, cfg(f as unknown as typeof fetch));
    expect(r).toMatchObject({ status: "sent", identificativoSdi: "123" });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://demo.local/ws");
    const h = init.headers as Record<string, string>;
    expect(h.SOAPAction).toContain(SOAP_ACTION);
    expect(h["Content-Type"]).toContain("text/xml");
    expect(init.body).toContain("<NomeFile>IT01234567890_00001.xml.p7m</NomeFile>");
    expect(init.body).toContain(`<File>${input.p7m.toString("base64")}</File>`);
  });

  it("due 503 poi OK: 3 tentativi", async () => {
    const f = vi.fn().mockResolvedValueOnce(res(503)).mockResolvedValueOnce(res(503)).mockResolvedValueOnce(res(200, OK));
    const r = await riceviFile(input, cfg(f as unknown as typeof fetch));
    expect(r.status).toBe("sent");
    expect(f).toHaveBeenCalledTimes(3);
  });

  it("Errore SdI: nessun retry, send_error", async () => {
    const f = vi.fn(async () => res(200, ERR));
    const r = await riceviFile(input, cfg(f as unknown as typeof fetch));
    expect(r).toMatchObject({ status: "send_error", codice: "EI01" });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("errore di rete esaurito: send_unknown", async () => {
    const f = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const r = await riceviFile(input, cfg(f as unknown as typeof fetch));
    expect(r).toEqual({ status: "send_unknown" });
    expect(f).toHaveBeenCalledTimes(3);
  });

  it("production: rifiuta senza chiamare", async () => {
    const f = vi.fn();
    const r = await riceviFile(input, cfg(f as unknown as typeof fetch, { sdiEnv: "production" }));
    expect(r.status).toBe("send_error");
    expect(f).not.toHaveBeenCalled();
  });

  it("backoff con tetto", () => {
    const c = { maxAttempts: 3, baseMs: 1000, capMs: 8000 };
    expect(backoffDelay(1, c, () => 1)).toBe(1000);
    expect(backoffDelay(10, c, () => 1)).toBe(8000);
    expect(backoffDelay(10, c, () => 0)).toBe(4000);
  });
});

describe("emitInvoice", () => {
  it("signed -> sending -> sent", async () => {
    const repo = fakeRepo();
    const f = vi.fn(async () => res(200, OK));
    const r = await emitInvoice({ invoiceId: "i1", ...input }, { repo, cfg: cfg(f as unknown as typeof fetch) });
    expect(r.ok).toBe(true);
    const tos = (repo.transition as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0].to);
    expect(tos).toEqual(["sending", "sent"]);
  });

  it("NomeFile già presente: rifiuto e zero chiamate", async () => {
    const repo = fakeRepo("signed", [{ id: "x", status: "sent" }]);
    const f = vi.fn();
    const r = await emitInvoice({ invoiceId: "i1", ...input }, { repo, cfg: cfg(f as unknown as typeof fetch) });
    expect(r).toEqual({ ok: false, error: `Fattura già inviata: NomeFile ${input.nomeFile} presente` });
    expect(f).not.toHaveBeenCalled();
    expect(repo.transition).not.toHaveBeenCalled();
  });

  it("errore SdI -> send_error; rete -> send_unknown", async () => {
    const r1 = fakeRepo();
    await emitInvoice({ invoiceId: "i1", ...input }, { repo: r1, cfg: cfg((async () => res(200, ERR)) as unknown as typeof fetch) });
    expect((r1.transition as ReturnType<typeof vi.fn>).mock.calls[1][0].to).toBe("send_error");
    const r2 = fakeRepo();
    await emitInvoice({ invoiceId: "i1", ...input }, { repo: r2, cfg: cfg((async () => { throw new Error("x"); }) as unknown as typeof fetch) });
    expect((r2.transition as ReturnType<typeof vi.fn>).mock.calls[1][0].to).toBe("send_unknown");
  });
});

describe("repairInvoice", () => {
  it("consentita da rejected e send_error", async () => {
    for (const s of ["rejected", "send_error"] as const) {
      const repo = fakeRepo(s);
      expect(await repairInvoice({ invoiceId: "i1", nomeFile: "n.xml" }, { repo })).toEqual({ ok: true, id: "new1" });
      expect(repo.createRepair).toHaveBeenCalledWith({ replacesInvoiceId: "i1", nomeFile: "n.xml" });
    }
  });
  it("rifiutata da altri stati", async () => {
    const repo = fakeRepo("delivered");
    expect(await repairInvoice({ invoiceId: "i1", nomeFile: "n.xml" }, { repo })).toEqual({
      ok: false,
      error: "Riparazione non consentita: la fattura è in stato delivered",
    });
    expect(repo.createRepair).not.toHaveBeenCalled();
  });
});
