-- Phase 45 — 2026-09-27, בקשה מפורשת: טאב "ניהול סושיאל" — כתיבה, תזמון
-- ופרסום פוסטים לפייסבוק/אינסטגרם דרך Meta Graph API, וסטטוס קמפיינים.
--
-- הפרסום עצמו קורה בצד השרת בלבד (api/social.js ב-Vercel) — טוקן ה-Meta
-- לעולם לא מגיע לדפדפן ולא נשמר ב-DB. הטבלה כאן היא רק "תור הפוסטים":
-- מה נכתב, לאן, מתי, ומה Meta החזיר (מזהה פוסט / שגיאה) לכל פלטפורמה.
--
-- סטטוס לכל פלטפורמה בנפרד (fb_status / ig_status), כי המנגנונים שונים:
--   * פייסבוק — תזמון אמיתי אצל Meta עצמה (scheduled_publish_time), כך
--     שפוסט מתוזמן יעלה בזמן גם אם אף אחד לא פתח את המערכת.
--   * אינסטגרם — ה-API של Meta לא תומך בתזמון; פוסט מתוזמן ממתין כאן
--     ומתפרסם כשהגיע זמנו והטאב פתוח אצל מנהל (או בלחיצה "פרסם עכשיו").
-- NULL = הפלטפורמה לא נבחרה לפוסט הזה.
--
-- מנהלים בלבד — כמו הלידים/ניהול המלאי. לא נוגע בשום טבלה קיימת.

create table if not exists public.social_posts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) default auth.uid(),
  caption text not null default '',
  image_url text,
  link_url text,
  is_draft boolean not null default true,
  scheduled_at timestamptz,
  published_at timestamptz,
  fb_status text check (fb_status in ('pending', 'scheduled', 'published', 'failed')),
  ig_status text check (ig_status in ('pending', 'published', 'failed')),
  fb_post_id text,
  ig_media_id text,
  fb_error text,
  ig_error text,
  -- נעילה קצרה בזמן פרסום — מונעת פרסום כפול כששני מנהלים (או שתי
  -- לשוניות) מנסים לפרסם את אותו פוסט באותו רגע. api/social.js תופס
  -- אותה אטומית ומשחרר בסיום.
  publish_lock timestamptz,
  constraint social_posts_has_platform check (fb_status is not null or ig_status is not null)
);

create index if not exists social_posts_created_at_idx on public.social_posts (created_at desc);
create index if not exists social_posts_scheduled_idx on public.social_posts (scheduled_at) where scheduled_at is not null;

alter table public.social_posts enable row level security;

drop policy if exists social_posts_select on public.social_posts;
create policy social_posts_select on public.social_posts for select using (is_admin());

drop policy if exists social_posts_insert on public.social_posts;
create policy social_posts_insert on public.social_posts for insert with check (is_admin());

drop policy if exists social_posts_update on public.social_posts;
create policy social_posts_update on public.social_posts for update using (is_admin()) with check (is_admin());

drop policy if exists social_posts_delete on public.social_posts;
create policy social_posts_delete on public.social_posts for delete using (is_admin());

drop trigger if exists social_posts_set_updated_at on public.social_posts;
create trigger social_posts_set_updated_at
  before update on public.social_posts
  for each row execute function public.set_updated_at();

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'social_posts') then
    alter publication supabase_realtime add table public.social_posts;
  end if;
end $$;

-- תמונות לפוסטים: bucket ציבורי — חובה, כי Meta מושכת את התמונה בעצמה
-- מכתובת URL ציבורית (אינסטגרם לא מקבל העלאת קובץ ישירה). שם קובץ הוא
-- uuid אקראי, אותה תבנית כמו contracts/branding/service-reports.
insert into storage.buckets (id, name, public)
values ('social-media', 'social-media', true)
on conflict (id) do nothing;

drop policy if exists social_media_storage_insert on storage.objects;
create policy social_media_storage_insert on storage.objects
  for insert with check (bucket_id = 'social-media' and is_admin());

drop policy if exists social_media_storage_delete on storage.objects;
create policy social_media_storage_delete on storage.objects
  for delete using (bucket_id = 'social-media' and is_admin());
