import { useState } from 'react';
import GlassCard, { CardHead } from '../ui/GlassCard';
import { StatusChip } from '../ui/DataTable';
import { SettingsIcon } from '../ui/Icons';
import { Field, TextInput, Select, PrimaryButton, SecondaryButton } from '../ui/Field';
import { describeError } from '../../lib/supabase';
import { formatDateTime } from '../../lib/mappers';
import { saveMetaApp, startMetaOAuth, selectMetaAssets, disconnectMeta, SQL_FILE_URL, num } from '../../lib/social';

const SUPABASE_REF = (() => {
  try { return new URL(import.meta.env.VITE_SUPABASE_URL).hostname.split('.')[0]; } catch { return ''; }
})();

function Copy({ value, label }) {
  const [done, setDone] = useState(false);
  return (
    <div className="flex items-center gap-2 rounded-row border border-[#E2E8F0] bg-ink-800 px-3 py-2">
      <span className="min-w-0 flex-1 truncate font-mono text-[13px]" dir="ltr">{value}</span>
      <button type="button" className="ghost-btn !px-3 !py-1.5 text-[13px]"
        onClick={() => { navigator.clipboard?.writeText(value); setDone(true); setTimeout(() => setDone(false), 1500); }}>
        {done ? 'הועתק ✓' : label || 'העתקה'}
      </button>
    </div>
  );
}

function Step({ n, title, done, active, children }) {
  return (
    <div className={`rounded-row border p-4 sm:p-5 ${active ? 'border-gold-500/50 bg-gold-500/[0.04]' : 'border-[#E2E8F0] bg-white'}`}>
      <div className="flex items-center gap-3">
        <span className={`grid h-8 w-8 flex-none place-items-center rounded-full text-[14px] font-extrabold ${done ? 'bg-ok text-white' : active ? 'bg-gold-500 text-slate-950' : 'bg-ink-700 text-text-dim'}`}>
          {done ? '✓' : n}
        </span>
        <span className="font-display text-[17px] font-bold">{title}</span>
      </div>
      {active && <div className="mt-4 flex flex-col gap-3.5 ps-0 sm:ps-11">{children}</div>}
    </div>
  );
}

/** מסך הקמה חד-פעמי כשטבלאות הסושיאל עוד לא קיימות ב-Supabase */
export function SetupDatabase({ onRetry }) {
  const [state, setState] = useState(null);
  async function copySql() {
    setState('loading');
    try {
      const sql = await fetch(SQL_FILE_URL, { cache: 'no-store' }).then((r) => { if (!r.ok) throw new Error(); return r.text(); });
      await navigator.clipboard.writeText(sql);
      setState('copied');
    } catch {
      setState('failed');
    }
  }
  return (
    <GlassCard>
      <CardHead icon={SettingsIcon} tone="gold" title="הפעלה ראשונה — שלב אחד" subtitle="מקימים את מנוע הסושיאל במסד הנתונים (דקה אחת, פעם אחת)" />
      <ol className="flex flex-col gap-3 text-[15px] leading-relaxed">
        <li className="flex flex-wrap items-center gap-3">
          <span className="font-bold">1.</span>
          <PrimaryButton onClick={copySql} loading={state === 'loading'}>{state === 'copied' ? 'הקוד הועתק ✓' : 'העתק את קוד ההקמה'}</PrimaryButton>
          {state === 'failed' && <a className="text-[14px] font-semibold text-gold-600 hover:underline" href={SQL_FILE_URL} target="_blank" rel="noreferrer">פתח את הקובץ והעתק ידנית ↗</a>}
        </li>
        <li className="flex flex-wrap items-center gap-3">
          <span className="font-bold">2.</span>
          <a className="ghost-btn" href={SUPABASE_REF ? `https://supabase.com/dashboard/project/${SUPABASE_REF}/sql/new` : 'https://supabase.com/dashboard'} target="_blank" rel="noreferrer">
            פתח את Supabase SQL Editor ↗
          </a>
          <span className="text-text-dim">הדבק ולחץ <b>Run</b></span>
        </li>
        <li className="flex flex-wrap items-center gap-3">
          <span className="font-bold">3.</span>
          <SecondaryButton onClick={onRetry}>סיימתי — בדוק שוב</SecondaryButton>
        </li>
      </ol>
    </GlassCard>
  );
}

export default function ConnectPanel({ settings, live, onChanged, onToast }) {
  const [appId, setAppId] = useState(settings?.app_id ?? '');
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const redirect = `${window.location.origin}/api/social`;
  const host = window.location.host;

  const appReady = settings?.app_configured;
  const connected = settings?.connected;
  const active = !appReady ? 1 : !connected ? 2 : 3;

  async function run(kind, fn) {
    setBusy(kind);
    setError(null);
    try { await fn(); } catch (e) { setError(describeError(e)); } finally { setBusy(null); }
  }

  const saveApp = () => run('app', async () => {
    if (!/^\d{6,}$/.test(appId.trim())) throw new Error('App ID הוא מספר (בדרך כלל 15-16 ספרות)');
    if (!appReady && secret.trim().length < 16) throw new Error('App Secret חסר או קצר מדי');
    await saveMetaApp(appId.trim(), secret.trim());
    setSecret('');
    onToast({ message: 'פרטי האפליקציה נשמרו' });
    onChanged();
  });

  const connect = () => run('oauth', async () => { window.location.assign(await startMetaOAuth()); });

  const pick = (pageId, adId) => run('pick', async () => {
    await selectMetaAssets(pageId, adId);
    onToast({ message: 'עודכן' });
    onChanged();
  });

  const disconnect = () => run('disconnect', async () => {
    if (!window.confirm('לנתק את Meta? פוסטים מתוזמנים לא יעלו עד חיבור מחדש.')) return;
    await disconnectMeta();
    onToast({ message: 'Meta נותק' });
    onChanged();
  });

  return (
    <div className="flex flex-col gap-5">
      {connected && (
        <GlassCard>
          <CardHead icon={SettingsIcon} tone={live?.health === 'error' ? 'crit' : 'ok'} title="מחובר ל-Meta"
            subtitle={settings.connected_at ? `מאז ${formatDateTime(settings.connected_at)}` : undefined} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="inner-row flex items-center gap-3 px-4 py-3.5">
              {settings.page_picture && <img src={settings.page_picture} alt="" className="h-10 w-10 rounded-full object-cover" />}
              <div className="min-w-0">
                <div className="text-[12.5px] font-semibold text-text-faint">עמוד פייסבוק</div>
                <div className="truncate font-bold">{settings.page_name}</div>
                {live?.page_followers != null && <div className="tabular text-[13px] text-text-faint">{num(live.page_followers)} עוקבים</div>}
              </div>
            </div>
            <div className="inner-row px-4 py-3.5">
              <div className="text-[12.5px] font-semibold text-text-faint">אינסטגרם עסקי</div>
              <div className="truncate font-bold" dir="ltr">{settings.ig_username ? `@${settings.ig_username}` : '—'}</div>
              {!settings.ig_username && <div className="text-[13px] text-text-faint">לא מקושר לעמוד הזה</div>}
            </div>
            <div className="inner-row px-4 py-3.5">
              <div className="text-[12.5px] font-semibold text-text-faint">חשבון מודעות</div>
              <div className="truncate font-bold">{settings.ad_account_name || '—'}</div>
              {settings.currency && <div className="text-[13px] text-text-faint">{settings.currency}</div>}
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3 text-[14px]">
            <StatusChip tone={settings.autopilot ? 'ok' : 'crit'}>{settings.autopilot ? 'Autopilot פעיל' : 'Autopilot כבוי'}</StatusChip>
            {live?.health === 'ok' && <StatusChip tone="ok">החיבור תקין</StatusChip>}
            {live?.health === 'error' && <StatusChip tone="crit">{live.health_message}</StatusChip>}
            {settings.last_run_at && <span className="text-text-faint">ריצה אחרונה: {formatDateTime(settings.last_run_at)}</span>}
          </div>

          {(settings.pages?.length > 1 || settings.ad_accounts?.length > 1) && (
            <div className="mt-5 grid grid-cols-1 gap-3.5 sm:grid-cols-2">
              {settings.pages?.length > 1 && (
                <Field label="עמוד לפרסום">
                  <Select value={settings.page_id ?? ''} onChange={(e) => pick(e.target.value, null)}
                    options={settings.pages.map((p) => ({ value: p.id, label: `${p.name}${p.ig_username ? ` · @${p.ig_username}` : ''}` }))} />
                </Field>
              )}
              {settings.ad_accounts?.length > 1 && (
                <Field label="חשבון מודעות">
                  <Select value={settings.ad_account_id ?? ''} onChange={(e) => pick(null, e.target.value)}
                    options={settings.ad_accounts.map((a) => ({ value: a.id, label: `${a.name} (${a.currency})` }))} />
                </Field>
              )}
            </div>
          )}

          <div className="mt-5 flex flex-wrap gap-2.5">
            <SecondaryButton onClick={connect} disabled={busy === 'oauth'}>{busy === 'oauth' ? 'מעביר ל-Meta…' : 'חיבור מחדש / הוספת עמודים'}</SecondaryButton>
            <button type="button" onClick={disconnect} className="ghost-btn text-crit-soft">ניתוק</button>
          </div>
          {error && <div className="mt-3 text-[14px] font-semibold text-crit-soft">{error}</div>}
        </GlassCard>
      )}

      {!connected && (
        <GlassCard>
          <CardHead icon={SettingsIcon} tone="gold" title="חיבור Meta" subtitle="פעם אחת — ומשם הכל אוטומטי: פרסום, תזמון, ביצועים וקמפיינים" />
          <div className="flex flex-col gap-3">
            <Step n={1} title="אפליקציית Meta של ICONAIR" done={appReady} active={active === 1}>
              <p className="text-[14.5px] leading-relaxed text-text-dim">
                Meta דורשת שכל מערכת שמפרסמת בשם עמוד תחזיק “אפליקציה” משלה. זה נעשה פעם אחת, בחשבון הפייסבוק שמנהל את העמוד:
              </p>
              <ol className="flex list-decimal flex-col gap-2 ps-5 text-[14.5px] leading-relaxed text-text-dim">
                <li>
                  היכנס ל-<a href="https://developers.facebook.com/apps/creation/" target="_blank" rel="noreferrer" className="font-semibold text-gold-600 hover:underline">developers.facebook.com</a> ← <b>Create App</b> ← סוג <b>Business</b>.
                </li>
                <li>הוסף את המוצר <b>Facebook Login</b> ← Settings ← בשדה <b>Valid OAuth Redirect URIs</b> הדבק:</li>
              </ol>
              <Copy value={redirect} />
              <ol start={3} className="flex list-decimal flex-col gap-2 ps-5 text-[14.5px] leading-relaxed text-text-dim">
                <li>ב-<b>App settings ← Basic</b>: בשדה App Domains הדבק את הדומיין, והעתק לכאן את ה-App ID וה-App Secret.</li>
              </ol>
              <Copy value={host} />
              <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                <Field label="App ID"><TextInput dir="ltr" inputMode="numeric" value={appId} onChange={(e) => setAppId(e.target.value)} placeholder="1234567890123456" /></Field>
                <Field label="App Secret" hint="נשמר בשרת בגישה חסומה — לא נחשף בדפדפן">
                  <TextInput dir="ltr" type="password" autoComplete="off" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="••••••••••••••••" />
                </Field>
              </div>
              <div><PrimaryButton onClick={saveApp} loading={busy === 'app'}>שמירה והמשך</PrimaryButton></div>
            </Step>

            <Step n={2} title="התחברות עם פייסבוק" done={connected} active={active === 2}>
              <p className="text-[14.5px] leading-relaxed text-text-dim">
                לחיצה אחת — Meta תבקש לאשר גישה לעמוד, לאינסטגרם ולחשבון המודעות. <b>אשר את כל ההרשאות</b> כדי שהכל יעבוד.
                העמוד, האינסטגרם וחשבון המודעות ייבחרו אוטומטית.
              </p>
              <div className="flex flex-wrap gap-2.5">
                <PrimaryButton onClick={connect} loading={busy === 'oauth'}>{busy === 'oauth' ? 'מעביר ל-Meta…' : 'התחבר עם פייסבוק'}</PrimaryButton>
              </div>
              <details className="text-[14px] text-text-faint">
                <summary className="cursor-pointer font-semibold">עדכון App ID / Secret</summary>
                <div className="mt-3 grid gap-3.5 sm:grid-cols-2">
                  <TextInput dir="ltr" value={appId} onChange={(e) => setAppId(e.target.value)} placeholder="App ID" />
                  <TextInput dir="ltr" type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="App Secret (ריק = ללא שינוי)" />
                </div>
                <div className="mt-3"><SecondaryButton onClick={saveApp}>{busy === 'app' ? 'שומר…' : 'שמירה'}</SecondaryButton></div>
              </details>
            </Step>

            <Step n={3} title="Autopilot פועל" done={false} active={false} />
          </div>
          {error && <div className="mt-4 rounded-row border border-crit/25 bg-crit/[0.07] px-4 py-3 text-[14px] font-semibold text-crit-soft">{error}</div>}
        </GlassCard>
      )}

      <GlassCard>
        <CardHead icon={SettingsIcon} tone="slate" title="איך זה עובד" />
        <ul className="flex flex-col gap-2 text-[14.5px] leading-relaxed text-text-dim">
          <li>• <b>Autopilot</b> רץ כל דקה בתוך מסד הנתונים: כל פוסט שהגיע זמנו עולה לפייסבוק ולאינסטגרם — גם כשאף אחד לא מחובר למערכת.</li>
          <li>• תקלה זמנית אצל Meta (עומס, תמונה בעיבוד) — ניסיון חוזר אוטומטי, עד 5 פעמים. רק תקלה אמיתית מסומנת “דורש טיפול”.</li>
          <li>• הביצועים (חשיפה, לייקים, תגובות, שמירות) מתעדכנים לבד כל 30 דקות.</li>
          <li>• הטוקנים של Meta נשמרים רק בשרת ולעולם לא מגיעים לדפדפן. רק שני המנהלים רואים את הטאב.</li>
        </ul>
      </GlassCard>
    </div>
  );
}
