-- ---------------------------------------------------------------------
--  Phase 17 — תמחור פר-דגם לכל כתובת (customer_site_model_prices)
--
--  phase16 נתן לכל כתובת סכום ידני אחד (amount_due). זה מחליף את
--  התפקיד הזה במנגנון מדויק יותר: מחיר ליחידה לכל דגם בנפרד באותה
--  כתובת (למשל Icon 500 = 45 ₪, Icon 300 = 30 ₪), והמערכת סוכמת
--  אוטומטית לפי כמות המכשירים בפועל מכל דגם באותה כתובת. amount_due
--  נשאר בטבלה (לא נמחק, לא בשימוש פעיל) — לא הצטבר עליו מידע אמיתי
--  עדיין, אז אין צורך להעביר/למחוק כלום.
--
--  המחיר הוא **תמיד לפני מע"מ** (מוסכמת תמחור-פר-דגם רגילה) — לא
--  תלוי ב-vat_mode של הלקוח כמו amount_due הידני; מע"מ מחושב תמיד
--  18% מעל.
-- ---------------------------------------------------------------------

create table if not exists public.customer_site_model_prices (
  id          uuid primary key default gen_random_uuid(),
  site_id     uuid not null references public.customer_sites (id) on delete cascade,
  model       text not null,
  unit_price  numeric not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (site_id, model)
);

create index if not exists customer_site_model_prices_site_idx
  on public.customer_site_model_prices (site_id);

alter table public.customer_site_model_prices enable row level security;

-- אותה מדיניות בדיוק כמו customer_sites עצמו: קריאה לכולם, כתיבה למנהלים בלבד.
drop policy if exists customer_site_model_prices_select on public.customer_site_model_prices;
create policy customer_site_model_prices_select
  on public.customer_site_model_prices for select
  using (true);

drop policy if exists customer_site_model_prices_write on public.customer_site_model_prices;
create policy customer_site_model_prices_write
  on public.customer_site_model_prices for all
  using (public.is_admin())
  with check (public.is_admin());
