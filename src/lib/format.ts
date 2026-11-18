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

/** Data come gg/mm/aaaa: da una stringa AAAA-MM-GG senza passare dal fuso orario. */
export function formatDateShort(value: string | Date | null | undefined): string {
  if (!value) return "-";
  if (typeof value === "string") {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
    if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  }
  const d = typeof value === "string" ? new Date(value) : value;
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleDateString("it-IT");
}
