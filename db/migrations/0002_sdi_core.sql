-- Schema core canale SDICoop (run #405). Nessun contenuto fiscale in chiaro: solo NomeFile e hash SHA-256.

create extension if not exists pgcrypto;

create table tenants (
  id uuid primary key default gen_random_uuid(),
  partita_iva char(11) not null unique,
  denominazione text not null,
  created_at timestamptz not null default now()
);

create table invoices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id),
  numero text not null,
  data date not null,
  nome_file text not null unique,
  sha256_xml char(64),
  sha256_p7m char(64),
  sdi_identifier text,
  replaces_invoice_id uuid references invoices (id),
  status text not null default 'draft' check (
    status in ('draft', 'signed', 'sending', 'sent', 'send_error', 'send_unknown', 'delivered', 'rejected')
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index invoices_tenant_sdi_identifier_uq
  on invoices (tenant_id, sdi_identifier) where sdi_identifier is not null;
create index invoices_sdi_identifier_idx on invoices (sdi_identifier) where sdi_identifier is not null;

create table invoice_status_history (
  id bigserial primary key,
  invoice_id uuid not null references invoices (id),
  tenant_id uuid not null references tenants (id),
  from_status text,
  to_status text not null,
  causale text not null,
  sdi_timestamp timestamptz,
  recorded_at timestamptz not null default now(),
  source text not null check (source in ('client', 'sdi_notification', 'seed'))
);
create index invoice_status_history_invoice_idx on invoice_status_history (invoice_id);

create table sdi_notifications (
  id bigserial primary key,
  tenant_id uuid references tenants (id),
  invoice_id uuid references invoices (id),
  sdi_identifier text not null,
  type text not null check (type in ('RC', 'NS')),
  message_id text not null default '',
  nome_file text not null,
  file_sha256 char(64) not null,
  received_at timestamptz not null default now(),
  sdi_timestamp timestamptz,
  data_consegna timestamptz,
  destinatario text,
  errori jsonb,
  unique (sdi_identifier, type, message_id)
);

create table audit_log (
  id bigserial primary key,
  tenant_id uuid,
  event text not null,
  entity text not null,
  entity_id text,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create function forbid_mutation() returns trigger language plpgsql as $$
begin
  raise exception 'La tabella % e append-only: % non consentito', tg_table_name, tg_op;
end;
$$;

create trigger audit_log_append_only before update or delete on audit_log
  for each row execute function forbid_mutation();
create trigger invoice_status_history_append_only before update or delete on invoice_status_history
  for each row execute function forbid_mutation();
create trigger sdi_notifications_append_only before update or delete on sdi_notifications
  for each row execute function forbid_mutation();
