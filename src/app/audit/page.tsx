import type { Metadata } from "next";
import Link from "next/link";
import { AUDIT_CATEGORIES, auditActionLabel, auditChangeLines, auditErrorReason } from "@/lib/audit-labels";
import { Badge } from "@/components/ui/badge";
import { requireSession } from "@/lib/session";
import { listAudit } from "@/server/audit";
import { listTenants } from "@/server/tenants";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const PAGE_SIZE = 50;

type SP = { da?: string; a?: string; account?: string; tipo?: string; pagina?: string };

export const metadata: Metadata = { title: "Cronologia attività" };

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const sp = await searchParams;
  const session = await requireSession();
  const isAdmin = session.user.role === "admin";
  const page = Math.max(1, Number(sp.pagina) || 1);
  const isDate = (v?: string) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
  const from = isDate(sp.da) ? sp.da : undefined;
  const to = isDate(sp.a) ? sp.a : undefined;
  const account = isAdmin && sp.account ? sp.account : undefined;
  const category = AUDIT_CATEGORIES.find((c) => c.value === sp.tipo)?.value;
    const [rows, tenants] = await Promise.all([
      listAudit(session.scope, {
        from,
        to,
        tenantId: account,
        category,
        limit: PAGE_SIZE + 1,
        offset: (page - 1) * PAGE_SIZE,
      }),
      listTenants(session.scope, undefined, { onlyActive: true }),
    ]);
    const hasNext = rows.length > PAGE_SIZE;
    const shown = rows.slice(0, PAGE_SIZE);
    const qs = (p: number) => {
      const u = new URLSearchParams();
      if (from) u.set("da", from);
      if (to) u.set("a", to);
      if (account) u.set("account", account);
      if (category) u.set("tipo", category);
      u.set("pagina", String(p));
      return `/audit?${u.toString()}`;
    };
    const tenantName = (id: string) => tenants.find((t) => t.id === id)?.denominazione ?? "Account";
    return (
      <main className="mx-auto max-w-3xl space-y-6 px-6 py-16">
        <h1 className="text-2xl font-semibold">Cronologia attività</h1>
        <form method="get" className="flex flex-wrap items-end gap-4">
          <div className="space-y-2">
            <Label htmlFor="da">Data da</Label>
            <Input id="da" name="da" type="date" defaultValue={from} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="a">Data a</Label>
            <Input id="a" name="a" type="date" defaultValue={to} />
          </div>
          {isAdmin && (
            <div className="space-y-2">
              <Label htmlFor="account">Account</Label>
              <Select name="account" defaultValue={account}>
                <SelectTrigger id="account" className="w-56">
                  <SelectValue placeholder="Tutti" />
                </SelectTrigger>
                <SelectContent>
                  {tenants.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.denominazione}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="tipo">Tipo di attività</Label>
            <Select name="tipo" defaultValue={category}>
              <SelectTrigger id="tipo" className="w-40">
                <SelectValue placeholder="Tutte" />
              </SelectTrigger>
              <SelectContent>
                {AUDIT_CATEGORIES.map((c) => (
                  <SelectItem key={c.value} value={c.value}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button type="submit">Filtra</Button>
        </form>
        <Card>
          <CardContent className="overflow-x-auto pt-6">
            {shown.length === 0 ? (
              <p className="py-8 text-center text-muted-foreground">
                Nessun evento nel periodo selezionato.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data e ora</TableHead>
                    <TableHead>Account</TableHead>
                    <TableHead>Azione</TableHead>
                    <TableHead>Oggetto</TableHead>
                    <TableHead>Esito</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {shown.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>
                        {new Date(r.createdAt).toLocaleString("it-IT")}
                      </TableCell>
                      <TableCell>
                        {r.tenantName ?? (r.tenantId ? tenantName(r.tenantId) : null) ?? r.actorEmail ?? (
                          <span className="text-muted-foreground">Sistema</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {auditActionLabel(r.event, r.detail)}
                        {auditChangeLines(r.event, r.detail, true).map((line) => (
                          <span key={line} className="block text-xs text-muted-foreground">
                            {line}
                          </span>
                        ))}
                      </TableCell>
                      <TableCell>
                        {r.objectLabel ? (
                          r.objectHref ? (
                            <Link href={r.objectHref} className="underline underline-offset-4">
                              {r.objectLabel}
                            </Link>
                          ) : (
                            r.objectLabel
                          )
                        ) : (
                          "-"
                        )}
                      </TableCell>
                      <TableCell>
                        {r.event === "notification.incompatible_state" ? (
                          <Badge variant="outline">Ignorata</Badge>
                        ) : r.outcome === "error" ? (
                          <div className="flex flex-col items-start gap-1">
                            <Badge variant="destructive">Errore</Badge>
                            {auditErrorReason(r.event, r.detail) && (
                              <span className="text-xs text-muted-foreground">{auditErrorReason(r.event, r.detail)}</span>
                            )}
                          </div>
                        ) : (
                          <Badge variant="success">Riuscito</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
        <div className="flex justify-between">
          {page > 1 ? (
            <Button asChild variant="outline">
              <Link href={qs(page - 1)}>Precedenti</Link>
            </Button>
          ) : (
            <span />
          )}
          {hasNext && (
            <Button asChild variant="outline">
              <Link href={qs(page + 1)}>Successivi</Link>
            </Button>
          )}
        </div>
      </main>
    );
}
