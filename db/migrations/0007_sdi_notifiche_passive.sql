-- Notifiche MC, NE, DT, SE, fatture passive, numerazione per tenant/anno e idempotenza API (run #406, ADR 0006).
-- Le tabelle storiche restano append-only (trigger forbid_mutation di 0002).

-- Stati fattura estesi (MC, NE EC01/EC02, DT).
alter table invoices drop constraint invoices_status_check;
alter table invoices add constraint invoices_status_check check (
  status in ('draft', 'signed', 'sending', 'sent', 'send_error', 'send_unknown', 'delivered', 'rejected',
             'not_delivered', 'accepted', 'refused', 'terms_expired')
);

-- Dati principali della fattura emessa e file firmato inviato (p7m).
alter table invoices add column anno int;
alter table invoices add column progressivo int;
alter table invoices add column cessionario_denominazione text;
alter table invoices add column cessionario_piva text;
alter table invoices add column cessionario_cf text;
alter table invoices add column importo_cents bigint;
alter table invoices add column tipo_documento text;
alter table invoices add column formato text;
alter table invoices add column ambiente text;
alter table invoices add column destinazione text;
alter table invoices add column p7m bytea;
create unique index invoices_tenant_numero_uq on invoices (tenant_id, numero) where anno is not null;

-- Contatori: anno = 0 e il progressivo di invio (NomeFile), anno > 0 e il numero fattura dell'anno solare.
create table invoice_counters (
  tenant_id uuid not null references tenants (id),
  anno int not null,
  ultimo int not null default 0,
  primary key (tenant_id, anno)
);

-- Idempotenza delle POST API: stessa chiave e stesso corpo = stessa risposta; vale 24 ore.
create table api_idempotency (
  tenant_id uuid not null references tenants (id),
  idem_key text not null,
  body_hash char(64) not null,
  invoice_id uuid references invoices (id),
  created_at timestamptz not null default now(),
  primary key (tenant_id, idem_key)
);

-- Fatture ricevute (passive): file originale XML o P7M, byte per byte.
create table received_invoices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants (id),
  sdi_identifier text not null unique,
  file_name text not null,
  file_kind text not null check (file_kind in ('xml', 'p7m')),
  original_bytes bytea not null,
  sha256 char(64) not null,
  cedente_denominazione text,
  cedente_piva text,
  cedente_cf text,
  cessionario_piva text,
  cessionario_cf text,
  numero text,
  data date,
  importo_cents bigint,
  stato text not null default 'unassigned' check (stato in ('unassigned', 'received')),
  received_at timestamptz not null default now()
);
create index received_invoices_tenant_idx on received_invoices (tenant_id, received_at desc);

create table received_invoice_history (
  id bigserial primary key,
  received_invoice_id uuid not null references received_invoices (id),
  tenant_id uuid references tenants (id),
  event text not null,
  detail jsonb not null default '{}'::jsonb,
  recorded_at timestamptz not null default now()
);
create index received_invoice_history_idx on received_invoice_history (received_invoice_id);
create trigger received_invoice_history_append_only before update or delete on received_invoice_history
  for each row execute function forbid_mutation();

-- Notifiche: aggiunti MC, NE, DT, SE; esito (EC01, EC02, EN00, EN01) e descrizione.
alter table sdi_notifications drop constraint sdi_notifications_type_check;
alter table sdi_notifications add constraint sdi_notifications_type_check check (type in ('RC', 'NS', 'MC', 'NE', 'DT', 'SE'));
alter table sdi_notifications add column esito text;
alter table sdi_notifications add column descrizione text;
alter table sdi_notifications add column received_invoice_id uuid references received_invoices (id);
