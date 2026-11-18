"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { STATUS_FILTERS } from "@/components/status-badge";

const ALL = "tutti";

export function InvoiceFilters({
  tenants,
}: {
  /** Presente solo per l'admin. */
  tenants?: { id: string; denominazione: string }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function update(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value === ALL) next.delete(key);
    else next.set(key, value);
    next.delete("pagina");
    const qs = next.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  return (
    <div className="flex flex-wrap items-end gap-4">
      <form
        role="search"
        className="flex min-w-0 flex-col gap-2"
        onSubmit={(ev) => {
          ev.preventDefault();
          update("q", String(new FormData(ev.currentTarget).get("q") ?? "").trim() || ALL);
        }}
      >
        <Label htmlFor="filtro-q">Cerca per numero o cliente</Label>
        <div className="flex gap-2">
          <Input id="filtro-q" name="q" defaultValue={params.get("q") ?? ""} className="w-56" />
          <Button type="submit" variant="outline" size="icon" aria-label="Cerca">
            <Search />
          </Button>
        </div>
      </form>
      <div className="flex flex-col gap-2">
        <Label htmlFor="filtro-stato">Stato</Label>
        <Select value={params.get("stato") ?? ALL} onValueChange={(v) => update("stato", v)}>
          <SelectTrigger id="filtro-stato" className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Tutti</SelectItem>
            <SelectItem value="errors">Con errori</SelectItem>
            {STATUS_FILTERS.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {tenants && (
        <div className="flex flex-col gap-2">
          <Label htmlFor="filtro-account">Account</Label>
          <Select value={params.get("account") ?? ALL} onValueChange={(v) => update("account", v)}>
            <SelectTrigger id="filtro-account" className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Tutti gli account</SelectItem>
              {tenants.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.denominazione}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  );
}
