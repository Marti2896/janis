"use client";

import { startTransition, useActionState, useState } from "react";
import { Loader2, Upload } from "lucide-react";
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
import { uploadCertificateAction, type ActionState } from "./actions";

export function UploadDialog() {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<ActionState, FormData>(
    async (prev, fd) => {
      const res = await uploadCertificateAction(prev, fd);
      if (res.ok) setOpen(false);
      return res;
    },
    { ok: false },
  );
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Upload /> Carica certificato
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form
          onSubmit={(ev) => {
            // Niente action sul form: React lo azzererebbe e il file scelto andrebbe perso dopo un errore.
            ev.preventDefault();
            const fd = new FormData(ev.currentTarget);
            startTransition(() => action(fd));
          }}
          className="space-y-4"
        >
          <DialogHeader>
            <DialogTitle>Carica certificato</DialogTitle>
            <DialogDescription>
              PKCS#12 o PEM. La chiave privata viene cifrata e non viene mai
              mostrata.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="cert-file">File</Label>
            <Input
              id="cert-file"
              name="file"
              type="file"
              accept=".p12,.pfx,.pem"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="cert-password">Password (se richiesta)</Label>
            <Input
              id="cert-password"
              name="password"
              type="password"
              autoComplete="off"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="cert-env">Ambiente</Label>
            <Select name="environment" defaultValue="demo">
              <SelectTrigger id="cert-env">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="demo">Demo</SelectItem>
                <SelectItem value="production">Produzione</SelectItem>
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
              Carica
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
