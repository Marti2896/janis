-- Login, multi-tenant, API key, certificati cifrati e configurazione canale (run #406, ADR 0006).
-- Nessuna password, chiave privata o API key in chiaro: solo hash o testo cifrato AES-256-GCM.

alter table tenants add column codice_fiscale text;

create table users (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  password_hash text not null,
  role text not null check (role in ('admin', 'cliente')),
  tenant_id uuid references tenants (id),
  must_change_password boolean not null default false,
  disabled_at timestamptz,
  created_at timestamptz not null default now(),
  check ((role = 'admin' and tenant_id is null) or (role = 'cliente' and tenant_id is not null))
);
create unique index users_email_lower_uq on users (lower(email));
create index users_tenant_idx on users (tenant_id);

create table sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  token_hash char(64) not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index sessions_user_idx on sessions (user_id);

-- Tentativi di login falliti (blocco temporaneo): non e un log di audit, si puo ripulire.
create table login_attempts (
  id bigserial primary key,
  email_lc text not null,
  ip text not null default '',
  attempted_at timestamptz not null default now()
);
create index login_attempts_email_idx on login_attempts (email_lc, attempted_at);

create table api_keys (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id),
  name text not null,
  prefix text not null unique,
  secret_hash char(64) not null,
  created_by uuid references users (id),
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
create index api_keys_tenant_idx on api_keys (tenant_id);

-- Segreti cifrati (AES-256-GCM): payload = base64(iv | tag | ciphertext).
create table secrets (
  ref text primary key,
  payload text not null,
  created_at timestamptz not null default now()
);

create table certificates (
  id uuid primary key default gen_random_uuid(),
  subject text not null,
  issuer text not null,
  not_after timestamptz not null,
  environment text not null check (environment in ('demo', 'production')),
  secret_ref text not null references secrets (ref),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index certificates_env_idx on certificates (environment, active);

create table channel_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references users (id)
);

alter table audit_log add column actor_user_id uuid;
alter table audit_log add column outcome text not null default 'ok';
create index audit_log_tenant_created_idx on audit_log (tenant_id, created_at);
