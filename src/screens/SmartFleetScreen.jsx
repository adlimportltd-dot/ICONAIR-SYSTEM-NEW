import { useEffect, useMemo, useState } from 'react';
import GlassCard, { CardHead } from '../components/ui/GlassCard';
import DataTable, { StatusChip } from '../components/ui/DataTable';
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
} from '../lib/smartFleetQueries';

/**
 * צי חכם — מצב חי של המכשירים שמחוברים לענן Aroma Link.
 * שלב פיילוט: קריאה בלבד. הנתונים מגיעים מ-/api/aroma-sync כל 5 דקות.
 * פעולות מנהל: סיווג מכשיר (שכירות / פרטי / ניסוי) ודגם, ועריכת שעון ועוצמה
 * (phase57) — רק במכשירים ש-control_enabled שלהם פעיל (בהתחלה: ניסוי בלבד).
 */

/** סוג המכשיר — iot_devices.owner_type (phase56) */
const OWNER_TYPES = {
  rental:  { label: 'לקוח שכירות', tone: 'gold' },
  private: { label: 'לקוח פרטי',   tone: 'teal' },
  test:    { label: 'ניסוי',        tone: 'slate' },
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

function UsageCell({ row, models }) {
  const u = dailyUsage(row, models);
  if (!u) return <span className="text-[13px] text-text-faint">—</span>;
  return <span className="tabular text-[13.5px]">{u.ml.toFixed(1)} מ״ל</span>;
}

/** ימים עד ריק: עם מד מיכל — לפי האחוז; בלי מד — כמה ימים מחזיק מיכל מלא */
function DaysCell({ row, models }) {
  const u = dailyUsage(row, models);
  if (!u || !u.tank || u.ml <= 0) return <span className="text-[13px] text-text-faint">—</span>;
  if (row.has_oil_gauge && row.remain_oil != null) {
    const d = Math.floor(((Number(row.remain_oil) / 100) * u.tank) / u.ml);
    const tone = d <= 3 ? 'crit' : d <= 7 ? 'warn' : 'ok';
    return <StatusChip tone={tone}>{d} ימים</StatusChip>;
  }
  return <span className="tabular text-[12.5px] text-text-faint">מלא: {Math.floor(u.tank / u.ml)} ימים</span>;
}

function TankCell({ row }) { if (!row.has_oil_gauge || row.remain_oil == null) return <span className="text-[13px] text-text-faint">—</span>; const pct = Math.max(0, Math.min(100, Math.round(Number(row.remain_oil)))); const tone = pct <= 0 ? 'crit' : pct < 15 ? 'warn' : 'ok'; return <StatusChip tone={tone}>{pct <= 0 ? 'ריק' : pct + '%'}</StatusChip>; } function Kpi({ label, value, tone = 'text-text' }) {
  return (
    <div className="inner-row flex flex-col gap-1 px-4 py-3">
      <span className="text-[13px] font-medium text-text-faint">{label}</span>
      <span className={`tabular font-display text-[24px] font-extrabold ${tone}`}>{value}</span>
    </div>
  );
}

export default function SmartFleetScreen() {
  const { isAdmin } = useAuth();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [linking, setLinking] = useState(null);
  const [scheduling, setScheduling] = useState(null);

  const iot = useQuery(listIotDevices, []);
  const modelMap = useQuery(listIotModelMap, []);
  useRealtime(['iot_devices'], iot.refetch);

  const modelNameOf = useMemo(() => {
    const map = new Map((modelMap.data ?? []).map((m) => [m.supplier_model, m.iconair_model]));
    return (row) => row.device?.model || map.get(row.supplier_model) || null;
  }, [modelMap.data]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (iot.data ?? []).filter((row) => {
      if (statusFilter === 'online' && !row.online) return false;
      if (statusFilter === 'offline' && row.online) return false;
      if (typeFilter === 'none' && row.owner_type) return false;
      if (typeFilter && typeFilter !== 'none' && row.owner_type !== typeFilter) return false;
      if (!q) return true;
      return [row.aroma_name, row.mac, row.owner_name, row.owner_phone, row.device?.serial, row.device?.customer?.name, row.device?.customer?.city]
        .some((v) => String(v ?? '').toLowerCase().includes(q));
    });
  }, [iot.data, search, statusFilter, typeFilter]);

  const all = iot.data ?? [];
  const onlineCount = all.filter((r) => r.online).length;
  // מכשירי ניסוי לא נספרים כ"מנותקים" — הם לא אצל לקוחות
  const offlineCount = all.filter((r) => !r.online && r.owner_type !== 'test').length;
  const unclassified = all.filter((r) => !r.owner_type).length;
  const lastSync = all.reduce((max, r) => (r.last_sync_at > max ? r.last_sync_at : max), '');

  const columns = [
    {
      key: 'name',
      label: 'מכשיר',
      width: 'minmax(0,1.4fr)',
      render: (row) => (
        <div className="min-w-0">
          <div className="truncate font-semibold">{displayName(row)}</div>
          <div className="truncate text-[13px] text-text-faint">{subLine(row)}</div>
        </div>
      ),
    },
    {
      key: 'owner',
      label: 'סוג',
      width: '116px',
      render: (row) => {
        const t = OWNER_TYPES[row.owner_type];
        return t ? <StatusChip tone={t.tone}>{t.label}</StatusChip> : <span className="text-[13px] text-text-faint">לא מסווג</span>;
      },
    },
    {
      key: 'model',
      label: 'דגם',
      width: '120px',
      render: (row) => (
        <div className="leading-tight">
          <div className="font-semibold">{modelNameOf(row) ?? '—'}</div>
          {row.supplier_model && <div className="text-[12.5px] text-text-faint">{row.supplier_model}</div>}
        </div>
      ),
    },
    {
      key: 'state',
      label: 'מצב',
      width: '116px',
      render: (row) => {
        const s = liveState(row);
        return <StatusChip tone={s.tone}>{s.label}</StatusChip>;
      },
    },
    {
      key: 'tank', label: 'מיכל', width: '84px', render: (row) => <TankCell row={row} /> }, { key: 'usage', label: 'צריכה ביום', width: '92px', render: (row) => <UsageCell row={row} models={modelMap.data} /> }, { key: 'days', label: 'ימים עד ריק', width: '104px', render: (row) => <DaysCell row={row} models={modelMap.data} /> }, { key: 'today',
      label: 'שעון היום',
      width: '150px',
      render: (row) => {
        const today = todayPrograms(row.schedule);
        if (!today) return <span className="text-[13px] text-text-faint">עוד לא נקרא</span>;
        if (!today.programs.length) return <span className="text-[13px] text-text-faint">לא פועל היום</span>;
        const p = today.programs[0];
        return (
          <div className="tabular leading-tight">
            <div className="text-[14px] font-semibold">{p.start}–{p.end}</div>
            <div className="text-[12.5px] text-text-faint">
              {p.work_sec}ש׳ / {p.pause_sec}ש׳{today.programs.length > 1 ? ` · +${today.programs.length - 1}` : ''}
            </div>
          </div>
        );
      },
    },
    {
      key: 'seen',
      label: 'נראה לאחרונה',
      width: '112px',
      render: (row) => (
        <span className="tabular text-[13.5px] text-text-faint">
          {row.online ? relativeTime(row.last_sync_at) : relativeTime(row.last_online_at)}
        </span>
      ),
    },
    {
      key: 'fw',
      label: 'קושחה',
      width: '128px',
      render: (row) => <span className="font-mono text-[12.5px] text-text-faint">{row.firmware ?? '—'}</span>,
    },
  ];

  return (
    <>
      <GlassCard className="mb-3.5">
        <CardHead
          icon={DeviceIcon}
          tone="teal"
          title="צי חכם"
          subtitle={`פיילוט · נתונים מ-Aroma Link · סנכרון אחרון ${lastSync ? relativeTime(lastSync) : '—'}`}
        />
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <Kpi label="מחוברים לענן" value={all.length} />
          <Kpi label="מקוונים" value={onlineCount} tone="text-ok" />
          <Kpi label="מנותקים" value={offlineCount} tone={offlineCount ? 'text-crit' : 'text-text'} />
          <Kpi label="לא מסווגים" value={unclassified} tone={unclassified ? 'text-gold-600' : 'text-text'} />
        </div>
      </GlassCard>

      <ScreenToolbar
        search={search}
        onSearch={setSearch}
        searchPlaceholder="חיפוש לפי לקוח, טלפון, עיר או MAC…"
        count={rows.length}
        countLabel="מכשירים"
        filters={[
          {
            key: 'status',
            value: statusFilter,
            onChange: setStatusFilter,
            placeholder: 'כל המכשירים',
            options: [
              { value: 'online', label: 'מקוונים' },
              { value: 'offline', label: 'מנותקים' },
            ],
          },
          {
            key: 'type',
            value: typeFilter,
            onChange: setTypeFilter,
            placeholder: 'כל הסוגים',
            options: [...OWNER_OPTIONS, { value: 'none', label: 'לא מסווג' }],
          },
        ]}
      />

      <GlassCard>
        <Async
          loading={iot.loading}
          error={iot.error}
          onRetry={iot.refetch}
          isEmpty={rows.length === 0}
          empty={
            <EmptyState
              title={all.length ? 'אין מכשיר שתואם את הסינון' : 'עוד אין מכשירים מהענן'}
              hint={all.length ? 'נקה את החיפוש או המסנן.' : 'המכשירים יופיעו כאן אחרי הסנכרון הראשון מ-Aroma Link.'}
            />
          }
        >
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(row) => row.id}
            actions={isAdmin ? (row) => (
              <>
                <SecondaryButton className="!px-3 !py-2 !text-[13.5px]" onClick={(e) => { e.stopPropagation(); setLinking(row); }}>
                  סיווג
                </SecondaryButton>
                {row.control_enabled && (
                  <SecondaryButton
                    className="!px-3 !py-2 !text-[13.5px]"
                    disabled={!row.online}
                    title={row.online ? '' : 'המכשיר מנותק'}
                    onClick={(e) => { e.stopPropagation(); setScheduling(row); }}
                  >
                    שעון
                  </SecondaryButton>
                )}
              </>
            ) : undefined}
          />
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
