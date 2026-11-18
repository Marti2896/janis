"use client";

import { useActionState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { saveChannelAction, type CanaleState } from "./actions";

export function CanaleForm({
  environment,
  endpoint,
  productionBlocked,
}: {
  environment: "demo" | "production";
  endpoint: string;
  productionBlocked: boolean;
}) {
  const [state, action, pending] = useActionState<CanaleState, FormData>(
    saveChannelAction,
    { ok: false },
  );
  return (
    <form action={action} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="environment">Ambiente</Label>
        <Select name="environment" defaultValue={environment}>
          <SelectTrigger id="environment">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="demo">Demo</SelectItem>
            <SelectItem value="production" disabled={productionBlocked}>
              Produzione
            </SelectItem>
          </SelectContent>
        </Select>
        {productionBlocked && (
          <p className="text-sm text-muted-foreground">
            Produzione non disponibile: mancano un certificato valido per la
            produzione o l&apos;endpoint.
          </p>
        )}
      </div>
      <div className="space-y-2">
        <Label htmlFor="endpoint">Endpoint SdI</Label>
        <Input
          id="endpoint"
          name="endpoint"
          type="url"
          defaultValue={endpoint}
          placeholder="https://..."
        />
      </div>
      {state.error && (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}
      {state.ok && (
        <Alert>
          <CheckCircle2 className="size-4" />
          <AlertDescription>Configurazione salvata.</AlertDescription>
        </Alert>
      )}
      <Button type="submit" disabled={pending}>
        {pending && <Loader2 className="animate-spin" />}
        Salva
      </Button>
    </form>
  );
}
