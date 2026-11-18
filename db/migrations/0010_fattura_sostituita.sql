-- Fattura scartata dal SdI e rifatta: la vecchia passa a «replaced» (Sostituita) e libera il numero per la nuova.
alter table invoices drop constraint invoices_status_check;
alter table invoices add constraint invoices_status_check check (
  status in ('draft', 'signed', 'sending', 'sent', 'send_error', 'send_unknown', 'delivered', 'rejected',
             'not_delivered', 'accepted', 'refused', 'terms_expired', 'replaced')
);
alter table invoices add column if not exists replaced_by uuid references invoices (id);

drop index if exists invoices_tenant_numero_uq;
create unique index invoices_tenant_numero_uq on invoices (tenant_id, numero) where anno is not null and status <> 'replaced';
