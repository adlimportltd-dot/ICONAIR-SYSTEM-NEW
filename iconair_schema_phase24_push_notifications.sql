-- ---------------------------------------------------------------------
--  שלב 24 — התראות Web Push אמיתיות למנהלים בסיום ביקור בשטח.
--
--  ⚠ ארכיטקטורה, ולמה: שליחת Web Push אמיתית דורשת חתימת VAPID
--  (ECDSA P-256) והצפנת מטען (RFC 8291, ECDH+HKDF+AES-128-GCM) — קריפטו
--  שאין לו תמיכה מעשית ב-plpgsql/pgcrypto. זה חייב סביבת Node/JS.
--  אין לי גישה ל-Supabase CLI לפריסת Edge Function (כבר תועד קודם),
--  אבל יש ל-Vercel זיהוי-אפס-קונפיג מובנה לתיקיית /api כ-Serverless
--  Functions — נפרס משם דרך אותו git push שכבר עובד, בלי CLI. הטריגר
--  הקיים על service_reports (ר' phase22/23) קורא עכשיו גם ל-endpoint
--  הזה, באותו pg_net אסינכרוני — לא חוסם את הטכנאי, בדיוק כמו קריאת
--  Resend הקיימת.
--
--  ⚠ מפתח ה-VAPID הפרטי: יצרתי אותו בעצמי (זוג מפתחות ECDSA שאני מייצר
--  עבור המערכת הזו — לא סוד של צד-שלישי כמו Resend, אין חשבון חיצוני
--  להירשם אליו) ושמרתי מוצפן ב-Vault, באותו דפוס בדיוק כמו resend_api_key.
--  המפתח הציבורי אינו סוד מטבעו (לכן זה שמו) — מאוחסן כטור רגיל.
-- ---------------------------------------------------------------------

alter table public.notification_settings
  add column if not exists vapid_public_key text,
  add column if not exists vapid_subject text default 'mailto:iconairisrael@gmail.com';

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now(),
  unique (endpoint)
);

create index if not exists push_subscriptions_user_id_idx on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

drop policy if exists push_subscriptions_select on public.push_subscriptions;
create policy push_subscriptions_select on public.push_subscriptions
  for select using (user_id = auth.uid() or is_admin());

drop policy if exists push_subscriptions_insert on public.push_subscriptions;
create policy push_subscriptions_insert on public.push_subscriptions
  for insert with check (user_id = auth.uid());

-- מאפשר upsert(onConflict: endpoint) כשאותו דפדפן נרשם שוב (למשל אחרי
-- שהמפתחות התחדשו) — בלי זה, ה-insert...on conflict do update היה
-- נכשל על ה-RLS בשקט.
drop policy if exists push_subscriptions_update on public.push_subscriptions;
create policy push_subscriptions_update on public.push_subscriptions
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists push_subscriptions_delete on public.push_subscriptions;
create policy push_subscriptions_delete on public.push_subscriptions
  for delete using (user_id = auth.uid() or is_admin());

-- שולח Web Push לכל מנהל שרשום, על סמך service_reports שנוצר. נקרא מתוך
-- אותו טריגר AFTER INSERT הקיים (send_service_report_email) — ר' עדכון
-- הפונקציה הזו בהמשך הקובץ.
create or replace function public.send_service_report_push(r public.service_reports)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_settings public.notification_settings;
  v_private_key text;
  v_subs jsonb;
  v_event_label text;
begin
  select * into v_settings from public.notification_settings where id = true;
  if v_settings.vapid_public_key is null or v_settings.vapid_public_key = '' then
    return; -- לא הוגדרו מפתחות VAPID עדיין
  end if;

  select decrypted_secret into v_private_key
    from vault.decrypted_secrets
   where name = 'vapid_private_key'
   limit 1;
  if v_private_key is null or v_private_key = '' then
    return;
  end if;

  select jsonb_agg(jsonb_build_object('endpoint', endpoint, 'keys', jsonb_build_object('p256dh', p256dh, 'auth', auth)))
    into v_subs
    from public.push_subscriptions ps
    join public.profiles p on p.id = ps.user_id
   where p.role = 'admin';

  if v_subs is null or jsonb_array_length(v_subs) = 0 then
    return; -- אף מנהל לא נרשם עדיין להתראות בטלפון
  end if;

  v_event_label := case r.event_type
    when 'refill' then 'מילוי'
    when 'replacement' then 'החלפת מכל'
    when 'reading' then 'קריאת מד'
    else r.event_type::text
  end;

  perform net.http_post(
    url := 'https://iconair-system-new.vercel.app/api/send-push',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object(
      'subscriptions', v_subs,
      'vapidPublicKey', v_settings.vapid_public_key,
      'vapidPrivateKey', v_private_key,
      'vapidSubject', coalesce(v_settings.vapid_subject, 'mailto:iconairisrael@gmail.com'),
      'title', 'ICON AIR — ביקור הושלם',
      'body', format('הטכנאי %s סיים ביקור אצל %s (%s)', coalesce(r.technician_name, 'טכנאי'), r.customer_name, v_event_label),
      'url', '/'
    )
  );
end;
$$;

create or replace function public.send_service_report_email()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_settings public.notification_settings;
begin
  select * into v_settings from public.notification_settings where id = true;

  if v_settings.admin_email is not null and v_settings.admin_email <> '' then
    begin
      perform public.send_resend_email(
        array[v_settings.admin_email],
        null,
        'דוח שירות ICON AIR — ' || new.customer_name,
        public.build_service_report_html(new)
      );
    exception when others then
      raise warning 'send_service_report_email (mail) נכשל עבור service_reports.id=%: %', new.id, sqlerrm;
    end;
  end if;

  begin
    perform public.send_service_report_push(new);
  exception when others then
    raise warning 'send_service_report_push נכשל עבור service_reports.id=%: %', new.id, sqlerrm;
  end;

  return new;
end;
$$;
