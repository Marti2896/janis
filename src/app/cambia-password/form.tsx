"use client";

import { useActionState, useState } from "react";
import { AlertCircle, Check, Loader2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { changePasswordAction, type ChangeState } from "./actions";

type Errors = { current?: string; next?: string; confirm?: string };

export function ChangePasswordForm() {
  const [state, action, pending] = useActionState<ChangeState, FormData>(changePasswordAction, { error: null });
  const [errors, setErrors] = useState<Errors>({});

  function onSubmit(ev: React.FormEvent<HTMLFormElement>) {
    const fd = new FormData(ev.currentTarget);
    const e: Errors = {};
    if (!String(fd.get("current") ?? "")) e.current = "Inserisci la password temporanea.";
    const next = String(fd.get("next") ?? "");
    if (next.length < 12) e.next = "La password deve avere almeno 12 caratteri.";
    if (String(fd.get("confirm") ?? "") !== next) e.confirm = "Le due password non coincidono.";
    setErrors(e);
    if (Object.keys(e).length > 0) ev.preventDefault();
  }

  const field = (key: keyof Errors) => ({
    "aria-invalid": errors[key] ? true : undefined,
    "aria-describedby": errors[key] ? `${key}-error` : undefined,
  });
  const msg = (key: keyof Errors) =>
    errors[key] ? (
      <p id={`${key}-error`} role="alert" className="text-sm text-destructive">
        {errors[key]}
      </p>
    ) : null;

  return (
    <form action={action} onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      {state.error && (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}
      <div className="flex flex-col gap-2">
        <Label htmlFor="current">Password temporanea</Label>
        <Input id="current" name="current" type="password" autoComplete="current-password" {...field("current")} />
        {msg("current")}
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="next">Nuova password (almeno 12 caratteri)</Label>
        <Input id="next" name="next" type="password" autoComplete="new-password" {...field("next")} />
        {msg("next")}
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="confirm">Conferma nuova password</Label>
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" {...field("confirm")} />
        {msg("confirm")}
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? <Loader2 className="animate-spin" /> : <Check />}
        Salva password
      </Button>
    </form>
  );
}
