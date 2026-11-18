"use client";

import { useActionState, useState } from "react";
import { Copy, Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { createKeyAction, revokeKeyAction, type KeyState } from "./actions";

const initial: KeyState = { ok: false };

export function NewKeyDialog({
  tenants,
}: {
  tenants?: { id: string; label: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [state, action, pending] = useActionState(createKeyAction, initial);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus /> Nuova chiave
        </Button>
      </DialogTrigger>
      <DialogContent>
        {state.ok && state.key ? (
          <div className="space-y-4">
            <DialogHeader>
              <DialogTitle>Chiave creata</DialogTitle>
              <DialogDescription>
                Copiala ora: non sarà più mostrata.
              </DialogDescription>
            </DialogHeader>
            <code className="block break-all rounded-md border bg-muted p-3 font-mono text-sm">
              {state.key}
            </code>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={async () => {
                  await navigator.clipboard.writeText(state.key ?? "");
                  setCopied(true);
                }}
              >
                <Copy /> {copied ? "Copiata" : "Copia"}
              </Button>
              <Button onClick={() => setOpen(false)}>Chiudi</Button>
            </DialogFooter>
          </div>
        ) : (
          <form action={action} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Nuova chiave API</DialogTitle>
              <DialogDescription>
                Dai un nome alla chiave, ad esempio il sistema che la userà.
              </DialogDescription>
            </DialogHeader>
            {tenants && (
              <div className="space-y-2">
                <Label htmlFor="key-tenant">Account</Label>
                <Select name="tenantId" required>
                  <SelectTrigger id="key-tenant">
                    <SelectValue placeholder="Seleziona un account" />
                  </SelectTrigger>
                  <SelectContent>
                    {tenants.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="key-name">Nome</Label>
              <Input id="key-name" name="name" required />
            </div>
            {state.error && (
              <Alert variant="destructive">
                <AlertDescription>{state.error}</AlertDescription>
              </Alert>
            )}
            <DialogFooter>
              <Button type="submit" disabled={pending}>
                {pending && <Loader2 className="animate-spin" />}
                Crea chiave
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function RevokeKeyDialog({ id, name }: { id: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<KeyState, FormData>(
    async (prev, fd) => {
      const res = await revokeKeyAction(prev, fd);
      if (res.ok) setOpen(false);
      return res;
    },
    initial,
  );
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          Revoca
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form action={action} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Revocare la chiave?</DialogTitle>
            <DialogDescription>
              La chiave «{name}» smetterà di funzionare subito. L&apos;azione non
              si può annullare.
            </DialogDescription>
          </DialogHeader>
          <input type="hidden" name="id" value={id} />
          {state.error && (
            <Alert variant="destructive">
              <AlertDescription>{state.error}</AlertDescription>
            </Alert>
          )}
          <DialogFooter>
            <Button type="submit" variant="destructive" disabled={pending}>
              {pending && <Loader2 className="animate-spin" />}
              Revoca chiave
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
