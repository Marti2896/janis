import { parseArgs } from "node:util";
import { buildDemoNotificationSoap, type DemoError } from "../src/sdi/messaggi/demo-notification.ts";

const { values } = parseArgs({
  options: {
    tipo: { type: "string" },
    id: { type: "string" },
    "nome-file": { type: "string" },
    "message-id": { type: "string", default: "M1" },
    errore: { type: "string", multiple: true },
    esito: { type: "string" },
    descrizione: { type: "string" },
  },
});

const TIPI = ["RC", "NS", "MC", "NE", "DT", "SE"] as const;
type Tipo = (typeof TIPI)[number];
const tipo = TIPI.find((t) => t === values.tipo) as Tipo | undefined;
if (!tipo || !values.id || !values["nome-file"]) {
  console.error(
    "Uso: npm run --silent sdi:notifica-demo -- --tipo RC|NS|MC|NE|DT|SE --id <sdi_identifier> --nome-file <nome_file> [--message-id M1] [--errore CODICE:descrizione] [--esito EC01|EC02|EN00|EN01] [--descrizione testo]",
  );
  process.exit(1);
}
const esito = (["EC01", "EC02", "EN00", "EN01"] as const).find((e) => e === values.esito);

const errori: DemoError[] = (values.errore ?? []).map((e) => {
  const i = e.indexOf(":");
  return { codice: i < 0 ? e : e.slice(0, i), descrizione: i < 0 ? "" : e.slice(i + 1) };
});

process.stdout.write(
  buildDemoNotificationSoap({
    tipo,
    sdiIdentifier: values.id,
    nomeFile: values["nome-file"],
    messageId: values["message-id"],
    errori,
    ...(esito ? { esito } : {}),
    ...(values.descrizione ? { descrizione: values.descrizione } : {}),
  }),
);
