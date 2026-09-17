-- Phase 41 — 2026-09-17, בקשה מפורשת: התראה מיידית למנהל כשנכנס ליד
-- חדש. לא אינטגרציה חדשה — שימוש חוזר בתשתית ה-Push הקיימת (VAPID
-- keys + push_subscriptions + /api/send-push), אותו מנגנון בדיוק כמו
-- notify_visit_completed (phase33). כשל בשליחת ה-push (למשל עדיין אין
-- מנוי רשום, או מפתחות VAPID לא מוגדרים) לא אמור לחסום את הכנסת הליד
-- עצמו (במיוחד חשוב פה כי ה-INSERT מגיע מ-Make.com, לא ממישהו שיושב
-- ורואה הודעת שגיאה) — לכן exception handler שמבליע ולא זורק, בדיוק
-- כמו במקור.
create or replace function public.notify_new_lead()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_settings public.notification_settings;
  v_private_key text;
  v_subs jsonb;
  v_city text;
begin
  select * into v_settings from public.notification_settings where id = true;

  if v_settings.vapid_public_key is not null and v_settings.vapid_public_key <> '' then
    select decrypted_secret into v_private_key
      from vault.decrypted_secrets where name = 'vapid_private_key' limit 1;

    if v_private_key is not null and v_private_key <> '' then
      select jsonb_agg(jsonb_build_object('endpoint', endpoint, 'keys', jsonb_build_object('p256dh', p256dh, 'auth', auth)))
        into v_subs
        from public.push_subscriptions ps
        join public.profiles p on p.id = ps.user_id
       where p.role = 'admin';

      if v_subs is not null and jsonb_array_length(v_subs) > 0 then
        -- ר' dedupeRepeatedText ב-mappers.js: city שמגיע מ-Make.com
        -- לפעמים מוכפל בלי רווח ("Kiryat ataKiryat ata") — אותו תיקון
        -- תצוגה, רק בצד ה-SQL כי הפוש נשלח מכאן, לא מה-frontend.
        v_city := new.city;
        if v_city is not null and length(v_city) % 2 = 0
           and left(v_city, length(v_city) / 2) = right(v_city, length(v_city) / 2) then
          v_city := left(v_city, length(v_city) / 2);
        end if;

        perform net.http_post(
          url := 'https://iconair-system-new.vercel.app/api/send-push',
          headers := jsonb_build_object('Content-Type', 'application/json'),
          body := jsonb_build_object(
            'subscriptions', v_subs,
            'vapidPublicKey', v_settings.vapid_public_key,
            'vapidPrivateKey', v_private_key,
            'vapidSubject', coalesce(v_settings.vapid_subject, 'mailto:iconairisrael@gmail.com'),
            'title', 'ICON AIR — ליד חדש מקמפיין',
            'body', format(
              '%s%s%s',
              coalesce(new.full_name, 'ליד חדש'),
              case when v_city is not null and v_city <> '' then format(' · %s', v_city) else '' end,
              case when new.phone is not null and new.phone <> '' then format(' · %s', new.phone) else '' end
            ),
            'url', '/'
          )
        );
      end if;
    end if;
  end if;

  return new;
exception when others then
  raise warning 'notify_new_lead נכשל עבור leads.id=%: %', new.id, sqlerrm;
  return new;
end;
$function$;

drop trigger if exists leads_notify_new_lead on public.leads;
create trigger leads_notify_new_lead
  after insert on public.leads
  for each row execute function public.notify_new_lead();
