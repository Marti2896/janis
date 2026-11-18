import { getCurrentUser } from "@/lib/session";
import { toScope } from "@/lib/server-api";
import { getReceived } from "@/server/invoice-service";


export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return new Response("Non autorizzato", { status: 401 });
  const { id } = await params;
  const r = await getReceived(toScope(user), id);
  if (!r) return new Response("Non trovato", { status: 404 });
  const name = r.fileName.replace(/[^\w.\-]/g, "_");
  return new Response(new Uint8Array(r.bytes), {
    headers: {
      "Content-Type": r.contentType,
      "Content-Disposition": `attachment; filename="${name}"`,
      "Content-Length": String(r.bytes.length),
    },
  });
}
