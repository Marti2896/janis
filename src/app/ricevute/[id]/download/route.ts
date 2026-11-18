import { getSession } from "@/lib/session";
import { getReceived } from "@/server/invoice-service";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) return new Response("Non autorizzato", { status: 401 });
  const { id } = await params;
  const r = await getReceived(session.scope, id);
  if (!r) return new Response("Non trovato", { status: 404 });
  const type =
    r.fileKind === "p7m" ? "application/pkcs7-mime" : "application/xml";
  const name = r.fileName.replace(/[^\w.\-]/g, "_");
  return new Response(new Uint8Array(r.originalBytes), {
    headers: {
      "Content-Type": type,
      "Content-Disposition": `attachment; filename="${name}"`,
      "Content-Length": String(r.originalBytes.length),
    },
  });
}
