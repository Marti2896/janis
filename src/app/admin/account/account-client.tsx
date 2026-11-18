"use client";

import { useActionState, useState } from "react";
import { KeyRound, Loader2, Plus } from "lucide-react";
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
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  createAccountAction,
  resetPasswordAction,
  toggleUserAction,
  type AccountState,
} from "./actions";

const initial: AccountState = { ok: false };

function TempPassword({ state }: { state: AccountState }) {
  if (!state.tempPassword) return null;
  return (
    <Alert>
      <KeyRound className="size-4" />
      <AlertTitle>Password temporanea per {state.email}</AlertTitle>
      <AlertDescription>
        <code className="break-all font-mono text-foreground">
          {state.tempPassword}
        </code>
        <p>
          Viene mostrata una sola volta: copiala ora. L&apos;utente dovra
          cambiarla al primo accesso.
        </p>
      </AlertDescription>
    </Alert>
  );
}

export function NewAccountDialog() {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(createAccountAction, initial);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus /> Nuovo account
        </Button>
      </DialogTrigger>
      <DialogContent>
        {state.ok ? (
          <div className="space-y-4">
            <DialogHeader>
              <DialogTitle>Account creato</DialogTitle>
              <DialogDescription>
                Consegna le credenziali al cliente.
              </DialogDescription>
            </DialogHeader>
            <TempPassword state={state} />
            <DialogFooter>
              <Button onClick={() => setOpen(false)}>Chiudi</Button>
            </DialogFooter>
          </div>
        ) : (
          <form action={action} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Nuovo account</DialogTitle>
              <DialogDescription>
                Crea l&apos;azienda e il suo primo utente.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="denominazione">Denominazione</Label>
              <Input id="denominazione" name="denominazione" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="partitaIva">Partita IVA</Label>
              <Input id="partitaIva" name="partitaIva" inputMode="numeric" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="codiceFiscale">Codice fiscale (opzionale)</Label>
              <Input id="codiceFiscale" name="codiceFiscale" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email del primo utente</Label>
              <Input id="email" name="email" type="email" required />
            </div>
            {state.error && (
              <Alert variant="destructive">
                <AlertDescription>{state.error}</AlertDescription>
              </Alert>
            )}
            <DialogFooter>
              <Button type="submit" disabled={pending}>
                {pending && <Loader2 className="animate-spin" />}
                Crea account
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function UserActions({
  userId,
  email,
  disabled,
}: {
  userId: string;
  email: string;
  disabled: boolean;
}) {
  const [toggleState, toggle, togglePending] = useActionState(
    toggleUserAction,
    initial,
  );
  const [resetState, reset, resetPending] = useActionState(
    resetPasswordAction,
    initial,
  );
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-wrap justify-end gap-2">
      <form action={toggle}>
        <input type="hidden" name="userId" value={userId} />
        <input type="hidden" name="disable" value={disabled ? "0" : "1"} />
        <Button size="sm" variant="outline" disabled={togglePending}>
          {disabled ? "Riattiva" : "Disattiva"}
        </Button>
      </form>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button size="sm" variant="outline">
            Reset password
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset password</DialogTitle>
            <DialogDescription>
              Genera una nuova password temporanea per {email}.
            </DialogDescription>
          </DialogHeader>
          <TempPassword state={resetState} />
          {resetState.error && (
            <Alert variant="destructive">
              <AlertDescription>{resetState.error}</AlertDescription>
            </Alert>
          )}
          {toggleState.error && (
            <Alert variant="destructive">
              <AlertDescription>{toggleState.error}</AlertDescription>
            </Alert>
          )}
          {!resetState.tempPassword && (
            <form action={reset}>
              <input type="hidden" name="userId" value={userId} />
              <input type="hidden" name="email" value={email} />
              <DialogFooter>
                <Button type="submit" disabled={resetPending}>
                  {resetPending && <Loader2 className="animate-spin" />}
                  Genera password
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
