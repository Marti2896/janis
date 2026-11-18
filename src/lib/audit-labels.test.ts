import { describe, expect, it } from "vitest";
import { auditActionLabel, auditErrorReason } from "./audit-labels";

describe("audit-labels", () => {
  it("traduce gli eventi in frasi italiane", () => {
    expect(auditActionLabel("invoice.created", {})).toBe("Fattura creata");
    expect(auditActionLabel("auth.login", {})).toBe("Accesso");
    expect(auditActionLabel("api.invoice.post", {})).toBe("Fattura inviata da sistema esterno (API)");
    expect(auditActionLabel("notification.applied", { type: "RC" })).toBe("Notifica ricevuta: Consegnata");
    expect(auditActionLabel("notification.incompatible_state", {})).toMatch(/^Notifica ignorata/);
  });

  it("non mostra mai il codice tecnico per eventi sconosciuti", () => {
    expect(auditActionLabel("qualcosa.di.nuovo", {})).toBe("Attività del sistema");
  });

  it("da un motivo leggibile agli errori di accesso", () => {
    expect(auditErrorReason("auth.login_failed", {})).toBe("Email o password non corretti");
    expect(auditErrorReason("invoice.created", {})).toBeNull();
  });
});
