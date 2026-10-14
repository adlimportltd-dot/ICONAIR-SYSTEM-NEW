import { useEffect, useMemo, useState } from 'react';
import GlassCard, { CardHead } from '../components/ui/GlassCard';
import { StatusChip } from '../components/ui/DataTable';
import ScreenToolbar from '../components/ui/ScreenToolbar';
import Modal from '../components/ui/Modal';
import { Field, Select, TextInput, PrimaryButton, SecondaryButton } from '../components/ui/Field';
import { Async, EmptyState } from '../components/ui/States';
import { DeviceIcon } from '../components/ui/Icons';
import { useQuery } from '../hooks/useQuery';
import { useRealtime } from '../hooks/useRealtime';
import { useAuth } from '../context/AuthContext';
import { relativeTime } from '../lib/mappers';
import {
  listIotDevices,
  listIotModelMap,
  listLinkableDevices,
  updateIotDevice,
  listCommandLog,
  sendWorkTime,
  listLastRefills,
  listModelCapacity,
} from '../lib/smartFleetQueries';

/**
 * צי חכם — מצב חי של המכשירים שמחוברים לענן Aroma Link.
 * הנתונים מגיעים מ-/api/aroma-sync כל 5 דקות.
 * פעולות מנהל: סיווג מכשיר (שכירות / פרטי / ניסוי) ודגם, ועריכת שעון ועוצמה
 * (phase57) — רק במכשירים ש-control_enabled שלהם פעיל.
 *
 * phase66 (עיצוב מחדש): שורה נקייה + פירוט בלחיצה, בעיות קודם, קיבוץ לפי לקוח,
 * כרטיסי סיכום שמסננים בלחיצה, מכשירי ניסוי מוסתרים כברירת מחדל,
 * ובטלפון כרטיס קצר שנפתח בנגיעה.
 */

/** סוג המכשיר — iot_devices.owner_type (phase56) */
const OWNER_TYPES = {
  rental: { label: 'לקוח שכירות', tone: 'gold' },
  private: { label: 'לקוח פרטי', tone: 'teal' },
  test: { label: 'ניסוי', tone: 'slate' },
};
const OWNER_OPTIONS = Object.entries(OWNER_TYPES).map(([value, t]) => ({ value, label: t.label }));

/** השם שמוצג בשורה: לקוח במערכת / שם הלקוח הפרטי / השם מהאפליקציה */
function displayName(row) {
  if (row.owner_type === 'rental' && row.device?.customer?.name) return row.device.customer.name;
  if (row.owner_type === 'private' && row.owner_name) return row.owner_name;
  return row.aroma_name ?? '—';
}

function subLine(row) {
  if (row.owner_type === 'rental' && row.device) {
    return row.device.location_note || row.device.customer?.city || row.device.serial;
  }
  if (row.owner_type === 'private' && row.owner_phone) return `${row.owner_phone} · בענן: ${row.aroma_name ?? ''}`;
  return `בענן: ${row.aroma_name ?? ''}`;
}

const DAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

function toMinutes(hhmm) {
  const [h, m] = String(hhmm || '').split(':').map(Number);
  return Number.isFinite(h) ? h * 60 + (m || 0) : null;
}

/** התוכניות הפעילות של היום, לפי שעון ישראל */
function todayPrograms(schedule) {
  if (!Array.isArray(schedule)) return null;
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' }));
  const day = schedule.find((d) => d.week === now.getDay());
  const programs = (day?.programs ?? []).filter((p) => p.enabled && p.start !== p.end);
  const minutes = now.getHours() * 60 + now.getMinutes();
  const activeNow = programs.some((p) => {
    const s = toMinutes(p.start);
    const e = toMinutes(p.end);
    return s !== null && e !== null && minutes >= s && minutes < e;
  });
  return { programs, activeNow, dayName: DAY_NAMES[now.getDay()] };
}

function liveState(row) {
  if (!row.online) return { tone: 'crit', label: 'מנותק' };
  if (row.is_locked) return { tone: 'warn', label: 'נעול' };
  if (row.power_on === false) return { tone: 'slate', label: 'כבוי' };
  const today = todayPrograms(row.schedule);
  if (today && !today.activeNow) return { tone: 'slate', label: 'מחוץ לשעות' };
  return { tone: 'ok', label: 'פעיל' };
}

/** צריכת שמן ממוצעת ליום (מ"ל) לפי השעון של המכשיר ונתוני היצרן (iot_model_map, phase61) */
function dailyUsage(row, models) {
  const m = (models ?? []).find((x) => x.supplier_model === row.supplier_model);
  if (!m || !m.ml_per_sec || !Array.isArray(row.schedule) || !row.schedule.length) return null;
  let secs = 0;
  row.schedule.forEach((d) => (d.programs ?? []).forEach((p) => {
    if (!p.enabled || p.start === p.end) return;
    const s = toMinutes(p.start);
    const e = toMinutes(p.end);
    if (s === null || e === null) return;
    const dur = ((e - s + 1440) % 1440) * 60;
    const w = Number(p.work_sec) || 0;
    const pa = Number(p.pause_sec) || 0;
    if (w + pa > 0) secs += (dur * w) / (w + pa);
  }));
  return { ml: (secs / row.schedule.length) * Number(m.ml_per_sec), tank: Number(m.tank_ml) || null };
}

/**
 * מצב השמן של מכשיר — חישוב אחד שמשמש את השורה, הפירוט, המיון והכרטיס "מיכל נמוך".
 * עם מד מיכל: לפי האחוז. בלי מד: לפי המילוי האחרון במערכת (phase62),
 * ואם אין מילוי — כמה ימים מחזיק מיכל מלא (phase63: לפי כמות המילוי של הדגם/המכשיר).
 */
function oilInfo(row, models, refill, fillMl) {
  const pct = row.has_oil_gauge && row.remain_oil != null
    ? Math.max(0, Math.min(100, Math.round(Number(row.remain_oil))))
    : null;
  const u = dailyUsage(row, models);
  const usage = u && u.ml > 0 ? u.ml : null;
  let days = null;
  let kind = null;
  let refillDate = null;
  if (usage && u.tank) {
    if (pct != null) {
      days = Math.floor(((pct / 100) * u.tank) / usage);
      kind = 'gauge';
    } else if (refill && refill.level_after_pct != null) {
      const passed = (Date.now() - new Date(refill.recorded_at).getTime()) / 86400000;
      days = Math.max(0, Math.floor(((Number(refill.level_after_pct) / 100) * (fillMl || u.tank) - usage * passed) / usage));
      kind = 'refill';
      refillDate = new Date(refill.recorded_at).toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' });
    } else {
      days = Math.floor((fillMl || u.tank) / usage);
      kind = 'full';
    }
  }
  const low = (pct != null && pct < 15) || (kind !== 'full' && days != null && days <= 7);
  const empty = (pct != null && pct <= 0) || (kind !== 'full' && days != null && days <= 0);
  return { pct, usage, days, kind, refillDate, low, empty };
}

const daysTone = (d) => (d <= 3 ? 'crit' : d <= 7 ? 'warn' : 'ok');

/** דירוג לחומרה — קטן = דחוף יותר. מכשירי ניסוי תמיד בסוף. */
function severity(row, oil) {
  if (row.owner_type === 'test') return 9;
  if (!row.online) return 0;
  if (oil.empty) return 1;
  if (oil.low) return 2;
  if (row.is_locked) return 3;
  if (!row.owner_type) return 4;
  return 5;
}

const DOT = { ok: 'bg-ok', warn: 'bg-warn', crit: 'bg-crit', slate: 'bg-slate-400', gold: 'bg-gold-500', teal: 'bg-teal-500' };

function StateBadge({ row, compact = false }) {
  const s = liveState(row);
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[14px] font-semibold">
      <span className="relative flex h-2.5 w-2.5 flex-none">
        {s.tone === 'ok' && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-ok opacity-60" />}
        {s.tone === 'crit' && <span className="absolute inline-flex h-full w-full animate-pulse rounded-full bg-crit opacity-50" />}
        <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${DOT[s.tone] ?? 'bg-slate-400'}`} />
      </span>
      <span>{s.label}</span>
      {!row.online && !compact && (
        <span className="text-[12.5px] font-medium text-text-faint">· {relativeTime(row.last_online_at)}</span>
      )}
    </span>
  );
}

/** תא השמן: מיכל באחוזים (אם יש מד) + ימים עד ריק */
function OilCell({ oil }) {
  if (oil.pct == null && oil.days == null) return <span className="text-[13px] text-text-faint">—</span>;
  return (
    <div className="flex flex-wrap items-center gap-1.5 leading-tight">
      {oil.pct != null && (
        <span className="inline-flex items-center gap-1.5" title={`מיכל ${oil.pct}%`}>
          <span className="relative h-2 w-12 overflow-hidden rounded-full bg-slate-500/20">
            <span
              className={`absolute inset-y-0 start-0 rounded-full ${oil.pct < 15 ? 'bg-warn' : 'bg-ok'} ${oil.pct <= 0 ? '!bg-crit' : ''}`}
              style={{ width: `${Math.max(oil.pct, 4)}%` }}
            />
          </span>
          <span className={`tabular text-[13px] font-bold ${oil.pct <= 0 ? 'text-crit-soft' : oil.pct < 15 ? 'text-warn' : 'text-ok'}`}>
            {oil.pct <= 0 ? 'ריק' : `${oil.pct}%`}
          </span>
        </span>
      )}
      {oil.days != null && oil.kind !== 'full' && <StatusChip tone={daysTone(oil.days)}>{oil.days} ימים</StatusChip>}
      {oil.days != null && oil.kind === 'full' && (
        <span className="tabular text-[12.5px] text-text-faint">מלא: {oil.days} ימים</span>
      )}
    </div>
  );
}

function TodayCell({ row, full = false }) {
  const today = todayPrograms(row.schedule);
  if (!today) return <span className="text-[13px] text-text-faint">עוד לא נקרא</span>;
  if (!today.programs.length) return <span className="text-[13px] text-text-faint">לא פועל היום</span>;
  const list = full ? today.programs : today.programs.slice(0, 1);
  return (
    <div className="tabular flex flex-col gap-0.5 leading-tight">
      {list.map((p, i) => (
        <div key={i}>
          <span className="text-[14px] font-semibold">{p.start}–{p.end}</span>
          <span className="ms-1.5 text-[12.5px] text-text-faint">{p.work_sec}ש׳ / {p.pause_sec}ש׳</span>
        </div>
      ))}
      {!full && today.programs.length > 1 && (
        <span className="text-[12px] text-text-faint">+{today.programs.length - 1} תוכניות</span>
      )}
    </div>
  );
}

function Chevron({ open }) {
  return (
    <svg viewBox="0 0 20 20" className={`h-4 w-4 flex-none text-text-faint transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M5 8l5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Kpi({ label, value, tone = 'text-text', active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inner-row flex flex-col items-start gap-1 px-4 py-3 text-start transition-colors hover:border-gold-300/30 ${
        active ? '!border-gold-500/50 !bg-gold-500/[0.12]' : ''
      }`}
    >
      <span className="text-[13px] font-medium text-text-faint">{label}</span>
      <span className={`tabular font-display text-[24px] font-extrabold ${tone}`}>{value}</span>
    </button>
  );
}

/** שורת פירוט: תווית + ערך */
function Detail({ label, children }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-slate-500/15 py-1.5 text-[14px] last:border-0 md:block md:border-0 md:py-0">
      <div className="flex-none text-[12.5px] font-medium text-text-faint">{label}</div>
      <div className="min-w-0 text-end md:mt-0.5 md:text-start">{children}</div>
    </div>
  );
}

const GRID = 'md:grid md:grid-cols-[minmax(0,1fr)_150px_170px_96px_150px_20px] md:items-center md:gap-4';

function DeviceRow({ row, oil, modelName, open, onToggle, isAdmin, onClassify, onSchedule, nested }) {
  const owner = OWNER_TYPES[row.owner_type];
  return (
    <div className={`inner-row overflow-hidden ${nested ? '!rounded-xl' : ''}`}>
      <button type="button" onClick={onToggle} aria-expanded={open} className="block w-full px-4 py-3 text-start">
        {/* --- מחשב: שורה אחת --- */}
        <div className={`hidden ${GRID}`}>
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate text-[15px] font-semibold">{nested ? subLine(row) : displayName(row)}</span>
              {!owner && <StatusChip tone="warn">לא מסווג</StatusChip>}
              {row.owner_type === 'test' && <StatusChip tone="slate">ניסוי</StatusChip>}
            </div>
            <div className="truncate text-[13px] text-text-faint">
              {nested ? (modelName ?? '—') : `${subLine(row)}${modelName ? ` · ${modelName}` : ''}`}
            </div>
          </div>
          <StateBadge row={row} />
          <OilCell oil={oil} />
          <span className="tabular text-[13.5px]">{oil.usage != null ? `${oil.usage.toFixed(1)} מ״ל` : <span className="text-text-faint">—</span>}</span>
          <TodayCell row={row} />
          <Chevron open={open} />
        </div>

        {/* --- טלפון: כרטיס קצר --- */}
        <div className="flex flex-col gap-2 md:hidden">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate text-[15.5px] font-semibold">{nested ? subLine(row) : displayName(row)}</div>
              <div className="truncate text-[13px] text-text-faint">
                {nested ? (modelName ?? '—') : `${subLine(row)}${modelName ? ` · ${modelName}` : ''}`}
              </div>
            </div>
            <div className="flex flex-none items-center gap-2">
              <StateBadge row={row} compact />
              <Chevron open={open} />
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <OilCell oil={oil} />
            <TodayCell row={row} />
          </div>
          {(!owner || row.owner_type === 'test') && (
            <div className="flex gap-1.5">
              {!owner && <StatusChip tone="warn">לא מסווג</StatusChip>}
              {row.owner_type === 'test' && <StatusChip tone="slate">ניסוי</StatusChip>}
            </div>
          )}
        </div>
      </button>

      {open && (
        <div className="border-t border-slate-500/15 px-4 pb-4 pt-3">
          <div className="grid grid-cols-1 gap-x-6 md:grid-cols-4 md:gap-y-3">
            <Detail label="סוג">{owner ? <StatusChip tone={owner.tone}>{owner.label}</StatusChip> : 'לא מסווג'}</Detail>
            <Detail label="דגם">{modelName ?? '—'}{row.supplier_model ? ` · ${row.supplier_model}` : ''}</Detail>
            <Detail label="מספר סידורי">{row.device?.serial ?? '—'}</Detail>
            <Detail label="שם בענן">{row.aroma_name ?? '—'}</Detail>
            <Detail label="מצב">
              <StateBadge row={row} compact />
              <span className="ms-1.5 text-[12.5px] text-text-faint">
                {row.online ? `עודכן ${relativeTime(row.last_sync_at)}` : `נראה ${relativeTime(row.last_online_at)}`}
              </span>
            </Detail>
            <Detail label="מיכל">
              {oil.pct != null ? `${oil.pct}%` : 'אין מד'}
              {oil.kind === 'refill' && <span className="ms-1.5 text-[12.5px] text-text-faint">לפי מילוי {oil.refillDate}</span>}
            </Detail>
            <Detail label="צריכה ביום">{oil.usage != null ? `${oil.usage.toFixed(1)} מ״ל` : '—'}</Detail>
            <Detail label="ימים עד ריק">
              {oil.days == null ? '—' : oil.kind === 'full' ? `מיכל מלא מחזיק ${oil.days} ימים` : `${oil.days} ימים`}
            </Detail>
            <Detail label="שעון היום"><TodayCell row={row} full /></Detail>
            <Detail label="קושחה"><span className="font-mono text-[12.5px]">{row.firmware ?? '—'}</span></Detail>
            <Detail label="MAC"><span className="font-mono text-[12.5px]" dir="ltr">{row.mac ?? '—'}</span></Detail>
            {row.owner_type === 'private' && <Detail label="טלפון">{row.owner_phone ?? '—'}</Detail>}
          </div>
          {isAdmin && (
            <div className="mt-4 flex flex-wrap gap-2">
              <SecondaryButton className="!px-4 !py-2 !text-[14px]" onClick={(e) => { e.stopPropagation(); onClassify(row); }}>
                סיווג
              </SecondaryButton>
              {row.control_enabled && (
                <SecondaryButton
                  className="!px-4 !py-2 !text-[14px]"
                  disabled={!row.online}
                  title={row.online ? '' : 'המכשיר מנותק'}
                  onClick={(e) => { e.stopPropagation(); onSchedule(row); }}
                >
                  שעון ועוצמה
                </SecondaryButton>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function SmartFleetScreen() {
  const { isAdmin } = useAuth();
  const [search, setSearch] = useState('');
  const [kpiFilter, setKpiFilter] = useState(''); // '' | online | offline | low | none
  const [typeFilter, setTypeFilter] = useState('');
  const [openId, setOpenId] = useState(null);
  const [linking, setLinking] = useState(null);
  const [scheduling, setScheduling] = useState(null);

  const iot = useQuery(listIotDevices, []);
  const modelMap = useQuery(listIotModelMap, []);
  useRealtime(['iot_devices'], iot.refetch);
  // phase62: המילוי האחרון לכל מכשיר במערכת — לימים עד ריק במכשירים בלי מד
  const linkedIds = useMemo(() => (iot.data ?? []).map((r) => r.device?.id).filter(Boolean), [iot.data]);
  const refills = useQuery(() => listLastRefills(linkedIds), [linkedIds.join(',')]);
  const lastRefillOf = useMemo(() => {
    const m = new Map();
    (refills.data ?? []).forEach((r) => { if (!m.has(r.device_id)) m.set(r.device_id, r); });
    return m;
  }, [refills.data]);
  // phase63: כמות המילוי שמוגדרת לדגם במערכת (לא גודל המיכל של היצרן)
  const caps = useQuery(listModelCapacity, []);
  const capOf = useMemo(() => new Map((caps.data ?? []).map((m) => [m.name, Number(m.capacity_ml) || null])), [caps.data]);

  const modelNameOf = useMemo(() => {
    const map = new Map((modelMap.data ?? []).map((m) => [m.supplier_model, m.iconair_model]));
    return (row) => row.device?.model || map.get(row.supplier_model) || null;
  }, [modelMap.data]);

  // מצב השמן והחומרה לכל מכשיר — מחושב פעם אחת
  const enriched = useMemo(() => (iot.data ?? []).map((row) => {
    const modelName = modelNameOf(row);
    const oil = oilInfo(
      row,
      modelMap.data,
      lastRefillOf.get(row.device?.id),
      Number(row.device?.fill_ml) || capOf.get(modelName),
    );
    return { row, oil, modelName, sev: severity(row, oil) };
  }), [iot.data, modelMap.data, lastRefillOf, capOf, modelNameOf]);

  // הספירות — בלי מכשירי ניסוי (הם לא אצל לקוחות)
  const field = enriched.filter((e) => e.row.owner_type !== 'test');
  const counts = {
    all: field.length,
    online: field.filter((e) => e.row.online).length,
    offline: field.filter((e) => !e.row.online).length,
    low: field.filter((e) => e.oil.low).length,
    none: field.filter((e) => !e.row.owner_type).length,
  };
  const testCount = enriched.length - field.length;
  const lastSync = enriched.reduce((max, e) => (e.row.last_sync_at > max ? e.row.last_sync_at : max), '');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return enriched.filter(({ row, oil }) => {
      // מכשירי ניסוי מוסתרים, אלא אם בוחרים "ניסוי" במסנן הסוג
      if (row.owner_type === 'test' && typeFilter !== 'test') return false;
      if (typeFilter === 'none' && row.owner_type) return false;
      if (typeFilter && typeFilter !== 'none' && row.owner_type !== typeFilter) return false;
      if (kpiFilter === 'online' && !row.online) return false;
      if (kpiFilter === 'offline' && row.online) return false;
      if (kpiFilter === 'low' && !oil.low) return false;
      if (kpiFilter === 'none' && row.owner_type) return false;
      if (!q) return true;
      return [row.aroma_name, row.mac, row.owner_name, row.owner_phone, row.device?.serial, row.device?.location_note, row.device?.customer?.name, row.device?.customer?.city]
        .some((v) => String(v ?? '').toLowerCase().includes(q));
    });
  }, [enriched, search, typeFilter, kpiFilter]);

  // קיבוץ לפי לקוח: לקוח עם כמה מכשירים מוצג ככותרת + המכשירים שלו
  const groups = useMemo(() => {
    const map = new Map();
    filtered.forEach((e) => {
      const cust = e.row.owner_type === 'rental' ? e.row.device?.customer : null;
      // השאילתה מחזירה את הלקוח בלי id — מקבצים לפי שם + עיר
      const key = cust?.name ? `c:${cust.name}|${cust.city ?? ''}` : `r:${e.row.id}`;
      if (!map.has(key)) map.set(key, { key, name: displayName(e.row), city: cust?.city ?? null, items: [] });
      map.get(key).items.push(e);
    });
    const list = [...map.values()];
    list.forEach((g) => {
      g.items.sort((a, b) => a.sev - b.sev || String(subLine(a.row)).localeCompare(String(subLine(b.row)), 'he'));
      g.sev = Math.min(...g.items.map((i) => i.sev));
    });
    list.sort((a, b) => a.sev - b.sev || a.name.localeCompare(b.name, 'he'));
    return list;
  }, [filtered]);

  const toggleKpi = (k) => setKpiFilter((cur) => (cur === k ? '' : k));
  const toggleOpen = (id) => setOpenId((cur) => (cur === id ? null : id));

  const rowProps = (e, nested) => ({
    row: e.row,
    oil: e.oil,
    modelName: e.modelName,
    open: openId === e.row.id,
    onToggle: () => toggleOpen(e.row.id),
    isAdmin,
    onClassify: setLinking,
    onSchedule: setScheduling,
    nested,
  });

  return (
    <>
      <GlassCard className="mb-3.5">
        <CardHead
          icon={DeviceIcon}
          tone="teal"
          title="צי חכם"
          subtitle={`פיילוט · נתונים מ-Aroma Link · סנכרון אחרון ${lastSync ? relativeTime(lastSync) : '—'}`}
        />
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
          <Kpi label="מחוברים לענן" value={counts.all} active={kpiFilter === ''} onClick={() => setKpiFilter('')} />
          <Kpi label="מקוונים" value={counts.online} tone="text-ok" active={kpiFilter === 'online'} onClick={() => toggleKpi('online')} />
          <Kpi label="מנותקים" value={counts.offline} tone={counts.offline ? 'text-crit' : 'text-text'} active={kpiFilter === 'offline'} onClick={() => toggleKpi('offline')} />
          <Kpi label="מיכל נמוך (עד 7 ימים)" value={counts.low} tone={counts.low ? 'text-warn' : 'text-text'} active={kpiFilter === 'low'} onClick={() => toggleKpi('low')} />
          <Kpi label="לא מסווגים" value={counts.none} tone={counts.none ? 'text-gold-600' : 'text-text'} active={kpiFilter === 'none'} onClick={() => toggleKpi('none')} />
        </div>
        {counts.all > 0 && (
          <div className="mt-3.5">
            <div className="mb-1.5 flex items-baseline justify-between text-[13px]">
              <span className="font-semibold text-text-faint">זמינות הצי עכשיו</span>
              <span className="tabular font-bold">
                {Math.round((counts.online / counts.all) * 100)}%
                <span className="ms-1.5 font-medium text-text-faint">{counts.online} מתוך {counts.all} מקוונים</span>
              </span>
            </div>
            <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-slate-500/15">
              <span className="h-full bg-ok transition-all" style={{ width: `${(counts.online / counts.all) * 100}%` }} />
              <span className="h-full bg-crit/70 transition-all" style={{ width: `${(counts.offline / counts.all) * 100}%` }} />
            </div>
          </div>
        )}
      </GlassCard>

      <ScreenToolbar
        search={search}
        onSearch={setSearch}
        searchPlaceholder="חיפוש לפי לקוח, מיקום, טלפון, עיר או MAC…"
        count={filtered.length}
        countLabel="מכשירים"
        filters={[
          {
            key: 'type',
            value: typeFilter,
            onChange: setTypeFilter,
            placeholder: 'כל הסוגים (בלי ניסוי)',
            options: [...OWNER_OPTIONS.map((o) => (o.value === 'test' ? { ...o, label: `ניסוי (${testCount})` } : o)), { value: 'none', label: 'לא מסווג' }],
          },
        ]}
      />

      <GlassCard>
        <Async
          loading={iot.loading}
          error={iot.error}
          onRetry={iot.refetch}
          isEmpty={filtered.length === 0}
          empty={
            <EmptyState
              title={enriched.length ? 'אין מכשיר שתואם את הסינון' : 'עוד אין מכשירים מהענן'}
              hint={enriched.length ? 'נקה את החיפוש או לחץ על "מחוברים לענן".' : 'המכשירים יופיעו כאן אחרי הסנכרון הראשון מ-Aroma Link.'}
            />
          }
        >
          {/* כותרות עמודות — רק במחשב */}
          <div className={`hidden px-4 pb-2 text-[13px] font-semibold text-text-faint ${GRID}`}>
            <span>לקוח ומיקום</span>
            <span>מצב</span>
            <span>שמן</span>
            <span>צריכה ביום</span>
            <span>שעון היום</span>
            <span />
          </div>

          <div className="flex flex-col gap-2.5">
            {groups.map((g) => (g.items.length === 1 ? (
              <DeviceRow key={g.key} {...rowProps(g.items[0], false)} />
            ) : (
              <div key={g.key} className="rounded-2xl border border-slate-500/15 bg-slate-500/[0.03] p-2">
                <div className="flex flex-wrap items-baseline justify-between gap-2 px-2 pb-2 pt-1">
                  <div className="min-w-0">
                    <span className="text-[15.5px] font-bold">{g.name}</span>
                    {g.city && <span className="ms-2 text-[13px] text-text-faint">{g.city}</span>}
                  </div>
                  <span className="text-[13px] text-text-faint">
                    {g.items.length} מכשירים
                    {g.items.some((i) => !i.row.online) && (
                      <span className="ms-1.5 font-semibold text-crit-soft">· {g.items.filter((i) => !i.row.online).length} מנותקים</span>
                    )}
                  </span>
                </div>
                <div className="flex flex-col gap-1.5">
                  {g.items.map((e) => <DeviceRow key={e.row.id} {...rowProps(e, true)} />)}
                </div>
              </div>
            )))}
          </div>
        </Async>
      </GlassCard>

      {isAdmin && (
        <LinkModal
          row={linking}
          modelOptions={(modelMap.data ?? []).map((m) => ({ value: m.supplier_model, label: `${m.supplier_model} · ${m.iconair_model}` }))}
          onClose={() => setLinking(null)}
          onSaved={() => { setLinking(null); iot.refetch(); }}
        />
      )}

      {isAdmin && (
        <ScheduleModal
          row={scheduling}
          onClose={() => setScheduling(null)}
          onSent={() => iot.refetch()}
        />
      )}
    </>
  );
}

/** סיווג מכשיר ענן: לקוח שכירות (מכשיר במערכת) / לקוח פרטי (שם + טלפון) / ניסוי, ודגם */
function LinkModal({ row, modelOptions, onClose, onSaved }) {
  const [ownerType, setOwnerType] = useState('');
  const [deviceId, setDeviceId] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [ownerPhone, setOwnerPhone] = useState('');
  const [supplierModel, setSupplierModel] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const devices = useQuery(listLinkableDevices, [], { enabled: !!row && ownerType === 'rental' });

  const rowId = row?.id;
  useEffect(() => {
    setOwnerType(row?.owner_type ?? '');
    setDeviceId(row?.device?.id ?? '');
    setOwnerName(row?.owner_name ?? '');
    setOwnerPhone(row?.owner_phone ?? '');
    setSupplierModel(row?.supplier_model ?? '');
    setError('');
  }, [rowId]); // eslint-disable-line react-hooks/exhaustive-deps

  const deviceOptions = (devices.data ?? []).map((d) => ({
    value: d.id,
    label: `${d.serial} · ${d.model} · ${d.customer?.name ?? ''}${d.location_note ? ` · ${d.location_note}` : ''}`,
  }));

  async function save() {
    if (ownerType === 'rental' && !deviceId) {
      setError('ללקוח שכירות צריך לבחור את המכשיר במערכת');
      return;
    }
    if (ownerType === 'private' && !ownerName.trim()) {
      setError('ללקוח פרטי צריך לרשום שם');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await updateIotDevice(row.id, {
        owner_type: ownerType || null,
        device_id: ownerType === 'rental' ? deviceId : null,
        owner_name: ownerType === 'private' ? ownerName.trim() : null,
        owner_phone: ownerType === 'private' ? (ownerPhone.trim() || null) : null,
        supplier_model: supplierModel || null,
      });
      onSaved();
    } catch (e) {
      setError(e.message || 'השמירה נכשלה');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={!!row}
      title="סיווג מכשיר"
      subtitle={row ? `בענן: ${row.aroma_name ?? ''} · MAC ${row.mac ?? ''}` : ''}
      onClose={onClose}
      footer={
        <>
          <SecondaryButton onClick={onClose}>ביטול</SecondaryButton>
          <PrimaryButton onClick={save} loading={saving}>שמירה</PrimaryButton>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="סוג">
          <Select value={ownerType} onChange={(e) => setOwnerType(e.target.value)} options={OWNER_OPTIONS} placeholder="לא מסווג" />
        </Field>

        {ownerType === 'rental' && (
          <Field label="מכשיר במערכת" hint="המכשיר הפיזי אצל הלקוח, מתוך טאב מכשירים">
            <Select value={deviceId} onChange={(e) => setDeviceId(e.target.value)} options={deviceOptions} placeholder="בחר מכשיר" />
          </Field>
        )}

        {ownerType === 'private' && (
          <>
            <Field label="שם הלקוח" required>
              <TextInput value={ownerName} onChange={(e) => setOwnerName(e.target.value)} placeholder="למשל: בר קיוסק" />
            </Field>
            <Field label="טלפון">
              <TextInput value={ownerPhone} onChange={(e) => setOwnerPhone(e.target.value)} placeholder="05X-XXX-XXXX" inputMode="tel" dir="ltr" />
            </Field>
          </>
        )}

        <Field label="דגם אצל היצרן">
          <Select value={supplierModel} onChange={(e) => setSupplierModel(e.target.value)} options={modelOptions} placeholder="לא ידוע" />
        </Field>
        {error && <p className="text-[14px] font-semibold text-crit-soft">{error}</p>}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------
// עריכת שעון ועוצמה (phase57)
// ---------------------------------------------------------------------
const DAY_SHORT = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
const LEVELS = [
  { value: '1', label: 'A (חלש)' },
  { value: '2', label: 'B (בינוני)' },
  { value: '3', label: 'C (חזק)' },
];
const LEVEL_LETTER = { 1: 'A', 2: 'B', 3: 'C' };
const EMPTY_PROGRAM = { enabled: false, start: '08:00', end: '20:00', work_sec: 10, pause_sec: 120, level: 1 };

function normPrograms(programs) {
  const list = (programs ?? []).slice(0, 5).map((p) => ({
    enabled: !!p.enabled,
    start: p.start || '00:00',
    end: p.end || '00:00',
    work_sec: Number(p.work_sec) || 10,
    pause_sec: Number(p.pause_sec) || 120,
    level: Number(p.level) || 1,
  }));
  while (list.length < 5) list.push({ ...EMPTY_PROGRAM });
  return list;
}

function programKey(programs) {
  return JSON.stringify(normPrograms(programs).map((p) => (p.enabled ? [p.start, p.end, p.work_sec, p.pause_sec, p.level] : 0)));
}

function describe(p) {
  return `${p.start}–${p.end} · ריסוס ${p.work_sec}ש׳ · הפסקה ${p.pause_sec}ש׳ · עוצמה ${LEVEL_LETTER[p.level] ?? p.level}`;
}

function ScheduleModal({ row, onClose, onSent }) {
  const todayIdx = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' })).getDay();
  const [templateDay, setTemplateDay] = useState(todayIdx);
  const [programs, setPrograms] = useState(normPrograms([]));
  const [weeks, setWeeks] = useState([todayIdx]);
  const [step, setStep] = useState('edit'); // edit → confirm → done
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  const log = useQuery(() => listCommandLog(row.id), [row?.id, step], { enabled: !!row });

  const scheduleOf = (day) => (Array.isArray(row?.schedule) ? row.schedule.find((d) => d.week === day)?.programs : null);

  // טעינת תבנית מיום מסוים + סימון כל הימים שיש להם בדיוק אותו שעון
  function loadDay(day) {
    setTemplateDay(day);
    const progs = normPrograms(scheduleOf(day) ?? []);
    setPrograms(progs);
    const key = programKey(progs);
    const same = [0, 1, 2, 3, 4, 5, 6].filter((d) => programKey(scheduleOf(d) ?? []) === key);
    setWeeks(same.length ? same : [day]);
  }

  const rowId = row?.id;
  useEffect(() => {
    if (!row) return;
    setStep('edit');
    setError('');
    setResult(null);
    loadDay(todayIdx);
  }, [rowId]); // eslint-disable-line react-hooks/exhaustive-deps

  function setProgram(i, patch) {
    setPrograms((prev) => prev.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  }

  function toggleWeek(d) {
    setWeeks((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort()));
  }

  function check() {
    if (!weeks.length) return 'צריך לבחור לפחות יום אחד';
    for (let i = 0; i < 5; i++) {
      const p = programs[i];
      if (!p.enabled) continue;
      if (!(p.end > p.start)) return `תוכנית ${i + 1}: שעת הסיום חייבת להיות אחרי שעת ההתחלה`;
      if (p.work_sec < 5 || p.work_sec > 900) return `תוכנית ${i + 1}: זמן ריסוס בין 5 ל-900 שניות`;
      if (p.pause_sec < 5 || p.pause_sec > 900) return `תוכנית ${i + 1}: זמן הפסקה בין 5 ל-900 שניות`;
    }
    return '';
  }

  function toConfirm() {
    const msg = check();
    setError(msg);
    if (!msg) setStep('confirm');
  }

  async function send() {
    setSending(true);
    setError('');
    try {
      const r = await sendWorkTime(row.id, weeks, programs);
      setResult(r);
      setStep('done');
      onSent();
    } catch (e) {
      setError(e.message || 'השליחה נכשלה');
    } finally {
      setSending(false);
    }
  }

  const before = normPrograms(scheduleOf(templateDay) ?? []);

  const footer =
    step === 'edit' ? (
      <>
        <SecondaryButton onClick={onClose}>ביטול</SecondaryButton>
        <PrimaryButton onClick={toConfirm}>המשך לאישור</PrimaryButton>
      </>
    ) : step === 'confirm' ? (
      <>
        <SecondaryButton onClick={() => setStep('edit')} disabled={sending}>חזרה לעריכה</SecondaryButton>
        <PrimaryButton onClick={send} loading={sending}>שלח למכשיר</PrimaryButton>
      </>
    ) : (
      <PrimaryButton onClick={onClose}>סגירה</PrimaryButton>
    );

  return (
    <Modal
      open={!!row}
      title="שעון ועוצמה"
      wide
      subtitle={row ? `${displayName(row)} · ${row.aroma_name ?? ''}` : ''}
      onClose={onClose}
      footer={footer}
    >
      {step === 'edit' && (
        <div className="flex flex-col gap-4">
          <Field label="טען את השעון של יום" hint="הימים עם אותו שעון בדיוק מסומנים אוטומטית למטה">
            <div className="flex flex-wrap gap-1.5">
              {DAY_SHORT.map((d, i) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => loadDay(i)}
                  className={`chip ${templateDay === i ? 'text-gold-600 border-gold-500/30 bg-gold-500/[0.14]' : ''}`}
                >
                  {d}
                </button>
              ))}
            </div>
          </Field>

          {programs.map((p, i) => (
            <div key={i} className="inner-row flex flex-col gap-2.5 px-3 py-3">
              <label className="flex items-center gap-2 text-[15px] font-bold">
                <input type="checkbox" checked={p.enabled} onChange={(e) => setProgram(i, { enabled: e.target.checked })} />
                תוכנית {i + 1}
                {!p.enabled && <span className="text-[13px] font-medium text-text-faint">(כבויה)</span>}
              </label>
              {p.enabled && (
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-5">
                  <Field label="התחלה">
                    <TextInput type="time" value={p.start} onChange={(e) => setProgram(i, { start: e.target.value })} dir="ltr" />
                  </Field>
                  <Field label="סיום">
                    <TextInput type="time" value={p.end} onChange={(e) => setProgram(i, { end: e.target.value })} dir="ltr" />
                  </Field>
                  <Field label="ריסוס (שנ׳)">
                    <TextInput type="number" min={5} max={900} value={p.work_sec} onChange={(e) => setProgram(i, { work_sec: Number(e.target.value) })} dir="ltr" />
                  </Field>
                  <Field label="הפסקה (שנ׳)">
                    <TextInput type="number" min={5} max={900} value={p.pause_sec} onChange={(e) => setProgram(i, { pause_sec: Number(e.target.value) })} dir="ltr" />
                  </Field>
                  <Field label="עוצמה">
                    <Select value={String(p.level)} onChange={(e) => setProgram(i, { level: Number(e.target.value) })} options={LEVELS} />
                  </Field>
                </div>
              )}
            </div>
          ))}

          <Field label="להחיל על הימים">
            <div className="flex flex-wrap gap-3">
              {DAY_SHORT.map((d, i) => (
                <label key={d} className="flex items-center gap-1.5 text-[15px] font-semibold">
                  <input type="checkbox" checked={weeks.includes(i)} onChange={() => toggleWeek(i)} />
                  {d}
                </label>
              ))}
            </div>
          </Field>
          {error && <p className="text-[14px] font-semibold text-crit-soft">{error}</p>}
        </div>
      )}

      {step === 'confirm' && (
        <div className="flex flex-col gap-3 text-[15px]">
          <p className="font-bold">
            לשלוח את השעון הזה למכשיר, לימים: {weeks.map((w) => DAY_SHORT[w]).join(', ')}?
          </p>
          {programs.map((p, i) => {
            const was = before[i];
            const changed = programKey([p]) !== programKey([was]);
            return (
              <div key={i} className="inner-row px-3 py-2.5">
                <div className="font-semibold">
                  תוכנית {i + 1}: {p.enabled ? describe(p) : 'כבויה'}
                  {changed && <span className="ms-2 text-[13px] text-gold-600">שינוי</span>}
                </div>
                {changed && (
                  <div className="text-[13px] text-text-faint">היה ({DAY_SHORT[templateDay]}): {was.enabled ? describe(was) : 'כבויה'}</div>
                )}
              </div>
            );
          })}
          <p className="text-[13.5px] text-text-faint">השעון הקודם נשמר ביומן, כך שתמיד אפשר לחזור אליו.</p>
          {error && <p className="text-[14px] font-semibold text-crit-soft">{error}</p>}
        </div>
      )}

      {step === 'done' && (
        <div className="flex flex-col gap-2 text-[15px]">
          {result?.verified ? (
            <p className="font-bold text-ok">✓ השעון נשלח ונקלט במכשיר.</p>
          ) : (
            <p className="font-bold text-warn">השינוי נשלח, אבל המכשיר עוד לא אישר אותו. בדוק שוב בעוד דקה.</p>
          )}
        </div>
      )}

      {(log.data ?? []).length > 0 && (
        <div className="mt-5 flex flex-col gap-1.5">
          <span className="text-[13.5px] font-bold text-text-dim">שינויים אחרונים</span>
          {log.data.map((l) => (
            <div key={l.id} className="flex items-baseline justify-between gap-3 text-[13px] text-text-faint">
              <span className="truncate">
                {(l.payload?.weeks ?? []).map((w) => DAY_SHORT[w]).join(',')} · {l.created_by_email ?? ''}
              </span>
              <span className="flex-none">
                {l.ok === true ? '✓' : l.ok === false ? '✗' : '…'} {relativeTime(l.created_at)}
              </span>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
