import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CheckCircle2, Network } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentUser } from "@/lib/session";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Accedi" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; uscito?: string }>;
}) {
  const { next = "", uscito } = await searchParams;
  if (await getCurrentUser()) redirect("/fatture");

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-4 px-6 py-16">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-2xl">
            <Network className="size-6" />
            Interscambio
          </CardTitle>
          <CardDescription>Accedi con il tuo account per gestire le fatture elettroniche.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {uscito && (
            <Alert>
              <CheckCircle2 />
              <AlertDescription>Sei uscito.</AlertDescription>
            </Alert>
          )}
          <LoginForm next={next} />
        </CardContent>
      </Card>
    </main>
  );
}
