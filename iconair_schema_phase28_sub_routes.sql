-- ---------------------------------------------------------------------
--  שלב 28 — תתי-קווים (sub_routes): פתרון קבוע למגבלת 25 ה-waypoints
--  של Google Directions (ר' googleMaps.js, phase מוקדם יותר) בקווים
--  גדולים. נבדק מול הנתונים החיים לפני הכתיבה (2026-09-11): קו חיפה
--  68 עצירות היום, קו צפון 39 — שניהם כבר מעל המגבלה, לא מקרה קצה
--  תיאורטי.
--
--  עיצוב: תת-קו הוא אשכול גיאוגרפי *בתוך* קו קיים (routes) — לא קו
--  נפרד. השיוך של עצירה לקו עצמו (route_id) לא משתנה; sub_route_id
--  הוא שכבת-חלוקה נוספת, נאלאבל, על route_assignments (השורה שכבר
--  מייצגת "עצירה של לקוח/אתר בתאריך מסוים" — בדיוק המקום הנכון לזה,
--  לא טבלה נפרדת של חברות-קבועה). עצירה בלי sub_route_id ("לא משויכת")
--  ממשיכה לעבוד בדיוק כמו היום — זו תכונה תוספתית לגמרי, לא שינוי
--  שובר. מספור הסדר (stop_order) נשאר כמו שהוא: התצוגה/השמירה עכשיו
--  קורות תמיד בהיקף של תת-קו נבחר (או "הכל", ר' RoutesScreen.jsx), אז
--  כל אשכול ממוספר 1..N באופן עצמאי — בלי צורך בעמודה נוספת.
-- ---------------------------------------------------------------------

create table if not exists public.sub_routes (
  id         uuid primary key default gen_random_uuid(),
  route_id   uuid not null references public.routes (id) on delete cascade,
  name       text not null,
  sort_order int  not null default 0,
  created_at timestamptz not null default now(),
  unique (route_id, name)
);

create index if not exists sub_routes_route_idx on public.sub_routes (route_id);

alter table public.sub_routes enable row level security;

-- כולם רואים (כדי לסנן/להציג עצירות לפי תת-קו) — רק מנהל יוצר/עורך,
-- אותו דפוס בדיוק כמו routes/customer_site_model_prices וכו'.
drop policy if exists sub_routes_select on public.sub_routes;
create policy sub_routes_select on public.sub_routes
  for select to authenticated using (true);

drop policy if exists sub_routes_write on public.sub_routes;
create policy sub_routes_write on public.sub_routes
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

alter table public.route_assignments
  add column if not exists sub_route_id uuid references public.sub_routes (id) on delete set null;

create index if not exists route_assignments_sub_route_idx on public.route_assignments (sub_route_id);

do $$
declare t text;
begin
  foreach t in array array['sub_routes']
  loop
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
