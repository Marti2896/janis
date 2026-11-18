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
          Viene mostrata una sola volta: copiala ora. L&apos;utente dovrà
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
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [lastAction, setLastAction] = useState<"off" | "on" | null>(null);
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {toggleState.ok && lastAction && (
        <span role="status" className="text-sm text-muted-foreground">
          {lastAction === "off" ? "Utente disattivato" : "Utente riattivato"}
        </span>
      )}
      {disabled ? (
        <form action={toggle} onSubmit={() => setLastAction("on")}>
          <input type="hidden" name="userId" value={userId} />
          <input type="hidden" name="disable" value="0" />
          <Button size="sm" variant="outline" disabled={togglePending}>
            Riattiva
          </Button>
        </form>
      ) : (
        <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <DialogTrigger asChild>
            <Button size="sm" variant="outline">
              Disattiva
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Disattivare l&apos;utente?</DialogTitle>
              <DialogDescription>
                {email} non potrà più accedere finché non lo riattivi.
              </DialogDescription>
            </DialogHeader>
            <form
              action={(fd) => {
                setLastAction("off");
                setConfirmOpen(false);
                toggle(fd);
              }}
            >
              <input type="hidden" name="userId" value={userId} />
              <input type="hidden" name="disable" value="1" />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setConfirmOpen(false)}>
                  Annulla
                </Button>
                <Button type="submit" variant="destructive">
                  Disattiva utente
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}
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
