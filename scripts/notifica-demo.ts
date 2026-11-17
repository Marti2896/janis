import { parseArgs } from "node:util";
import { buildDemoNotificationSoap, type DemoError } from "../src/sdi/messaggi/demo-notification.ts";

const { values } = parseArgs({
  options: {
    tipo: { type: "string" },
    id: { type: "string" },
    "nome-file": { type: "string" },
    "message-id": { type: "string", default: "M1" },
    errore: { type: "string", multiple: true },
  },
});

if ((values.tipo !== "RC" && values.tipo !== "NS") || !values.id || !values["nome-file"]) {
  console.error(
    "Uso: npm run --silent sdi:notifica-demo -- --tipo RC|NS --id <sdi_identifier> --nome-file <nome_file> [--message-id M1] [--errore CODICE:descrizione]",
  );
  process.exit(1);
}

const errori: DemoError[] = (values.errore ?? []).map((e) => {
  const i = e.indexOf(":");
  return { codice: i < 0 ? e : e.slice(0, i), descrizione: i < 0 ? "" : e.slice(i + 1) };
});

process.stdout.write(
  buildDemoNotificationSoap({
    tipo: values.tipo,
    sdiIdentifier: values.id,
    nomeFile: values["nome-file"],
    messageId: values["message-id"],
    errori,
  }),
);
