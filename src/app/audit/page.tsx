import Link from "next/link";
import { requireSession } from "@/lib/session";
import { listAudit } from "@/server/audit";
import { listTenants } from "@/server/tenants";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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

export const dynamic = "force-dynamic";
const PAGE_SIZE = 50;

type SP = { da?: string; a?: string; account?: string; pagina?: string };

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
  try {
    const [rows, tenants] = await Promise.all([
      listAudit(session.scope, {
        from,
        to,
        tenantId: account,
        limit: PAGE_SIZE + 1,
        offset: (page - 1) * PAGE_SIZE,
      }),
      isAdmin ? listTenants() : Promise.resolve([]),
    ]);
    const hasNext = rows.length > PAGE_SIZE;
    const shown = rows.slice(0, PAGE_SIZE);
    const qs = (p: number) => {
      const u = new URLSearchParams();
      if (from) u.set("da", from);
      if (to) u.set("a", to);
      if (account) u.set("account", account);
      u.set("pagina", String(p));
      return `/audit?${u.toString()}`;
    };
    const tenantName = (id: string | null) =>
      id ? (tenants.find((t) => t.id === id)?.denominazione ?? id) : "Sistema";
    return (
      <main className="mx-auto max-w-3xl space-y-6 px-6 py-16">
        <h1 className="text-2xl font-semibold">Audit</h1>
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
                      <TableCell>{tenantName(r.tenantId)}</TableCell>
                      <TableCell>{r.action}</TableCell>
                      <TableCell>{r.object ?? "-"}</TableCell>
                      <TableCell>{r.outcome ?? "-"}</TableCell>
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
  } catch {
    return (
      <main className="mx-auto max-w-3xl px-6 py-16">
        <Alert variant="destructive">
          <AlertTitle>Errore</AlertTitle>
          <AlertDescription>
            Impossibile caricare l&apos;audit. Ricarica la pagina.
          </AlertDescription>
        </Alert>
      </main>
    );
  }
}
