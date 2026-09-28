-- Phase 48 — סטודיו רילז בטאב ניהול סושיאל, 2026-09-28.
--
-- להרצה ב-Supabase SQL Editor אחרי phase45. בטוח להריץ שוב (idempotent).
--
--  1. social_posts: תמיכה ברילז (וידאו + קאבר + קונטיינר אינסטגרם בין ריצות Autopilot).
--  2. פרופיל מוצר בקטלוג (scents / device_models) — הנתונים שהמודל כותב עליהם.
--  3. ניקוי: הסרת כל מה שנוצר ל"קלרה" (phase46/47). בלי נתונים עסקיים — רק טבלאות ריקות שלה.

/* ============================== 1. social_posts: רילז ============================== */

alter table public.social_posts
  add column if not exists media_kind text not null default 'image',
  add column if not exists video_url text,
  add column if not exists cover_url text,
  add column if not exists ig_container_id text,
  add column if not exists ig_container_at timestamptz,
  add column if not exists source text not null default 'manual';

alter table public.social_posts drop constraint if exists social_posts_media_kind_check;
alter table public.social_posts add constraint social_posts_media_kind_check check (media_kind in ('image', 'reel'));
alter table public.social_posts drop constraint if exists social_posts_reel_has_video;
alter table public.social_posts add constraint social_posts_reel_has_video check (media_kind <> 'reel' or video_url is not null);

-- ה-Autopilot כותב גם את שדות הקונטיינר של הרילז (בדיקת סטטוס עיבוד בין ריצות).
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
    attempts           = case when p ? 'attempts'           then (p->>'attempts')::int             else attempts end,
    ig_container_id    = case when p ? 'ig_container_id'    then p->>'ig_container_id'             else ig_container_id end,
    ig_container_at    = case when p ? 'ig_container_at'    then (p->>'ig_container_at')::timestamptz else ig_container_at end
  where id = p_id;
end $$;

/* ============================== 2. פרופיל מוצר ============================== */

alter table public.scents
  add column if not exists description text,
  add column if not exists notes_top text,
  add column if not exists notes_heart text,
  add column if not exists notes_base text,
  add column if not exists mood text,
  add column if not exists best_for text;

alter table public.device_models
  add column if not exists description text,
  add column if not exists coverage_m2 int check (coverage_m2 is null or coverage_m2 > 0),
  add column if not exists features text,
  add column if not exists best_for text;

/* ============================== 3. ניקוי "קלרה" ============================== */

drop trigger if exists social_posts_clara_sync on public.social_posts;
alter table public.social_posts drop column if exists clara_content_id;

drop table if exists public.clara_messages cascade;
drop table if exists public.clara_content cascade;
drop table if exists public.clara_batches cascade;
drop table if exists public.clara_assets cascade;
drop table if exists public.clara_settings cascade;

drop function if exists public.clara_sync_from_social();
drop function if exists public.clara_notify_push();
drop function if exists public.clara_content_guard();
drop function if exists public.clara_next_slot(timestamptz, date);
drop function if exists public.clara_status();
drop function if exists public.clara_save_settings(text, text, text, int, int);
drop function if exists public.clara_credentials();

drop policy if exists clara_assets_storage_insert on storage.objects;
drop policy if exists clara_assets_storage_delete on storage.objects;

notify pgrst, 'reload schema';
