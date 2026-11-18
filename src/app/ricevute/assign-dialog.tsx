"use client";

import { useActionState, useState } from "react";
import { Loader2 } from "lucide-react";
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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { assignAction, type ActionState } from "./actions";

export function AssignDialog({
  id,
  tenants,
}: {
  id: string;
  tenants: { id: string; label: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<ActionState, FormData>(
    async (prev, fd) => {
      const res = await assignAction(prev, fd);
      if (res.ok) setOpen(false);
      return res;
    },
    { ok: false },
  );
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          Assegna
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form action={action} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Assegna fattura</DialogTitle>
            <DialogDescription>
              Scegli l&apos;account a cui assegnare la fattura ricevuta.
            </DialogDescription>
          </DialogHeader>
          <input type="hidden" name="id" value={id} />
          <div className="space-y-2">
            <Label htmlFor={`tenant-${id}`}>Account</Label>
            <Select name="tenantId" required>
              <SelectTrigger id={`tenant-${id}`}>
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
          {state.error && (
            <Alert variant="destructive">
              <AlertDescription>{state.error}</AlertDescription>
            </Alert>
          )}
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="animate-spin" />}
              Conferma
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
