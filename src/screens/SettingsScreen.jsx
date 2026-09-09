import { useState } from 'react';
import GlassCard, { CardHead } from '../components/ui/GlassCard';
import DataTable, { StatusChip } from '../components/ui/DataTable';
import { SecondaryButton, TextInput, PrimaryButton, Field } from '../components/ui/Field';
import { Async } from '../components/ui/States';
import { UsersIcon, RouteIcon, TagIcon, DeviceIcon, DropIcon, SettingsIcon, BellIcon } from '../components/ui/Icons';
import { useQuery } from '../hooks/useQuery';
import { useAuth } from '../context/AuthContext';
import {
  listProfiles, getRouteBreakdown, listRoutes, updateRouteCycle,
  listAllScents, createScent, setScentActive,
  listAllDeviceModels, createDeviceModel, setDeviceModelActive,
  uploadBrandLogo, getNotificationSettings, updateNotificationSettings,
} from '../lib/queries';
import { describeError } from '../lib/supabase';
import { Brand } from '../components/Sidebar';

export default function SettingsScreen() {
  const { profile, session, isAdmin, signOut } = useAuth();

  const team = useQuery(listProfiles, []);
  const routes = useQuery(getRouteBreakdown, []);
  const routeCycles = useQuery(listRoutes, [], { enabled: isAdmin });
  const notificationSettings = useQuery(getNotificationSettings, [], { enabled: isAdmin });
  const scents = useQuery(listAllScents, [], { enabled: isAdmin });
  const deviceModels = useQuery(listAllDeviceModels, [], { enabled: isAdmin });

  const teamColumns = [
    { key: 'name', label: 'שם', width: 'minmax(0,1fr)', render: (row) => <b className="font-semibold">{row.full_name}</b> },
    {
      key: 'role',
      label: 'תפקיד',
      width: '120px',
      render: (row) => (
        <StatusChip tone={row.role === 'admin' ? 'gold' : 'slate'}>
          {row.role === 'admin' ? 'מנהל' : 'טכנאי'}
        </StatusChip>
      ),
    },
  ];

  const routeColumns = [
    { key: 'name', label: 'קו', width: 'minmax(0,1fr)', render: (row) => <b className="font-semibold">{row.name}</b> },
    { key: 'total', label: 'מכשירים', width: '96px', render: (row) => <span className="tabular font-mono">{row.total}</span> },
    { key: 'active', label: 'פעילים', width: '96px', render: (row) => <span className="tabular font-mono">{row.active}</span> },
  ];

  return (
    <section className="grid grid-cols-1 items-start gap-3.5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <GlassCard>
        <CardHead icon={SettingsIcon} tone="slate" title="החשבון שלי" />

        <dl className="flex flex-col gap-3 text-[15px]">
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-text-faint">שם</dt>
            <dd className="font-semibold">{profile?.full_name ?? '—'}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-text-faint">אימייל</dt>
            <dd dir="ltr" className="font-mono text-[14px]">{session?.user?.email ?? '—'}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-text-faint">הרשאה</dt>
            <dd>
              <StatusChip tone={isAdmin ? 'gold' : 'slate'}>
                {isAdmin ? 'מנהל — כולל מחיקה' : 'טכנאי — צפייה, הוספה ועדכון'}
              </StatusChip>
            </dd>
          </div>
        </dl>

        <p className="mt-4 text-[13px] leading-relaxed text-text-faint">
          שינוי הרשאה נעשה בטבלת <span className="font-mono text-text-dim">profiles</span> ב-Supabase
          ונכנס לתוקף מיד, בלי שתצטרך להתחבר מחדש.
        </p>

        <SecondaryButton className="mt-5 w-full" onClick={signOut}>
          התנתקות
        </SecondaryButton>
      </GlassCard>

      <div className="flex flex-col gap-3.5">
        <GlassCard>
          <CardHead icon={UsersIcon} tone="slate" title="צוות" subtitle="משתמשים פעילים במערכת" />
          <Async loading={team.loading} error={team.error} onRetry={team.refetch}
                 isEmpty={team.data?.length === 0}>
            <DataTable columns={teamColumns} rows={team.data ?? []} rowKey={(row) => row.id} />
          </Async>
        </GlassCard>

        <GlassCard>
          <CardHead icon={RouteIcon} tone="ok" title="קווי הפצה" subtitle="לפי שדה 'קו הפצה' בכרטיס הלקוח" />
          <Async loading={routes.loading} error={routes.error} onRetry={routes.refetch}
                 isEmpty={routes.data?.length === 0}>
            <DataTable columns={routeColumns} rows={routes.data ?? []} rowKey={(row) => row.name} />
          </Async>
        </GlassCard>

        {isAdmin && <RouteCyclesCard routeCycles={routeCycles} />}
        {isAdmin && <NotificationSettingsCard notificationSettings={notificationSettings} />}
        {isAdmin && <BrandingCard />}
        {isAdmin && <DeviceModelsCard deviceModels={deviceModels} />}
        {isAdmin && <ScentsCard scents={scents} />}
      </div>
    </section>
  );
}

/**
 * העלאת לוגו המותג — הדבקה ישירה (Ctrl+V מה-clipboard) או בחירת קובץ.
 * נשמר תמיד לאותו נתיב קבוע ב-bucket "branding" (upsert), כך שכל
 * מקום באפליקציה שמציג את <Brand> מתעדכן אוטומטית בלי שינוי קוד נוסף.
 */
function BrandingCard() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [previewUrl, setPreviewUrl] = useState(null);

  async function handleFile(file) {
    if (!file || !file.type.startsWith('image/')) {
      setError('רק קובץ תמונה (PNG / JPG / SVG / WebP) מתקבל');
      return;
    }
    setError(null);
    setDone(false);
    setBusy(true);
    try {
      const url = await uploadBrandLogo(file);
      setPreviewUrl(url);
      setDone(true);
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  function onPaste(event) {
    const item = [...event.clipboardData.items].find((i) => i.type.startsWith('image/'));
    if (item) handleFile(item.getAsFile());
  }

  function onDrop(event) {
    event.preventDefault();
    setDragOver(false);
    handleFile(event.dataTransfer.files?.[0]);
  }

  return (
    <GlassCard>
      <CardHead icon={TagIcon} tone="gold" title="מיתוג — לוגו המערכת" subtitle="מוצג בסרגל הצד, במסך הכניסה ובראש המסך בנייד" />

      <div className="mb-4 flex items-center justify-center rounded-row border border-black/[0.07] bg-black/[0.02] p-5">
        <Brand overrideSrc={previewUrl ?? undefined} />
      </div>

      <label
        tabIndex={0}
        onPaste={onPaste}
        onDrop={onDrop}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        className={`flex cursor-pointer flex-col items-center gap-2 rounded-row border border-dashed
                    px-4 py-8 text-center transition-colors focus:outline-none focus:ring-2
                    focus:ring-gold-500 ${dragOver ? 'border-gold-500/60 bg-gold-500/[0.06]' : 'border-black/[0.14]'}`}
      >
        <span className="text-[15px] font-medium text-text-dim">
          {busy ? 'מעלה…' : 'לחצו כדי לבחור קובץ, גררו לכאן, או פשוט הדביקו (Ctrl+V)'}
        </span>
        <span className="text-[13px] text-text-faint">PNG / JPG / SVG / WebP</span>
        <input
          type="file"
          accept="image/*"
          className="hidden"
          disabled={busy}
          onChange={(e) => handleFile(e.target.files?.[0])}
        />
      </label>

      {error && (
        <div className="mt-3.5 rounded-row border border-crit/25 bg-crit/[0.07] px-3.5 py-2.5
                        text-[14px] text-crit-soft">
          {error}
        </div>
      )}

      {done && !error && (
        <div className="mt-3.5 rounded-row border border-ok/25 bg-ok/[0.07] px-3.5 py-2.5 text-[14px] text-ok">
          הלוגו עודכן בהצלחה. במסכים אחרים שכבר פתוחים אצלך או אצל אחרים — רענון הדף (F5) מציג את הגרסה החדשה.
        </div>
      )}
    </GlassCard>
  );
}

/**
 * מחזוריות חודשית של קווים — כל קו מתחיל ב-1 לחודש (קבוע, לא ניתן
 * לעריכה) ומסתיים ביום שהמנהל קובע (10–12, ר' iconair_schema_phase20).
 * זה מה ש"הכנה לקו" (StockScreen.jsx → getCycleInfo) משתמש בו כדי
 * לחשב מתי מתחיל המחזור הבא ולהציג את התראת ה"סביב ה-25 לחודש".
 */
function RouteCyclesCard({ routeCycles }) {
  const rows = (routeCycles.data ?? []).filter((r) => r.name);
  const [drafts, setDrafts] = useState({});
  const [savingName, setSavingName] = useState(null);
  const [error, setError] = useState(null);

  async function save(routeName) {
    const value = Number(drafts[routeName]);
    if (!Number.isInteger(value) || value < 1 || value > 28) {
      setError('יום סיום המחזור חייב להיות מספר שלם בין 1 ל-28');
      return;
    }
    setError(null);
    setSavingName(routeName);
    try {
      await updateRouteCycle(routeName, value);
      routeCycles.refetch();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setSavingName(null);
    }
  }

  return (
    <GlassCard>
      <CardHead
        icon={RouteIcon}
        tone="slate"
        title="מחזורי קווים"
        subtitle="כל קו רץ מה-1 לחודש עד יום הסיום — קובע את תזמון התראת ׳הכנה לקו׳"
      />

      {error && (
        <div className="mb-3.5 rounded-row border border-crit/25 bg-crit/[0.07] px-3.5 py-2.5 text-[14px] text-crit-soft">
          {error}
        </div>
      )}

      <Async loading={routeCycles.loading} error={routeCycles.error} onRetry={routeCycles.refetch}
             isEmpty={rows.length === 0}>
        <div className="flex flex-col gap-2.5">
          {rows.map((r) => {
            const draft = drafts[r.name] ?? String(r.cycle_end_day);
            const dirty = Number(draft) !== r.cycle_end_day;
            return (
              <div key={r.name} className="inner-row flex flex-wrap items-center gap-3 px-4 py-3.5">
                <b className="min-w-0 flex-1 truncate text-[15px] font-semibold">{r.name}</b>
                <span className="text-[14px] text-text-faint">מה-1 עד ה-</span>
                <input
                  type="number"
                  min={1}
                  max={28}
                  value={draft}
                  onChange={(e) => setDrafts((prev) => ({ ...prev, [r.name]: e.target.value }))}
                  aria-label={`יום סיום מחזור ל${r.name}`}
                  className="w-[64px] rounded-pill border border-black/[0.09] bg-ink-800 px-3 py-2 text-center text-[15px] text-text focus:border-gold-500/45 focus:outline-none"
                />
                <span className="text-[14px] text-text-faint">לחודש</span>
                <button
                  type="button"
                  onClick={() => save(r.name)}
                  disabled={!dirty || savingName === r.name}
                  className="ghost-btn !px-3.5 !py-2 text-[14px] disabled:opacity-40"
                >
                  {savingName === r.name ? 'שומר…' : 'שמירה'}
                </button>
              </div>
            );
          })}
        </div>
      </Async>
    </GlassCard>
  );
}

/**
 * מי מקבל עותק ניהולי מדוח שירות, ומאיזו כתובת נשלח המייל (phase22).
 * מפתח ה-Resend עצמו לא מוצג ולא נערך כאן בכוונה — הוא סוד, ומקומו
 * היחיד הוא Supabase Vault (ר' ההסבר מתחת לכרטיס). כרטיס זה שולט רק
 * בהגדרות שאינן-סודיות של אותה לוגיקת שליחה.
 */
function NotificationSettingsCard({ notificationSettings }) {
  const row = notificationSettings.data;
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);

  const current = draft ?? { admin_email: row?.admin_email ?? '', from_address: row?.from_address ?? '' };
  const dirty = row && (current.admin_email !== (row.admin_email ?? '') || current.from_address !== (row.from_address ?? ''));

  async function save() {
    setError(null);
    setSaving(true);
    try {
      await updateNotificationSettings({
        admin_email: current.admin_email || null,
        from_address: current.from_address || 'ICON AIR <onboarding@resend.dev>',
      });
      notificationSettings.refetch();
      setDraft(null);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <GlassCard>
      <CardHead
        icon={BellIcon}
        tone="slate"
        title="מיילים אוטומטיים על דוחות שירות"
        subtitle="נשלח אוטומטית ללקוח בסיום ביקור, עם עותק לכתובת שתגדיר כאן"
      />

      {error && (
        <div className="mb-3.5 rounded-row border border-crit/25 bg-crit/[0.07] px-3.5 py-2.5 text-[14px] text-crit-soft">
          {error}
        </div>
      )}

      <Async loading={notificationSettings.loading} error={notificationSettings.error} onRetry={notificationSettings.refetch}>
        <div className="flex flex-col gap-3.5">
          <Field label="כתובת מייל ניהולית (עותק על כל דוח)" hint="ריק = לא יישלח עותק ניהולי">
            <TextInput
              type="email"
              dir="ltr"
              value={current.admin_email}
              onChange={(e) => setDraft({ ...current, admin_email: e.target.value })}
              placeholder="admin@example.com"
            />
          </Field>

          <Field label="כתובת השולח" hint='למשל: ICON AIR <reports@yourdomain.co.il> — ללא דומיין מאומת ב-Resend, השתמש ב-onboarding@resend.dev'>
            <TextInput
              dir="ltr"
              value={current.from_address}
              onChange={(e) => setDraft({ ...current, from_address: e.target.value })}
              placeholder="ICON AIR <onboarding@resend.dev>"
            />
          </Field>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={save}
              disabled={!dirty || saving}
              className="ghost-btn !px-4 !py-2 text-[14px] disabled:opacity-40"
            >
              {saving ? 'שומר…' : 'שמירה'}
            </button>
            {saved && <span className="text-[13.5px] font-semibold text-ok">נשמר</span>}
          </div>

          <div className="rounded-row border border-black/[0.075] bg-black/[0.022] px-3.5 py-3 text-[13px] leading-relaxed text-text-faint">
            השליחה בפועל דורשת מפתח API של Resend, שמוגדר פעם אחת ישירות
            ב-Supabase (Project Settings ← Vault ← Add secret, בשם{' '}
            <span className="font-mono text-text-dim">resend_api_key</span>) —
            לא כאן ולא ב-Vercel, כדי שהמפתח לעולם לא יגיע לדפדפן. כל עוד
            הסוד לא הוגדר, הדוחות עדיין נוצרים כרגיל — רק המייל לא נשלח.
          </div>
        </div>
      </Async>
    </GlassCard>
  );
}

/**
 * רשימת דגמי המכשירים הגלובלית שממנה נבחר "דגם" בכל מסך במערכת
 * (מכשיר חדש, מלאי נייד, ניהול מלאי).
 *
 * "מחיקה" היא תמיד השבתה (active=false), לא DELETE אמיתי — דגם
 * שכבר בשימוש בהיסטוריה (devices/technician_stock/warehouse_stock)
 * צריך להישאר קריא שם גם אם מפסיקים להציע אותו לבחירה חדשה.
 */
function DeviceModelsCard({ deviceModels }) {
  const [name, setName] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function add(event) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;

    setError(null);
    setBusy(true);
    try {
      await createDeviceModel(trimmed);
      setName('');
      deviceModels.refetch();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  async function toggle(model) {
    setError(null);
    try {
      await setDeviceModelActive(model.id, !model.active);
      deviceModels.refetch();
    } catch (caught) {
      setError(describeError(caught));
    }
  }

  return (
    <GlassCard>
      <CardHead icon={DeviceIcon} tone="gold" title="דגמי מכשירים" subtitle="הרשימה שממנה נבחר דגם בכל מסך במערכת" />

      <form onSubmit={add} className="mb-3.5 flex gap-2">
        <TextInput value={name} onChange={(e) => setName(e.target.value)}
                   placeholder="הוסף דגם חדש… (למשל Icon 800)" className="flex-1" />
        <PrimaryButton type="submit" loading={busy} disabled={!name.trim()}>הוסף</PrimaryButton>
      </form>

      {error && (
        <div className="mb-3.5 rounded-row border border-crit/25 bg-crit/[0.07] px-3.5 py-2.5 text-[14px] text-crit-soft">
          {error}
        </div>
      )}

      <Async loading={deviceModels.loading} error={deviceModels.error} onRetry={deviceModels.refetch}
             isEmpty={deviceModels.data?.length === 0}>
        <div className="flex flex-wrap gap-1.5">
          {(deviceModels.data ?? []).map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => toggle(m)}
              title={m.active ? 'לחץ להשבית' : 'לחץ להפעיל מחדש'}
              className={`rounded-pill border px-3 py-1.5 text-[14px] transition-colors ${
                m.active
                  ? 'border-black/[0.09] text-text-dim hover:border-crit/35 hover:text-crit-soft'
                  : 'border-black/[0.06] text-text-faint/60 line-through hover:border-ok/35 hover:text-ok'
              }`}
            >
              {m.name}
            </button>
          ))}
        </div>
      </Async>
    </GlassCard>
  );
}

/**
 * רשימת הניחוחות הגלובלית שכל שדה "ניחוח" באפליקציה נגזר ממנה.
 *
 * "מחיקה" היא תמיד השבתה (active=false), לא DELETE אמיתי — ניחוח
 * שכבר בשימוש בהיסטוריה (oil_tracking/devices/technician_stock)
 * צריך להישאר קריא שם גם אם מפסיקים להציע אותו לבחירה חדשה.
 */
function ScentsCard({ scents }) {
  const [name, setName] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function add(event) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;

    setError(null);
    setBusy(true);
    try {
      await createScent(trimmed);
      setName('');
      scents.refetch();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  async function toggle(scent) {
    setError(null);
    try {
      await setScentActive(scent.id, !scent.active);
      scents.refetch();
    } catch (caught) {
      setError(describeError(caught));
    }
  }

  return (
    <GlassCard>
      <CardHead icon={DropIcon} tone="teal" title="ניחוחות" subtitle="הרשימה שממנה נבחר ניחוח בכל מסך במערכת" />

      <form onSubmit={add} className="mb-3.5 flex gap-2">
        <TextInput value={name} onChange={(e) => setName(e.target.value)}
                   placeholder="הוסף ניחוח חדש…" className="flex-1" />
        <PrimaryButton type="submit" loading={busy} disabled={!name.trim()}>הוסף</PrimaryButton>
      </form>

      {error && (
        <div className="mb-3.5 rounded-row border border-crit/25 bg-crit/[0.07] px-3.5 py-2.5 text-[14px] text-crit-soft">
          {error}
        </div>
      )}

      <Async loading={scents.loading} error={scents.error} onRetry={scents.refetch}
             isEmpty={scents.data?.length === 0}>
        <div className="flex flex-wrap gap-1.5">
          {(scents.data ?? []).map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => toggle(s)}
              title={s.active ? 'לחץ להשבית' : 'לחץ להפעיל מחדש'}
              className={`rounded-pill border px-3 py-1.5 text-[14px] transition-colors ${
                s.active
                  ? 'border-black/[0.09] text-text-dim hover:border-crit/35 hover:text-crit-soft'
                  : 'border-black/[0.06] text-text-faint/60 line-through hover:border-ok/35 hover:text-ok'
              }`}
            >
              {s.name}
            </button>
          ))}
        </div>
      </Async>
    </GlassCard>
  );
}
