-- Riepilogo delle fatture ricevute: destinatario scritto nel file, numero di documenti del lotto, totale e numeri.
-- Le colonne sono valorizzate alla ricezione; per le righe esistenti si completano alla prima lettura (null = da calcolare).
alter table received_invoices add column if not exists cessionario_denominazione text;
alter table received_invoices add column if not exists documenti_count int;
alter table received_invoices add column if not exists importo_totale_cents bigint;
alter table received_invoices add column if not exists numeri text;
