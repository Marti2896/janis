-- Sede legale del tenant: usata come sede del CedentePrestatore nelle fatture emesse.
alter table tenants add column if not exists indirizzo text;
alter table tenants add column if not exists cap text;
alter table tenants add column if not exists comune text;
alter table tenants add column if not exists provincia text;
