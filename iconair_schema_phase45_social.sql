-- Phase 45 — ניהול סושיאל וקמפיינים ("Autopilot"), 2026-09-27.
--
-- קובץ אחד, להרצה אחת ב-Supabase SQL Editor. בטוח להריץ שוב ושוב
-- (idempotent) — גם אם גרסה קודמת של phase45 כבר רצה.
--
-- מה נבנה כאן:
--   1. social_posts     — תור התוכן: טקסט, מדיה (עד 10 תמונות = קרוסלה),
--                          פלטפורמות, תזמון, סטטוס וביצועים לכל פלטפורמה.
--   2. social_settings  — שורה אחת: חיבור Meta (App, טוקנים, עמוד, אינסטגרם,
--                          חשבון מודעות). סגורה לגמרי ב-RLS — אין גישה ישירה
--                          מהדפדפן; רק דרך פונקציות security definer למטה.
--   3. Autopilot        — pg_cron מריץ כל דקה בדיקה: אם יש פוסט שהגיע זמנו
--                          (או שעברו 30 דק' לרענון ביצועים) הוא קורא ל-
--                          /api/social עם סוד פנימי. תזמון אמיתי, גם כשהמערכת
--                          סגורה, לפייסבוק ולאינסטגרם כאחד.
--   4. bucket ציבורי social-media — Meta מושכת תמונות מ-URL ציבורי בלבד.

create extension if not exists pg_net;
create extension if not exists pg_cron;

/* ============================== social_posts ============================== */

create table if not exists public.social_posts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) default auth.uid(),
  caption text not null default '',
  link_url text,
  is_draft boolean not null default true,
  scheduled_at timestamptz,
  published_at timestamptz,
  fb_status text,
  ig_status text,
  fb_post_id text,
  ig_media_id text,
  fb_error text,
  ig_error text,
  publish_lock timestamptz
);

alter table public.social_posts
  add column if not exists media_urls text[] not null default '{}',
  add column if not exists fb_permalink text,
  add column if not exists ig_permalink text,
  add column if not exists fb_metrics jsonb,
  add column if not exists ig_metrics jsonb,
  add column if not exists metrics_updated_at timestamptz,
  add column if not exists boosted_campaign_id text,
  add column if not exists attempts int not null default 0;

-- גרסה קודמת החזיקה תמונה אחת ב-image_url — מעבירים ל-media_urls ומסירים.
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'social_posts' and column_name = 'image_url') then
    update public.social_posts set media_urls = array[image_url]
      where image_url is not null and coalesce(array_length(media_urls, 1), 0) = 0;
    alter table public.social_posts drop column image_url;
  end if;
end $$;

-- תזמון נייטיבי של פייסבוק (גרסה קודמת) הוחלף ב-Autopilot — מחזירים לתור
-- (לפני הוספת ה-check החדש, שלא כולל 'scheduled').
update public.social_posts set fb_status = 'pending' where fb_status = 'scheduled';

alter table public.social_posts drop constraint if exists social_posts_fb_status_check;
alter table public.social_posts add constraint social_posts_fb_status_check
  check (fb_status in ('pending', 'published', 'failed'));
alter table public.social_posts drop constraint if exists social_posts_ig_status_check;
alter table public.social_posts add constraint social_posts_ig_status_check
  check (ig_status in ('pending', 'published', 'failed'));
alter table public.social_posts drop constraint if exists social_posts_has_platform;
alter table public.social_posts add constraint social_posts_has_platform
  check (fb_status is not null or ig_status is not null);
alter table public.social_posts drop constraint if exists social_posts_media_limit;
alter table public.social_posts add constraint social_posts_media_limit
  check (coalesce(array_length(media_urls, 1), 0) <= 10);

create index if not exists social_posts_created_at_idx on public.social_posts (created_at desc);
create index if not exists social_posts_scheduled_idx on public.social_posts (scheduled_at) where scheduled_at is not null;
create index if not exists social_posts_due_idx on public.social_posts (scheduled_at)
  where is_draft = false and (fb_status = 'pending' or ig_status = 'pending');

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

/* ============================== social_settings ============================== */

create table if not exists public.social_settings (
  id int primary key default 1 check (id = 1),
  app_id text,
  app_secret text,
  user_token text,
  user_token_expires_at timestamptz,
  pages jsonb not null default '[]',        -- [{id,name,access_token,ig_user_id,ig_username,picture}]
  ad_accounts jsonb not null default '[]',  -- [{id,name,currency,account_status}]
  page_id text,
  page_name text,
  page_picture text,
  page_token text,
  ig_user_id text,
  ig_username text,
  ad_account_id text,
  ad_account_name text,
  currency text,
  connected_at timestamptz,
  connected_by uuid,
  oauth_state text,
  oauth_state_at timestamptz,
  cron_secret text not null default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  last_run_at timestamptz,
  last_metrics_at timestamptz,
  last_error text
);

insert into public.social_settings (id) values (1) on conflict (id) do nothing;

-- RLS בלי אף policy = אין גישה ישירה לאף אחד (גם לא למנהל) מה-API הרגיל.
-- הכל עובר דרך הפונקציות למטה.
alter table public.social_settings enable row level security;

/* ------------------------------ פונקציות מנהל ------------------------------ */

create or replace function public.social_status()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s public.social_settings;
begin
  if not is_admin() then raise exception 'admin only'; end if;
  select * into s from public.social_settings where id = 1;
  return jsonb_build_object(
    'app_configured', s.app_id is not null and s.app_secret is not null,
    'app_id', s.app_id,
    'connected', s.page_token is not null,
    'user_connected', s.user_token is not null,
    'page_id', s.page_id, 'page_name', s.page_name, 'page_picture', s.page_picture,
    'ig_user_id', s.ig_user_id, 'ig_username', s.ig_username,
    'ad_account_id', s.ad_account_id, 'ad_account_name', s.ad_account_name, 'currency', s.currency,
    'connected_at', s.connected_at,
    'user_token_expires_at', s.user_token_expires_at,
    'pages', coalesce((select jsonb_agg(p - 'access_token') from jsonb_array_elements(s.pages) p), '[]'),
    'ad_accounts', s.ad_accounts,
    'last_run_at', s.last_run_at,
    'last_metrics_at', s.last_metrics_at,
    'last_error', s.last_error,
    'autopilot', exists (select 1 from cron.job where jobname = 'iconair-social-autopilot')
  );
end $$;

create or replace function public.social_save_app(p_app_id text, p_app_secret text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'admin only'; end if;
  update public.social_settings
     set app_id = nullif(trim(p_app_id), ''),
         app_secret = coalesce(nullif(trim(p_app_secret), ''), app_secret)
   where id = 1;
end $$;

create or replace function public.social_begin_oauth()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_state text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''); v_app text;
begin
  if not is_admin() then raise exception 'admin only'; end if;
  update public.social_settings set oauth_state = v_state, oauth_state_at = now(), connected_by = auth.uid()
   where id = 1 returning app_id into v_app;
  if v_app is null then raise exception 'meta app not configured'; end if;
  return jsonb_build_object('state', v_state, 'app_id', v_app);
end $$;

create or replace function public.social_select_assets(p_page_id text, p_ad_account_id text)
returns void language plpgsql security definer set search_path = public as $$
declare s public.social_settings; v_page jsonb; v_ad jsonb;
begin
  if not is_admin() then raise exception 'admin only'; end if;
  select * into s from public.social_settings where id = 1;
  if p_page_id is not null then
    select p into v_page from jsonb_array_elements(s.pages) p where p->>'id' = p_page_id limit 1;
    if v_page is null then raise exception 'page not found'; end if;
    update public.social_settings set
      page_id = v_page->>'id', page_name = v_page->>'name', page_picture = v_page->>'picture',
      page_token = v_page->>'access_token',
      ig_user_id = v_page->>'ig_user_id', ig_username = v_page->>'ig_username'
    where id = 1;
  end if;
  if p_ad_account_id is not null then
    select a into v_ad from jsonb_array_elements(s.ad_accounts) a where a->>'id' = p_ad_account_id limit 1;
    update public.social_settings set
      ad_account_id = v_ad->>'id', ad_account_name = v_ad->>'name', currency = v_ad->>'currency'
    where id = 1;
  end if;
end $$;

create or replace function public.social_disconnect()
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'admin only'; end if;
  update public.social_settings set
    user_token = null, user_token_expires_at = null, pages = '[]', ad_accounts = '[]',
    page_id = null, page_name = null, page_picture = null, page_token = null,
    ig_user_id = null, ig_username = null, ad_account_id = null, ad_account_name = null,
    currency = null, connected_at = null, last_error = null
  where id = 1;
end $$;

-- הטוקנים עצמם — רק לשרת (api/social.js) בשם מנהל מחובר.
create or replace function public.social_credentials()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s public.social_settings;
begin
  if not is_admin() then raise exception 'admin only'; end if;
  select * into s from public.social_settings where id = 1;
  return to_jsonb(s) - 'oauth_state' - 'pages' - 'cron_secret';
end $$;

/* --------------------------- OAuth (דפדפן → Meta → שרת) --------------------------- */
-- נקראות מה-callback של Meta, בלי משתמש מחובר. ה-state הוא אקראי, חד-פעמי
-- ותקף 15 דקות — הוא ההרשאה.

create or replace function public.social_oauth_context(p_state text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s public.social_settings;
begin
  select * into s from public.social_settings where id = 1;
  if p_state is null or s.oauth_state is distinct from p_state or s.oauth_state_at < now() - interval '15 minutes' then
    raise exception 'invalid state';
  end if;
  return jsonb_build_object('app_id', s.app_id, 'app_secret', s.app_secret);
end $$;

create or replace function public.social_oauth_finish(
  p_state text, p_user_token text, p_expires_at timestamptz, p_pages jsonb, p_ad_accounts jsonb
) returns void language plpgsql security definer set search_path = public as $$
declare s public.social_settings; v_page jsonb; v_ad jsonb;
begin
  select * into s from public.social_settings where id = 1;
  if p_state is null or s.oauth_state is distinct from p_state or s.oauth_state_at < now() - interval '15 minutes' then
    raise exception 'invalid state';
  end if;

  -- שומרים על הבחירה הקודמת אם העמוד/החשבון עדיין קיימים; אחרת הראשון ברשימה.
  select p into v_page from jsonb_array_elements(p_pages) p where p->>'id' = s.page_id limit 1;
  if v_page is null then v_page := p_pages->0; end if;
  select a into v_ad from jsonb_array_elements(p_ad_accounts) a where a->>'id' = s.ad_account_id limit 1;
  if v_ad is null then
    select a into v_ad from jsonb_array_elements(p_ad_accounts) a where (a->>'account_status')::int = 1 limit 1;
  end if;
  if v_ad is null then v_ad := p_ad_accounts->0; end if;

  update public.social_settings set
    user_token = p_user_token, user_token_expires_at = p_expires_at,
    pages = coalesce(p_pages, '[]'), ad_accounts = coalesce(p_ad_accounts, '[]'),
    page_id = v_page->>'id', page_name = v_page->>'name', page_picture = v_page->>'picture',
    page_token = v_page->>'access_token',
    ig_user_id = v_page->>'ig_user_id', ig_username = v_page->>'ig_username',
    ad_account_id = v_ad->>'id', ad_account_name = v_ad->>'name', currency = v_ad->>'currency',
    connected_at = now(), oauth_state = null, oauth_state_at = null, last_error = null
  where id = 1;
end $$;

/* ------------------------------ Autopilot (cron) ------------------------------ */
-- נקראות ע"י api/social.js כשהוא מופעל מ-pg_cron. ההרשאה: cron_secret, שיושב
-- רק ב-DB ונשלח ע"י ה-cron עצמו.

create or replace function public.social_cron_credentials(p_secret text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.social_settings;
begin
  select * into s from public.social_settings where id = 1;
  if p_secret is null or p_secret <> s.cron_secret then raise exception 'forbidden'; end if;
  update public.social_settings set last_run_at = now() where id = 1;
  return to_jsonb(s) - 'oauth_state' - 'pages' - 'cron_secret';
end $$;

create or replace function public.social_cron_claim_due(p_secret text)
returns setof public.social_posts language plpgsql security definer set search_path = public as $$
begin
  if p_secret is null or p_secret <> (select cron_secret from public.social_settings where id = 1) then
    raise exception 'forbidden';
  end if;
  return query
    update public.social_posts set publish_lock = now()
     where id in (
       select id from public.social_posts
        where is_draft = false
          and (fb_status = 'pending' or ig_status = 'pending')
          and coalesce(scheduled_at, created_at) <= now() + interval '30 seconds'
          and (publish_lock is null or publish_lock < now() - interval '3 minutes')
          and attempts < 5
        order by coalesce(scheduled_at, created_at)
        limit 10
        for update skip locked)
    returning *;
end $$;

create or replace function public.social_cron_recent(p_secret text)
returns setof public.social_posts language plpgsql security definer set search_path = public as $$
begin
  if p_secret is null or p_secret <> (select cron_secret from public.social_settings where id = 1) then
    raise exception 'forbidden';
  end if;
  update public.social_settings set last_metrics_at = now() where id = 1;
  return query
    select * from public.social_posts
     where published_at > now() - interval '30 days'
       and (fb_post_id is not null or ig_media_id is not null)
     order by published_at desc limit 40;
end $$;

create or replace function public.social_cron_update(p_secret text, p_id uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_secret is null or p_secret <> (select cron_secret from public.social_settings where id = 1) then
    raise exception 'forbidden';
  end if;
  update public.social_posts set
    fb_status          = case when p ? 'fb_status'          then p->>'fb_status'                   else fb_status end,
    ig_status          = case when p ? 'ig_status'          then p->>'ig_status'                   else ig_status end,
    fb_post_id         = case when p ? 'fb_post_id'         then p->>'fb_post_id'                  else fb_post_id end,
    ig_media_id        = case when p ? 'ig_media_id'        then p->>'ig_media_id'                 else ig_media_id end,
    fb_error           = case when p ? 'fb_error'           then p->>'fb_error'                    else fb_error end,
    ig_error           = case when p ? 'ig_error'           then p->>'ig_error'                    else ig_error end,
    fb_permalink       = case when p ? 'fb_permalink'       then p->>'fb_permalink'                else fb_permalink end,
    ig_permalink       = case when p ? 'ig_permalink'       then p->>'ig_permalink'                else ig_permalink end,
    fb_metrics         = case when p ? 'fb_metrics'         then p->'fb_metrics'                   else fb_metrics end,
    ig_metrics         = case when p ? 'ig_metrics'         then p->'ig_metrics'                   else ig_metrics end,
    metrics_updated_at = case when p ? 'metrics_updated_at' then (p->>'metrics_updated_at')::timestamptz else metrics_updated_at end,
    published_at       = case when p ? 'published_at'       then (p->>'published_at')::timestamptz else published_at end,
    publish_lock       = case when p ? 'publish_lock'       then (p->>'publish_lock')::timestamptz else publish_lock end,
    attempts           = case when p ? 'attempts'           then (p->>'attempts')::int             else attempts end
  where id = p_id;
end $$;

create or replace function public.social_cron_error(p_secret text, p_error text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_secret is null or p_secret <> (select cron_secret from public.social_settings where id = 1) then
    raise exception 'forbidden';
  end if;
  update public.social_settings set last_error = p_error where id = 1;
end $$;

revoke all on function public.social_oauth_context(text) from public;
revoke all on function public.social_oauth_finish(text, text, timestamptz, jsonb, jsonb) from public;
revoke all on function public.social_cron_credentials(text) from public;
revoke all on function public.social_cron_claim_due(text) from public;
revoke all on function public.social_cron_recent(text) from public;
revoke all on function public.social_cron_update(text, uuid, jsonb) from public;
revoke all on function public.social_cron_error(text, text) from public;
grant execute on function public.social_oauth_context(text) to anon, authenticated;
grant execute on function public.social_oauth_finish(text, text, timestamptz, jsonb, jsonb) to anon, authenticated;
grant execute on function public.social_cron_credentials(text) to anon, authenticated;
grant execute on function public.social_cron_claim_due(text) to anon, authenticated;
grant execute on function public.social_cron_recent(text) to anon, authenticated;
grant execute on function public.social_cron_update(text, uuid, jsonb) to anon, authenticated;
grant execute on function public.social_cron_error(text, text) to anon, authenticated;
grant execute on function public.social_status() to authenticated;
grant execute on function public.social_save_app(text, text) to authenticated;
grant execute on function public.social_begin_oauth() to authenticated;
grant execute on function public.social_select_assets(text, text) to authenticated;
grant execute on function public.social_disconnect() to authenticated;
grant execute on function public.social_credentials() to authenticated;

/* ------------------------------ ה-cron עצמו ------------------------------ */
-- כל דקה, אבל קורא לשרת רק כשיש סיבה: פוסט שהגיע זמנו, או רענון ביצועים
-- כל 30 דקות. כך אין מאות קריאות סרק ל-Vercel.

create or replace function public.social_autopilot_tick()
returns void language plpgsql security definer set search_path = public as $$
declare s public.social_settings; v_due boolean; v_metrics boolean;
begin
  select * into s from public.social_settings where id = 1;
  if s.page_token is null then return; end if;

  select exists (
    select 1 from public.social_posts
     where is_draft = false and (fb_status = 'pending' or ig_status = 'pending')
       and coalesce(scheduled_at, created_at) <= now() + interval '30 seconds'
       and (publish_lock is null or publish_lock < now() - interval '3 minutes')
       and attempts < 5
  ) into v_due;
  v_metrics := s.last_metrics_at is null or s.last_metrics_at < now() - interval '30 minutes';

  if v_due or v_metrics then
    perform net.http_post(
      url := 'https://iconair-system-new.vercel.app/api/social',
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body := jsonb_build_object('action', 'cron', 'secret', s.cron_secret, 'metrics', v_metrics),
      timeout_milliseconds := 60000
    );
  end if;
end $$;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'iconair-social-autopilot') then
    perform cron.unschedule('iconair-social-autopilot');
  end if;
  perform cron.schedule('iconair-social-autopilot', '* * * * *', 'select public.social_autopilot_tick()');
end $$;

/* ------------------------------ Storage ------------------------------ */

insert into storage.buckets (id, name, public)
values ('social-media', 'social-media', true)
on conflict (id) do nothing;

drop policy if exists social_media_storage_insert on storage.objects;
create policy social_media_storage_insert on storage.objects
  for insert with check (bucket_id = 'social-media' and is_admin());
drop policy if exists social_media_storage_delete on storage.objects;
create policy social_media_storage_delete on storage.objects
  for delete using (bucket_id = 'social-media' and is_admin());
