-- Phase 46 — "קלרה" (Clara): סוכנת שיווק אוטונומית בתוך מערכת ICONAIR, 2026-09-28.
--
-- קובץ אחד, להרצה ב-Supabase SQL Editor אחרי phase45. בטוח להריץ שוב (idempotent).
--
-- הזרימה:
--   1. clara_assets    — תמונות/סרטונים גולמיים מהשטח (+ זמן, סניף, הערות).
--   2. clara_batches   — "משימה" לקלרה: קבוצת נכסים + הנחיה → יצירה ע"י Claude.
--   3. clara_content   — כל תוצר (רילז/פוסט/קרוסלה) עם מכונת-מצבים מאוכפת:
--        draft → pending_approval → approved → scheduled → published
--        (+ rejected, failed, וחזרה ל-draft כשמבקשים שינוי)
--   4. clara_messages  — שיחת "וואטסאפ" עם קלרה בתוך ה-CRM (+ Push לטלפון).
--   5. תור הפרסום      — clara_content שאושר הופך לשורה ב-social_posts, וה-Autopilot
--                        של phase45 מפרסם אותה. clara_next_slot() בוחר שעה לפי
--                        חלונות הקהל הפעיל בישראל, עם מרווחים ותקרה יומית.
--
-- מפתח ה-API של Anthropic נשמר ב-clara_settings (סגורה ב-RLS, גישה רק דרך
-- פונקציות security definer) — אותה תבנית בדיוק כמו social_settings.

/* ============================== social_posts: רילז ============================== */

alter table public.social_posts
  add column if not exists media_kind text not null default 'image',
  add column if not exists video_url text,
  add column if not exists cover_url text,
  add column if not exists ig_container_id text,
  add column if not exists ig_container_at timestamptz,
  add column if not exists source text not null default 'manual',
  add column if not exists clara_content_id uuid;

alter table public.social_posts drop constraint if exists social_posts_media_kind_check;
alter table public.social_posts add constraint social_posts_media_kind_check check (media_kind in ('image', 'reel'));
alter table public.social_posts drop constraint if exists social_posts_reel_has_video;
alter table public.social_posts add constraint social_posts_reel_has_video check (media_kind <> 'reel' or video_url is not null);

-- ה-cron צריך לכתוב גם את שדות הקונטיינר של הרילז (בדיקת סטטוס בין ריצות).
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

/* ============================== clara_settings ============================== */

create table if not exists public.clara_settings (
  id int primary key default 1 check (id = 1),
  anthropic_key text,
  model text not null default 'claude-sonnet-5',
  brand_notes text not null default '',
  max_posts_per_day int not null default 2 check (max_posts_per_day between 1 and 6),
  min_gap_hours int not null default 4 check (min_gap_hours between 1 and 24),
  updated_at timestamptz not null default now()
);
insert into public.clara_settings (id) values (1) on conflict (id) do nothing;
alter table public.clara_settings enable row level security; -- בלי policies: גישה רק דרך הפונקציות

create or replace function public.clara_status()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s public.clara_settings;
begin
  if not is_admin() then raise exception 'admin only'; end if;
  select * into s from public.clara_settings where id = 1;
  return jsonb_build_object(
    'ai_configured', s.anthropic_key is not null,
    'key_hint', case when s.anthropic_key is null then null else '…' || right(s.anthropic_key, 4) end,
    'model', s.model, 'brand_notes', s.brand_notes,
    'max_posts_per_day', s.max_posts_per_day, 'min_gap_hours', s.min_gap_hours
  );
end $$;

create or replace function public.clara_save_settings(
  p_key text, p_model text, p_brand_notes text, p_max_per_day int, p_min_gap int
) returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'admin only'; end if;
  update public.clara_settings set
    anthropic_key     = coalesce(nullif(trim(p_key), ''), anthropic_key),
    model             = coalesce(nullif(trim(p_model), ''), model),
    brand_notes       = coalesce(p_brand_notes, brand_notes),
    max_posts_per_day = coalesce(p_max_per_day, max_posts_per_day),
    min_gap_hours     = coalesce(p_min_gap, min_gap_hours),
    updated_at        = now()
  where id = 1;
end $$;

-- למפתח עצמו — רק השרת (api/clara.ts) בשם מנהל מחובר.
create or replace function public.clara_credentials()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s public.clara_settings;
begin
  if not is_admin() then raise exception 'admin only'; end if;
  select * into s from public.clara_settings where id = 1;
  return to_jsonb(s);
end $$;

/* ============================== clara_assets ============================== */

create table if not exists public.clara_assets (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) default auth.uid(),
  storage_path text not null unique,
  public_url text not null,
  thumb_url text,                       -- לסרטונים: פריים ראשון (Claude לא רואה וידאו)
  media_type text not null check (media_type in ('image', 'video')),
  mime_type text,
  width int, height int,
  duration_sec numeric(7, 2),
  size_bytes bigint,
  taken_at timestamptz,
  customer_site_id uuid references public.customer_sites(id) on delete set null,
  location_label text,
  notes text,
  tags text[] not null default '{}',
  analysis jsonb,                       -- מה קלרה "ראתה" בתמונה (נשמר לשימוש חוזר)
  archived boolean not null default false
);
create index if not exists clara_assets_created_idx on public.clara_assets (created_at desc);

alter table public.clara_assets enable row level security;
-- טכנאים יכולים להעלות מהשטח ולראות את מה שהעלו; מנהלים רואים ומנהלים הכל.
drop policy if exists clara_assets_select on public.clara_assets;
create policy clara_assets_select on public.clara_assets for select using (is_admin() or created_by = auth.uid());
drop policy if exists clara_assets_insert on public.clara_assets;
create policy clara_assets_insert on public.clara_assets for insert with check (created_by = auth.uid());
drop policy if exists clara_assets_update on public.clara_assets;
create policy clara_assets_update on public.clara_assets for update using (is_admin() or created_by = auth.uid()) with check (is_admin() or created_by = auth.uid());
drop policy if exists clara_assets_delete on public.clara_assets;
create policy clara_assets_delete on public.clara_assets for delete using (is_admin());

/* ============================== clara_batches ============================== */

create table if not exists public.clara_batches (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) default auth.uid(),
  asset_ids uuid[] not null,
  brief text not null default '',
  wanted jsonb not null default '{"reels": 2, "posts": 1}',
  status text not null default 'queued' check (status in ('queued', 'generating', 'ready', 'failed')),
  error text,
  model text,
  usage jsonb,
  constraint clara_batches_has_assets check (coalesce(array_length(asset_ids, 1), 0) between 1 and 20)
);
create index if not exists clara_batches_created_idx on public.clara_batches (created_at desc);

/* ============================== clara_content ============================== */

create table if not exists public.clara_content (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  batch_id uuid references public.clara_batches(id) on delete cascade,
  kind text not null check (kind in ('reel', 'post', 'carousel')),
  status text not null default 'draft'
    check (status in ('draft', 'pending_approval', 'approved', 'scheduled', 'published', 'rejected', 'failed')),
  title text not null default '',
  hook text not null default '',
  value_prop text not null default '',
  cta text not null default '',
  scenes jsonb not null default '[]',   -- [{asset_id, seconds, on_screen, voiceover}]
  voiceover text not null default '',
  caption text not null default '',
  hashtags text[] not null default '{}',
  asset_ids uuid[] not null default '{}',
  media_urls text[] not null default '{}', -- תמונות מוכנות-לפיד (JPEG מנורמל) לפוסט/קרוסלה
  video_url text,
  cover_url text,
  render_error text,
  platforms text[] not null default '{facebook,instagram}',
  revision int not null default 1,
  change_request text,
  scheduled_at timestamptz,
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  social_post_id uuid references public.social_posts(id) on delete set null,
  published_at timestamptz
);
alter table public.clara_content add column if not exists media_urls text[] not null default '{}';

create index if not exists clara_content_status_idx on public.clara_content (status, created_at desc);
create index if not exists clara_content_batch_idx on public.clara_content (batch_id);

-- מכונת המצבים נאכפת ב-DB, לא רק בממשק.
create or replace function public.clara_content_guard()
returns trigger language plpgsql as $$
declare ok boolean;
begin
  new.updated_at := now();
  if new.status = old.status then return new; end if;
  ok := case old.status
    when 'draft'            then new.status in ('pending_approval', 'rejected', 'failed')
    when 'pending_approval' then new.status in ('approved', 'draft', 'rejected', 'scheduled')
    when 'approved'         then new.status in ('scheduled', 'draft', 'rejected')
    when 'scheduled'        then new.status in ('published', 'failed', 'approved', 'pending_approval', 'draft')
    when 'failed'           then new.status in ('draft', 'scheduled', 'rejected')
    when 'rejected'         then new.status in ('draft')
    else false
  end;
  if not ok then
    raise exception 'מעבר סטטוס לא חוקי: % → %', old.status, new.status;
  end if;
  return new;
end $$;

drop trigger if exists clara_content_guard on public.clara_content;
create trigger clara_content_guard before update on public.clara_content
  for each row execute function public.clara_content_guard();

/* ============================== clara_messages ============================== */

create table if not exists public.clara_messages (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  role text not null check (role in ('clara', 'user')),
  body text not null,
  batch_id uuid references public.clara_batches(id) on delete cascade,
  content_ids uuid[] not null default '{}',
  actions jsonb not null default '[]',   -- [{id, label, kind}] — כפתורי תגובה
  action_taken text,
  notify boolean not null default false,
  created_by uuid default auth.uid()
);
create index if not exists clara_messages_created_idx on public.clara_messages (created_at);

/* ============================== RLS: מנהלים ============================== */

do $$
declare t text;
begin
  foreach t in array array['clara_batches', 'clara_content', 'clara_messages'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin', t);
    execute format('create policy %I on public.%I for all using (is_admin()) with check (is_admin())', t || '_admin', t);
  end loop;
end $$;

drop trigger if exists clara_batches_set_updated_at on public.clara_batches;
create trigger clara_batches_set_updated_at before update on public.clara_batches
  for each row execute function public.set_updated_at();

do $$
declare t text;
begin
  foreach t in array array['clara_assets', 'clara_batches', 'clara_content', 'clara_messages'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

/* ============================== תזמון חכם ============================== */
-- חלונות הקהל הפעיל (שעון ישראל). ראשון–חמישי: צהריים וערב; שישי: בוקר;
-- שבת: מוצ"ש. מדלגים על חלון שקרוב מדי לפוסט אחר (min_gap_hours) ועל
-- יום שכבר הגיע לתקרה (max_posts_per_day). תוצאה: timestamptz אמיתי.

create or replace function public.clara_next_slot(p_after timestamptz default now(), p_only_day date default null)
returns timestamptz language plpgsql stable security definer set search_path = public as $$
declare
  s public.clara_settings;
  d date;
  t time;
  cand timestamptz;
  slots time[];
  i int;
begin
  select * into s from public.clara_settings where id = 1;
  for i in 0..13 loop
    d := (p_after at time zone 'Asia/Jerusalem')::date + i;
    if p_only_day is not null and d <> p_only_day then continue; end if;
    slots := case extract(dow from d)::int
      when 5 then array['09:30', '12:00']::time[]            -- שישי
      when 6 then array['20:30', '21:30']::time[]            -- שבת (מוצ"ש)
      else array['12:30', '17:30', '20:30']::time[]          -- ראשון–חמישי
    end;
    if (select count(*) from public.social_posts sp
         where sp.is_draft = false
           and (coalesce(sp.scheduled_at, sp.published_at) at time zone 'Asia/Jerusalem')::date = d) >= s.max_posts_per_day then
      continue;
    end if;
    foreach t in array slots loop
      cand := (d + t) at time zone 'Asia/Jerusalem';
      if cand < p_after + interval '10 minutes' then continue; end if;
      if exists (select 1 from public.social_posts sp
                  where sp.is_draft = false
                    and coalesce(sp.scheduled_at, sp.published_at)
                        between cand - make_interval(hours => s.min_gap_hours)
                            and cand + make_interval(hours => s.min_gap_hours)) then
        continue;
      end if;
      return cand;
    end loop;
  end loop;
  -- הכל תפוס בשבועיים הקרובים — שעה פנויה פשוטה, לא נכשלים.
  return greatest(p_after + interval '1 hour', now() + interval '1 hour');
end $$;
grant execute on function public.clara_next_slot(timestamptz, date) to authenticated;

/* ============================== סנכרון פרסום → קלרה ============================== */
-- כשה-Autopilot מפרסם (או נכשל) בשורת social_posts שמקורה בקלרה, הסטטוס
-- של התוכן בקלרה מתעדכן לבד, ונכתבת הודעה בשיחה.

create or replace function public.clara_sync_from_social()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_all_done boolean; v_failed boolean;
begin
  if new.clara_content_id is null then return new; end if;
  v_all_done := (new.fb_status is null or new.fb_status = 'published') and (new.ig_status is null or new.ig_status = 'published');
  v_failed := new.fb_status = 'failed' or new.ig_status = 'failed';

  if v_all_done and (old.fb_status is distinct from new.fb_status or old.ig_status is distinct from new.ig_status) then
    update public.clara_content set status = 'published', published_at = coalesce(new.published_at, now())
     where id = new.clara_content_id and status = 'scheduled';
    insert into public.clara_messages (role, body, content_ids, notify, created_by)
    select 'clara', format('פורסם! "%s" עלה עכשיו%s.', c.title,
             case when new.ig_permalink is not null then ' לאינסטגרם' else '' end),
           array[c.id], true, null
      from public.clara_content c where c.id = new.clara_content_id;
  elsif v_failed and not (old.fb_status = 'failed' or old.ig_status = 'failed') then
    update public.clara_content set status = 'failed' where id = new.clara_content_id and status = 'scheduled';
    insert into public.clara_messages (role, body, content_ids, notify, actions, created_by)
    select 'clara', format('לא הצלחתי לפרסם את "%s": %s', c.title, coalesce(new.ig_error, new.fb_error, 'שגיאה')),
           array[c.id], true, '[{"id":"retry","label":"לנסות שוב","kind":"primary"}]'::jsonb, null
      from public.clara_content c where c.id = new.clara_content_id;
  end if;
  return new;
end $$;

drop trigger if exists social_posts_clara_sync on public.social_posts;
create trigger social_posts_clara_sync after update on public.social_posts
  for each row execute function public.clara_sync_from_social();

/* ============================== Push לטלפון ============================== */
-- הודעה מקלארה שמסומנת notify → Push לכל המנהלים, באותו מנגנון בדיוק כמו
-- phase24 (VAPID מ-notification_settings + Vault). כשל כאן לעולם לא מפיל
-- את ההכנסה עצמה.

create or replace function public.clara_notify_push()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_settings public.notification_settings;
  v_private_key text;
  v_subs jsonb;
begin
  if new.role <> 'clara' or not new.notify then return new; end if;
  select * into v_settings from public.notification_settings where id = true;
  if v_settings.vapid_public_key is null or v_settings.vapid_public_key = '' then return new; end if;
  select decrypted_secret into v_private_key from vault.decrypted_secrets where name = 'vapid_private_key' limit 1;
  if v_private_key is null or v_private_key = '' then return new; end if;

  select jsonb_agg(jsonb_build_object('endpoint', endpoint, 'keys', jsonb_build_object('p256dh', p256dh, 'auth', auth)))
    into v_subs
    from public.push_subscriptions ps join public.profiles p on p.id = ps.user_id
   where p.role = 'admin';
  if v_subs is null or jsonb_array_length(v_subs) = 0 then return new; end if;

  perform net.http_post(
    url := 'https://iconair-system-new.vercel.app/api/send-push',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object(
      'subscriptions', v_subs,
      'vapidPublicKey', v_settings.vapid_public_key,
      'vapidPrivateKey', v_private_key,
      'vapidSubject', coalesce(v_settings.vapid_subject, 'mailto:iconairltd@gmail.com'),
      'title', 'קלרה · ICONAIR',
      'body', left(new.body, 180),
      'url', '/?tab=social&clara=1'
    )
  );
  return new;
exception when others then
  raise warning 'clara_notify_push נכשל: %', sqlerrm;
  return new;
end $$;

drop trigger if exists clara_messages_push on public.clara_messages;
create trigger clara_messages_push after insert on public.clara_messages
  for each row execute function public.clara_notify_push();

/* ============================== הרשאות פונקציות ============================== */

grant execute on function public.clara_status() to authenticated;
grant execute on function public.clara_save_settings(text, text, text, int, int) to authenticated;
grant execute on function public.clara_credentials() to authenticated;

/* ============================== Storage ============================== */
-- bucket ציבורי: Claude ו-Meta מושכים מדיה מ-URL ציבורי. נתיב = uuid אקראי.

insert into storage.buckets (id, name, public)
values ('clara-assets', 'clara-assets', true)
on conflict (id) do nothing;

drop policy if exists clara_assets_storage_insert on storage.objects;
create policy clara_assets_storage_insert on storage.objects
  for insert with check (bucket_id = 'clara-assets' and auth.uid() is not null);
drop policy if exists clara_assets_storage_delete on storage.objects;
create policy clara_assets_storage_delete on storage.objects
  for delete using (bucket_id = 'clara-assets' and is_admin());
