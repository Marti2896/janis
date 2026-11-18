import { readFileSync } from "node:fs";
import path from "node:path";
import { XMLParser } from "fast-xml-parser";
import { validateXML } from "xmllint-wasm";
import type { FieldError, ValidationResult } from "./types.ts";

const XSD_DIR = path.join(process.cwd(), "src/sdi/fatturapa/xsd");
const SCHEMA_NAME = "Schema_del_file_xml_FatturaPA_v1.2.2.xsd";
const DSIG_NAME = "xmldsig-core-schema.xsd";

let cache: { schema: string; dsig: string } | null = null;

function loadSchemas() {
  cache ??= {
    schema: readFileSync(path.join(XSD_DIR, SCHEMA_NAME), "utf8"),
    dsig: readFileSync(path.join(XSD_DIR, DSIG_NAME), "utf8"),
  };
  return cache;
}

/** Ricava il nome del campo dal messaggio libxml2: "Element '{ns}Campo': ...". */
function fieldOf(message: string): string {
  const m = /Element '(?:\{[^}]*\})?([^']+)'/.exec(message);
  return m ? m[1] : "(documento)";
}

/** Controlli del profilo FPR12 che lo schema non esprime. */
function profileErrors(xml: string): FieldError[] {
  const errors: FieldError[] = [];
  let doc: unknown;
  try {
    doc = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, parseTagValue: false }).parse(xml);
  } catch {
    return errors;
  }
  const root = (doc as { FatturaElettronica?: Record<string, unknown> }).FatturaElettronica;
  const header = root?.FatturaElettronicaHeader as
    | { DatiTrasmissione?: { CodiceDestinatario?: string } }
    | undefined;
  const code = header?.DatiTrasmissione?.CodiceDestinatario;
  if (root?.["@_versione"] === "FPR12" && typeof code === "string" && code.length !== 7) {
    errors.push({ path: "CodiceDestinatario", message: "CodiceDestinatario deve essere di 7 caratteri" });
  }
  return errors;
}

/** Valida il file contro gli XSD ufficiali FPR12 (senza rete) e il profilo. */
export async function validateFatturaXml(xml: string): Promise<ValidationResult> {
  const { schema, dsig } = loadSchemas();
  const res = await validateXML({
    xml: { fileName: "fattura.xml", contents: xml },
    schema: { fileName: SCHEMA_NAME, contents: schema },
    preload: [{ fileName: DSIG_NAME, contents: dsig }],
  });
  const errors: FieldError[] = res.errors.map((e) => ({
    path: fieldOf(e.message),
    message: e.message.replace(/^Element '[^']*':\s*/, ""),
  }));
  // Il messaggio di profilo e piu chiaro: sostituisce quello XSD sullo stesso campo.
  for (const p of profileErrors(xml)) {
    const rest = errors.filter((e) => e.path !== p.path);
    errors.length = 0;
    errors.push(p, ...rest);
  }
  return errors.length ? { ok: false, errors } : { ok: true };
}
