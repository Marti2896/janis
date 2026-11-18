import { getInvoiceFile } from "@/lib/server-api";
import { getCurrentUser } from "@/lib/session";
import { toScope } from "@/lib/server-api";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new Response("Non autorizzato", { status: 401 });
  const { id } = await ctx.params;
  const file = await getInvoiceFile(toScope(user), id);
  // Fattura inesistente o di un altro tenant: stessa risposta.
  if (!file) return new Response("Non trovato", { status: 404 });
  const safeName = file.fileName.replace(/[^A-Za-z0-9._-]/g, "_");
  return new Response(Buffer.from(file.bytes), {
    headers: {
      "Content-Type": "application/pkcs7-mime",
      "Content-Disposition": `attachment; filename="${safeName}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
