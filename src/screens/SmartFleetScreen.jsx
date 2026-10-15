import { useEffect, useMemo, useState } from 'react';
import GlassCard, { CardHead } from '../components/ui/GlassCard';
import { StatusChip } from '../components/ui/DataTable';
import ScreenToolbar from '../components/ui/ScreenToolbar';
import Modal from '../components/ui/Modal';
import { Field, Select, TextInput, PrimaryButton, SecondaryButton } from '../components/ui/Field';
import { Async, EmptyState } from '../components/ui/States';
import { DeviceIcon } from '../components/ui/Icons';
import FleetMap from '../components/FleetMap';
import DeviceHistory from '../components/DeviceHistory';
import GroupControlModal from '../components/GroupControlModal';
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
  listFleetRouteMaps,
  listMapLocations,
} from '../lib/smartFleetQueries';

/**
 * צי חכם — מצב חי של המכשירים שמחוברים לענן Aroma Link.
 * הנתונים מגיעים מ-/api/aroma-sync כל 5 דקות.
 * פעולות מנהל: סיווג מכשיר (שכירות / פרטי / ניסוי) ודגם, ועריכת שעון ועוצמה
 * (phase57) — רק במכשירים ש-control_enabled שלהם פעיל (phase72: מתג בחלון הסיווג).
 *
 * phase66 (עיצוב מחדש): שורה נקייה + פירוט בלחיצה, בעיות קודם, קיבוץ לפי לקוח,
 * כרטיסי סיכום שמסננים בלחיצה, מכשירי ניסוי מוסתרים כברירת מחדל,
 * ובטלפון כרטיס קצר שנפתח בנגיעה. המכשירים מחולקים לפי קו (כמו מסך המסלולים),
 * ובתוך כל קו לפי לקוח.
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
    const parts = [row.device.site?.label, row.device.location_note].filter(Boolean);
    return parts.length ? parts.join(' · ') : (row.device.customer?.city || row.device.serial);
  }
  if (row.owner_type === 'private' && row.owner_phone) return `${row.owner_phone} · בענן: ${row.aroma_name ?? ''}`;
  return `בענן: ${row.aroma_name ?? ''}`;
}

const NO_LINE = 'ללא שיוך לקו';

/**
 * הקו של מכשיר — אותו כלל בדיוק כמו effectiveDeviceRoute במסך המסלולים (queries.js):
 * אתר (לקוח ריבוי-כתובות) → לפי עיר האתר בלבד; מכשיר עם עיר משלו → לפי העיר,
 * ואם לא ממופה → הקו של הלקוח; אחרת → הקו של הלקוח.
 */
function lineOf(row, cityRoutes) {
  const d = row.owner_type === 'rental' ? row.device : null;
  if (!d) return NO_LINE;
  const byCity = (c) => (c?.trim() ? cityRoutes.get(c.trim()) ?? null : null);
  const customerLine = d.customer?.route_name?.trim() || null;
  let line;
  if (d.site) line = byCity(d.site.city);
  else if (d.city?.trim()) line = byCity(d.city) ?? customerLine;
  else line = customerLine;
  return line || NO_LINE;
}

function subRouteOf(row, subRoutes) {
  const d = row.owner_type === 'rental' ? row.device : null;
  const id = d?.site ? d.site.sub_route_id : d?.customer?.sub_route_id;
  return id ? subRoutes.get(id) ?? null : null;
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

const PILL = {
  ok: 'text-ok border-ok/25 bg-ok/10',
  warn: 'text-warn border-warn/30 bg-warn/[0.09]',
  crit: 'text-crit-soft border-crit/30 bg-crit/10',
  slate: 'text-slate-500 border-slate-500/25 bg-slate-500/10',
};

function StateBadge({ row, compact = false }) {
  const s = liveState(row);
  return (
    <span className="inline-flex flex-col items-start gap-0.5">
      <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-[13px] font-bold ${PILL[s.tone] ?? PILL.slate}`}>
        <span className="relative flex h-2 w-2 flex-none">
          {s.tone === 'ok' && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-ok opacity-60" />}
          {s.tone === 'crit' && <span className="absolute inline-flex h-full w-full animate-pulse rounded-full bg-crit opacity-50" />}
          <span className={`relative inline-flex h-2 w-2 rounded-full ${DOT[s.tone] ?? 'bg-slate-400'}`} />
        </span>
        {s.label}
      </span>
      {!row.online && !compact && (
        <span className="ps-1 text-[12px] font-medium text-text-faint">מנותק {relativeTime(row.last_online_at)}</span>
      )}
    </span>
  );
}

/** תא השמן: מיכל באחוזים (אם יש מד) + ימים עד ריק */
function OilCell({ oil }) {
  if (oil.pct == null && oil.days == null) {
    return <span className="text-[12.5px] text-text-faint">ממתין לנתונים</span>;
  }
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
  if (!today) return <span className="text-[12.5px] text-text-faint" title="השעון נקרא מהענן פעם ביום לכל מכשיר">ממתין לקריאת שעון</span>;
  if (!today.programs.length) return <span className="text-[13px] text-text-faint">לא פועל היום</span>;
  const list = full ? today.programs : today.programs.slice(0, 1);
  return (
    <div className="tabular flex flex-col gap-0.5 leading-tight">
      {list.map((p, i) => (
        <div key={i}>
          <div className="text-[14px] font-semibold" dir="ltr" style={{ textAlign: 'right' }}>{p.start} – {p.end}</div>
          <div className="text-[12px] text-text-faint">ריסוס {p.work_sec} שנ׳ · הפסקה {p.pause_sec} שנ׳</div>
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

const GRID = 'md:grid md:grid-cols-[minmax(190px,1.5fr)_minmax(120px,1fr)_minmax(150px,1.1fr)_minmax(80px,0.7fr)_minmax(150px,1.1fr)_20px] md:items-center md:gap-5';

function DeviceRow({ row, oil, modelName, line, subRoute, open, onToggle, isAdmin, onClassify, onSchedule, nested }) {
  const owner = OWNER_TYPES[row.owner_type];
  // פס צבע בצד השורה — סורקים בעין מה דורש טיפול
  const accent = row.owner_type === 'test' ? 'border-s-slate-400/40'
    : !row.online || oil.empty ? 'border-s-crit'
    : oil.low ? 'border-s-warn'
    : !owner ? 'border-s-gold-500'
    : 'border-s-ok/60';
  return (
    <div className={`inner-row overflow-hidden border-s-4 transition-colors hover:border-gold-300/40 ${accent} ${nested ? '!rounded-xl' : ''} ${open ? '!bg-gold-500/[0.06]' : ''}`}>
      <button type="button" onClick={onToggle} aria-expanded={open} className="block w-full cursor-pointer px-4 py-3 text-start">
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
          <span className="tabular text-[14px] font-semibold">{oil.usage != null ? `${oil.usage.toFixed(1)} מ״ל` : <span className="text-[12.5px] font-normal text-text-faint">—</span>}</span>
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
            <Detail label="קו">{line}{subRoute ? ` · ${subRoute}` : ''}</Detail>
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
          <div className="mt-4 border-t border-slate-500/15 pt-4">
            <DeviceHistory row={row} />
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
  const [lineFilter, setLineFilter] = useState('');
  const [view, setView] = useState('list'); // list | map (phase67)
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [openId, setOpenId] = useState(null);
  const [linking, setLinking] = useState(null);
  const [scheduling, setScheduling] = useState(null);
  const [groupCtl, setGroupCtl] = useState(null); // phase71: שליטה קבוצתית

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

  // phase66: מפות הקווים — לקיבוץ לפי קו כמו במסך המסלולים
  const routeMaps = useQuery(listFleetRouteMaps, []);
  const cityRouteMap = useMemo(
    () => new Map((routeMaps.data?.cityRoutes ?? []).filter((r) => r.city?.trim()).map((r) => [r.city.trim(), r.route_name])),
    [routeMaps.data],
  );
  const subRouteMap = useMemo(
    () => new Map((routeMaps.data?.subRoutes ?? []).map((r) => [r.id, r.name])),
    [routeMaps.data],
  );

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
    return {
      row, oil, modelName, sev: severity(row, oil),
      line: lineOf(row, cityRouteMap),
      subRoute: subRouteOf(row, subRouteMap),
    };
  }), [iot.data, modelMap.data, lastRefillOf, capOf, modelNameOf, cityRouteMap, subRouteMap]);

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
    return enriched.filter(({ row, oil, line }) => {
      if (lineFilter && line !== lineFilter) return false;
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
  }, [enriched, search, typeFilter, kpiFilter, lineFilter]);

  // phase67: מפה חיה — כל המיקומים בשטח, צבועים לפי מצב המכשירים המחוברים לענן
  const mapQuery = useQuery(listMapLocations, [], { enabled: view === 'map' });
  const mapLocations = useMemo(() => {
    if (!mapQuery.data) return [];
    const iotByDevice = new Map();
    enriched.forEach((e) => {
      if (e.row.owner_type === 'rental' && e.row.device?.id) {
        iotByDevice.set(e.row.device.id, { online: e.row.online, low: e.oil.low, pct: e.oil.pct, where: subLine(e.row) });
      }
    });
    const q = search.trim().toLowerCase();
    return mapQuery.data
      .map((loc) => {
        const iot = loc.deviceIds.map((id) => iotByDevice.get(id)).filter(Boolean);
        const tone = iot.some((i) => !i.online) ? 'crit' : iot.some((i) => i.low) ? 'warn' : iot.length ? 'ok' : 'none';
        const line = loc.kind === 'site'
          ? (loc.city?.trim() ? cityRouteMap.get(loc.city.trim()) ?? NO_LINE : NO_LINE)
          : (loc.routeName || NO_LINE);
        return { ...loc, iot, tone, line };
      })
      .filter((loc) => {
        if (lineFilter && loc.line !== lineFilter) return false;
        if (kpiFilter === 'offline' && loc.tone !== 'crit') return false;
        if (kpiFilter === 'low' && !loc.iot.some((i) => i.low)) return false;
        if (kpiFilter === 'online' && !loc.iot.some((i) => i.online)) return false;
        if (kpiFilter === 'none') return false;
        if (q && ![loc.name, loc.address, loc.city].some((v) => String(v ?? '').toLowerCase().includes(q))) return false;
        return true;
      });
  }, [mapQuery.data, enriched, cityRouteMap, lineFilter, kpiFilter, search]);

  const lineOptions = useMemo(
    () => [...new Set(enriched.filter((e) => e.row.owner_type !== 'test').map((e) => e.line))]
      .sort((a, b) => (a === NO_LINE) - (b === NO_LINE) || a.localeCompare(b, 'he'))
      .map((l) => ({ value: l, label: l })),
    [enriched],
  );

  // קיבוץ: קו → לקוח → מכשירים. לקוח עם כמה מכשירים מוצג ככותרת + המכשירים שלו.
  const lines = useMemo(() => {
    const byLine = new Map();
    filtered.forEach((e) => {
      if (!byLine.has(e.line)) byLine.set(e.line, new Map());
      const groups = byLine.get(e.line);
      const cust = e.row.owner_type === 'rental' ? e.row.device?.customer : null;
      // השאילתה מחזירה את הלקוח בלי id — מקבצים לפי שם + עיר
      const key = cust?.name ? `c:${cust.name}|${cust.city ?? ''}` : `r:${e.row.id}`;
      if (!groups.has(key)) groups.set(key, { key, name: displayName(e.row), city: cust?.city ?? null, items: [] });
      groups.get(key).items.push(e);
    });
    const list = [...byLine.entries()].map(([name, groupMap]) => {
      const groups = [...groupMap.values()];
      groups.forEach((g) => {
        g.items.sort((a, b) => a.sev - b.sev || String(subLine(a.row)).localeCompare(String(subLine(b.row)), 'he'));
        g.sev = Math.min(...g.items.map((it) => it.sev));
        g.subRoutes = [...new Set(g.items.map((it) => it.subRoute).filter(Boolean))];
      });
      groups.sort((a, b) => a.sev - b.sev || a.name.localeCompare(b.name, 'he'));
      const items = groups.flatMap((g) => g.items);
      return {
        name,
        groups,
        total: items.length,
        online: items.filter((it) => it.row.online).length,
        offline: items.filter((it) => !it.row.online && it.row.owner_type !== 'test').length,
        low: items.filter((it) => it.oil.low).length,
        sev: Math.min(...groups.map((g) => g.sev)),
      };
    });
    // קו עם בעיות קודם, אחר כך לפי שם; "ללא שיוך לקו" תמיד בסוף
    list.sort((a, b) => (a.name === NO_LINE) - (b.name === NO_LINE) || a.sev - b.sev || a.name.localeCompare(b.name, 'he'));
    return list;
  }, [filtered]);

  const toggleLine = (name) => setCollapsed((prev) => {
    const next = new Set(prev);
    if (next.has(name)) next.delete(name); else next.add(name);
    return next;
  });

  const toggleKpi = (k) => setKpiFilter((cur) => (cur === k ? '' : k));
  const toggleOpen = (id) => setOpenId((cur) => (cur === id ? null : id));

  const rowProps = (e, nested) => ({
    row: e.row,
    oil: e.oil,
    modelName: e.modelName,
    line: e.line,
    subRoute: e.subRoute,
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
              <span className="tabular flex items-baseline gap-2">
                <span className="font-medium text-text-faint">{counts.online} מתוך {counts.all} מקוונים</span>
                <span className="text-[15px] font-extrabold" dir="ltr">{Math.round((counts.online / counts.all) * 100)}%</span>
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
            key: 'line',
            value: lineFilter,
            onChange: setLineFilter,
            placeholder: 'כל הקווים',
            options: lineOptions,
          },
          {
            key: 'type',
            value: typeFilter,
            onChange: setTypeFilter,
            placeholder: 'כל הסוגים (בלי ניסוי)',
            options: [...OWNER_OPTIONS.map((o) => (o.value === 'test' ? { ...o, label: `ניסוי (${testCount})` } : o)), { value: 'none', label: 'לא מסווג' }],
          },
        ]}
      />

      {/* רשימה | מפה */}
      <div className="mb-3 flex justify-center sm:justify-start">
        <div className="inline-flex rounded-xl border border-slate-500/20 bg-slate-500/[0.06] p-1">
          {[['list', 'רשימה'], ['map', 'מפה חיה']].map(([v, label]) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              aria-pressed={view === v}
              className={`rounded-lg px-5 py-2 text-[14px] font-bold transition-colors ${
                view === v ? 'bg-gold-500/[0.18] text-gold-600 shadow-sm' : 'text-text-faint hover:text-text'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {view === 'map' && (
        <GlassCard>
          <Async
            loading={mapQuery.loading && !mapQuery.data}
            error={mapQuery.error}
            onRetry={mapQuery.refetch}
            isEmpty={false}
          >
            <FleetMap locations={mapLocations} onSaved={mapQuery.refetch} />
          </Async>
        </GlassCard>
      )}

      {view === 'list' && (
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

          <div className="flex flex-col gap-5">
            {lines.map((ln) => {
              const isCollapsed = collapsed.has(ln.name);
              const pct = ln.total ? Math.round((ln.online / ln.total) * 100) : 0;
              return (
                <section key={ln.name} className="flex flex-col gap-2.5">
                  {/* כותרת קו — לחיצה מקפלת/פותחת */}
                  <button
                    type="button"
                    onClick={() => toggleLine(ln.name)}
                    aria-expanded={!isCollapsed}
                    className="flex w-full flex-wrap items-center justify-between gap-3 rounded-2xl border border-teal-500/20 bg-teal-500/[0.06] px-4 py-3 text-start transition-colors hover:bg-teal-500/[0.1]"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="grid h-10 w-10 flex-none place-items-center rounded-xl bg-teal-500/10 text-teal-500">
                        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </span>
                      <div className="min-w-0">
                        <div className="truncate text-[17px] font-extrabold">{ln.name}</div>
                        <div className="text-[12.5px] text-text-faint">{ln.total} מכשירים · {ln.groups.length} לקוחות</div>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {ln.offline > 0 && <StatusChip tone="crit">{ln.offline} מנותקים</StatusChip>}
                      {ln.low > 0 && <StatusChip tone="warn">{ln.low} מיכל נמוך</StatusChip>}
                      <span className="hidden items-center gap-2 sm:inline-flex">
                        <span className="relative h-2 w-20 overflow-hidden rounded-full bg-slate-500/15">
                          <span className="absolute inset-y-0 start-0 rounded-full bg-ok" style={{ width: `${pct}%` }} />
                        </span>
                        <span className="tabular text-[13px] font-bold" dir="ltr">{pct}%</span>
                      </span>
                      <Chevron open={!isCollapsed} />
                    </div>
                  </button>

                  {!isCollapsed && ln.groups.map((g) => (g.items.length === 1 ? (
                    <DeviceRow key={g.key} {...rowProps(g.items[0], false)} />
                  ) : (
                    <div key={g.key} className="rounded-2xl border border-slate-500/15 bg-slate-500/[0.04] p-2.5">
                      <div className="flex flex-wrap items-center justify-between gap-2 px-1.5 pb-2.5 pt-0.5">
                        <div className="flex min-w-0 items-center gap-2.5">
                          <span className="grid h-9 w-9 flex-none place-items-center rounded-xl bg-gold-500/[0.14] text-[15px] font-extrabold text-gold-600">
                            {g.items.length}
                          </span>
                          <div className="min-w-0">
                            <div className="truncate text-[16px] font-bold">{g.name}</div>
                            <div className="text-[12.5px] text-text-faint">
                              {g.city ? `${g.city} · ` : ''}{g.items.length} מכשירים{g.subRoutes.length ? ` · ${g.subRoutes.join(', ')}` : ''}
                            </div>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {isAdmin && (
                            <button
                              type="button"
                              onClick={() => setGroupCtl(g)}
                              className="rounded-[9px] border border-gold-500/30 bg-gold-500/[0.1] px-3 py-1 text-[13px] font-bold text-gold-600 transition-colors hover:bg-gold-500/[0.18]"
                            >
                              שליטה קבוצתית
                            </button>
                          )}
                          {g.items.some((it) => it.row.online) && (
                            <StatusChip tone="ok">{g.items.filter((it) => it.row.online).length} פעילים</StatusChip>
                          )}
                          {g.items.some((it) => !it.row.online) && (
                            <StatusChip tone="crit">{g.items.filter((it) => !it.row.online).length} מנותקים</StatusChip>
                          )}
                          {g.items.some((it) => it.oil.low) && (
                            <StatusChip tone="warn">{g.items.filter((it) => it.oil.low).length} מיכל נמוך</StatusChip>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-col gap-1.5">
                        {g.items.map((e) => <DeviceRow key={e.row.id} {...rowProps(e, true)} />)}
                      </div>
                    </div>
                  )))}
                </section>
              );
            })}
          </div>
        </Async>
      </GlassCard>
      )}

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

      {isAdmin && (
        <GroupControlModal
          group={groupCtl}
          onClose={() => setGroupCtl(null)}
          onDone={() => iot.refetch()}
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
  const [controlEnabled, setControlEnabled] = useState(false); // phase72
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
    setControlEnabled(!!row?.control_enabled);
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
        control_enabled: controlEnabled,
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

        {/* phase72: שליטה מרחוק — מדליקים רק אחרי שהשעון של המכשיר נקרא מהענן; לכבות אפשר תמיד */}
        {(() => {
          const clockRead = Array.isArray(row?.schedule) && row.schedule.length > 0;
          const locked = !clockRead && !controlEnabled;
          return (
            <div className={`inner-row flex flex-col gap-1.5 px-3 py-3 ${locked ? 'opacity-60' : ''}`}>
              <label className={`flex items-center justify-between gap-3 text-[15px] font-bold ${locked ? '' : 'cursor-pointer'}`}>
                <span>שליטה מרחוק (שעון ועוצמה מהמערכת)</span>
                <span className="flex items-center gap-2">
                  <span className={`text-[13px] font-semibold ${controlEnabled ? 'text-ok' : 'text-text-faint'}`}>{controlEnabled ? 'פעיל' : 'כבוי'}</span>
                  <input type="checkbox" disabled={locked} checked={controlEnabled} onChange={(e) => setControlEnabled(e.target.checked)} />
                </span>
              </label>
              <span className="text-[12.5px] text-text-faint">
                {locked
                  ? 'אפשר להפעיל אחרי שהשעון של המכשיר נקרא מהענן (פעם ביום).'
                  : 'מאפשר לשנות שעון ועוצמה למכשיר הזה מצי חכם, גם בשליטה קבוצתית. ההפעלה עצמה לא שולחת שום דבר למכשיר.'}
              </span>
            </div>
          );
        })()}
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
