import { useState } from 'react';
import GlassCard, { CardHead } from '../components/ui/GlassCard';
import DataTable, { StatusChip } from '../components/ui/DataTable';
import { SecondaryButton, TextInput, PrimaryButton } from '../components/ui/Field';
import { Async } from '../components/ui/States';
import { useQuery } from '../hooks/useQuery';
import { useAuth } from '../context/AuthContext';
import {
  listProfiles, getRouteBreakdown,
  listAllScents, createScent, setScentActive,
  listAllDeviceModels, createDeviceModel, setDeviceModelActive,
  uploadBrandLogo,
} from '../lib/queries';
import { describeError } from '../lib/supabase';
import { Brand } from '../components/Sidebar';

export default function SettingsScreen() {
  const { profile, session, isAdmin, signOut } = useAuth();

  const team = useQuery(listProfiles, []);
  const routes = useQuery(getRouteBreakdown, []);
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
        <CardHead title="החשבון שלי" />

        <dl className="flex flex-col gap-3 text-[13.5px]">
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-text-faint">שם</dt>
            <dd className="font-semibold">{profile?.full_name ?? '—'}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-text-faint">אימייל</dt>
            <dd dir="ltr" className="font-mono text-[12.5px]">{session?.user?.email ?? '—'}</dd>
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

        <p className="mt-4 text-[11.5px] leading-relaxed text-text-faint">
          שינוי הרשאה נעשה בטבלת <span className="font-mono text-text-dim">profiles</span> ב-Supabase
          ונכנס לתוקף מיד, בלי שתצטרך להתחבר מחדש.
        </p>

        <SecondaryButton className="mt-5 w-full" onClick={signOut}>
          התנתקות
        </SecondaryButton>
      </GlassCard>

      <div className="flex flex-col gap-3.5">
        <GlassCard>
          <CardHead title="צוות" subtitle="משתמשים פעילים במערכת" />
          <Async loading={team.loading} error={team.error} onRetry={team.refetch}
                 isEmpty={team.data?.length === 0}>
            <DataTable columns={teamColumns} rows={team.data ?? []} rowKey={(row) => row.id} />
          </Async>
        </GlassCard>

        <GlassCard>
          <CardHead title="קווי הפצה" subtitle="לפי שדה 'קו הפצה' בכרטיס הלקוח" />
          <Async loading={routes.loading} error={routes.error} onRetry={routes.refetch}
                 isEmpty={routes.data?.length === 0}>
            <DataTable columns={routeColumns} rows={routes.data ?? []} rowKey={(row) => row.name} />
          </Async>
        </GlassCard>

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
      <CardHead title="מיתוג — לוגו המערכת" subtitle="מוצג בסרגל הצד, במסך הכניסה ובראש המסך בנייד" />

      <div className="mb-4 flex items-center justify-center rounded-row border border-white/[0.07] bg-white/[0.02] p-5">
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
                    focus:ring-gold-500 ${dragOver ? 'border-gold-500/60 bg-gold-500/[0.06]' : 'border-white/[0.14]'}`}
      >
        <span className="text-[13.5px] font-medium text-text-dim">
          {busy ? 'מעלה…' : 'לחצו כדי לבחור קובץ, גררו לכאן, או פשוט הדביקו (Ctrl+V)'}
        </span>
        <span className="text-[11.5px] text-text-faint">PNG / JPG / SVG / WebP</span>
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
                        text-[12.5px] text-crit-soft">
          {error}
        </div>
      )}

      {done && !error && (
        <div className="mt-3.5 rounded-row border border-ok/25 bg-ok/[0.07] px-3.5 py-2.5 text-[12.5px] text-ok">
          הלוגו עודכן בהצלחה. במסכים אחרים שכבר פתוחים אצלך או אצל אחרים — רענון הדף (F5) מציג את הגרסה החדשה.
        </div>
      )}
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
      <CardHead title="דגמי מכשירים" subtitle="הרשימה שממנה נבחר דגם בכל מסך במערכת" />

      <form onSubmit={add} className="mb-3.5 flex gap-2">
        <TextInput value={name} onChange={(e) => setName(e.target.value)}
                   placeholder="הוסף דגם חדש… (למשל Icon 800)" className="flex-1" />
        <PrimaryButton type="submit" loading={busy} disabled={!name.trim()}>הוסף</PrimaryButton>
      </form>

      {error && (
        <div className="mb-3.5 rounded-row border border-crit/25 bg-crit/[0.07] px-3.5 py-2.5 text-[12.5px] text-crit-soft">
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
              className={`rounded-pill border px-3 py-1.5 text-[12.5px] transition-colors ${
                m.active
                  ? 'border-white/[0.09] text-text-dim hover:border-crit/35 hover:text-crit-soft'
                  : 'border-white/[0.06] text-text-faint/60 line-through hover:border-ok/35 hover:text-ok'
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
      <CardHead title="ניחוחות" subtitle="הרשימה שממנה נבחר ניחוח בכל מסך במערכת" />

      <form onSubmit={add} className="mb-3.5 flex gap-2">
        <TextInput value={name} onChange={(e) => setName(e.target.value)}
                   placeholder="הוסף ניחוח חדש…" className="flex-1" />
        <PrimaryButton type="submit" loading={busy} disabled={!name.trim()}>הוסף</PrimaryButton>
      </form>

      {error && (
        <div className="mb-3.5 rounded-row border border-crit/25 bg-crit/[0.07] px-3.5 py-2.5 text-[12.5px] text-crit-soft">
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
              className={`rounded-pill border px-3 py-1.5 text-[12.5px] transition-colors ${
                s.active
                  ? 'border-white/[0.09] text-text-dim hover:border-crit/35 hover:text-crit-soft'
                  : 'border-white/[0.06] text-text-faint/60 line-through hover:border-ok/35 hover:text-ok'
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
