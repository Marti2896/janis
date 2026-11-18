import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentUser } from "@/lib/session";
import { ChangePasswordForm } from "./form";

export const metadata: Metadata = { title: "Cambio password" };

export default async function ChangePasswordPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!user.mustChangePassword) redirect("/fatture");
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-4 px-6 py-16">
      <Card>
        <CardHeader>
          <CardTitle>Scegli una nuova password</CardTitle>
          <CardDescription>Hai effettuato l&apos;accesso con una password temporanea: devi cambiarla prima di continuare.</CardDescription>
        </CardHeader>
        <CardContent>
          <ChangePasswordForm />
        </CardContent>
      </Card>
    </main>
  );
}
