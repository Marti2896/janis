"use client";

import { useActionState } from "react";
import { AlertCircle, Loader2, KeyRound } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { changePasswordAction, type ChangeState } from "./actions";

export function ChangePasswordForm() {
  const [state, action, pending] = useActionState<ChangeState, FormData>(changePasswordAction, { error: null });
  return (
    <form action={action} className="flex flex-col gap-4">
      {state.error && (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}
      <div className="flex flex-col gap-2">
        <Label htmlFor="current">Password temporanea</Label>
        <Input id="current" name="current" type="password" autoComplete="current-password" required />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="next">Nuova password (almeno 12 caratteri)</Label>
        <Input id="next" name="next" type="password" autoComplete="new-password" minLength={12} required />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="confirm">Conferma nuova password</Label>
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" minLength={12} required />
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? <Loader2 className="animate-spin" /> : <KeyRound />}
        Cambia password
      </Button>
    </form>
  );
}
