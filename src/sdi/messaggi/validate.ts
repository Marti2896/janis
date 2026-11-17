import { readFileSync } from "node:fs";
import path from "node:path";
import { validateXML } from "xmllint-wasm";

const MSG_DIR = path.join(process.cwd(), "src/sdi/messaggi/xsd");
const DSIG_PATH = path.join(process.cwd(), "src/sdi/fatturapa/xsd/xmldsig-core-schema.xsd");
const SCHEMA_NAME = "MessaggiTypes_v1.0.xsd";
const DSIG_NAME = "xmldsig-core-schema.xsd";

let cache: { schema: string; dsig: string } | null = null;

function loadSchemas() {
  cache ??= {
    schema: readFileSync(path.join(MSG_DIR, SCHEMA_NAME), "utf8"),
    dsig: readFileSync(DSIG_PATH, "utf8"),
  };
  return cache;
}

export interface MessageValidation {
  ok: boolean;
  errors: string[];
}

/** Valida un messaggio SdI (RC, NS, ...) contro MessaggiTypes_v1.0.xsd, senza rete. */
export async function validateMessaggioXml(xml: string): Promise<MessageValidation> {
  const { schema, dsig } = loadSchemas();
  try {
    const res = await validateXML({
      xml: { fileName: "messaggio.xml", contents: xml },
      schema: { fileName: SCHEMA_NAME, contents: schema },
      preload: [{ fileName: DSIG_NAME, contents: dsig }],
    });
    const errors = res.errors.map((e) => e.message.replace(/^Element '[^']*':\s*/, ""));
    return { ok: errors.length === 0, errors };
  } catch (err) {
    return { ok: false, errors: [(err as Error).message] };
  }
}
