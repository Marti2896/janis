const eur = new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" });
const dateOnly = new Intl.DateTimeFormat("it-IT", { dateStyle: "medium" });
const dateTime = new Intl.DateTimeFormat("it-IT", { dateStyle: "medium", timeStyle: "medium" });

export function formatEuro(cents: number): string {
  return eur.format(cents / 100);
}

export function formatDate(value: string | Date): string {
  const d = typeof value === "string" ? new Date(value) : value;
  return Number.isNaN(d.getTime()) ? String(value) : dateOnly.format(d);
}

export function formatDateTime(value: string | Date): string {
  const d = typeof value === "string" ? new Date(value) : value;
  return Number.isNaN(d.getTime()) ? String(value) : dateTime.format(d);
}
