import { useEffect, useMemo, useState } from 'react';
import GlassCard, { CardHead } from '../components/ui/GlassCard';
import DataTable, { StatusChip } from '../components/ui/DataTable';
import ScreenToolbar from '../components/ui/ScreenToolbar';
import Modal from '../components/ui/Modal';
import { Field, Select, PrimaryButton, SecondaryButton } from '../components/ui/Field';
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
} from '../lib/smartFleetQueries';

/**
 * צי חכם — מצב חי של המכשירים שמחוברים לענן Aroma Link.
 * שלב פיילוט: קריאה בלבד. הנתונים מגיעים מ-/api/aroma-sync כל 5 דקות.
 * הפעולה היחידה כאן: מנהל משייך מכשיר ענן למכשיר במערכת + לדגם.
 */

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

function Kpi({ label, value, tone = 'text-text' }) {
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
  const [linking, setLinking] = useState(null);

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
      if (statusFilter === 'unlinked' && row.device) return false;
      if (!q) return true;
      return [row.aroma_name, row.mac, row.device?.serial, row.device?.customer?.name, row.device?.customer?.city]
        .some((v) => String(v ?? '').toLowerCase().includes(q));
    });
  }, [iot.data, search, statusFilter]);

  const all = iot.data ?? [];
  const onlineCount = all.filter((r) => r.online).length;
  const lastSync = all.reduce((max, r) => (r.last_sync_at > max ? r.last_sync_at : max), '');

  const columns = [
    {
      key: 'name',
      label: 'מכשיר',
      width: 'minmax(0,1.4fr)',
      render: (row) => (
        <div className="min-w-0">
          <div className="truncate font-semibold">{row.device?.customer?.name ?? row.aroma_name ?? '—'}</div>
          <div className="truncate text-[13px] text-text-faint">
            {row.device ? (row.device.location_note || row.device.customer?.city || row.device.serial) : `בענן: ${row.aroma_name ?? ''}`}
          </div>
        </div>
      ),
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
      key: 'today',
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
          <Kpi label="מנותקים" value={all.length - onlineCount} tone={all.length - onlineCount ? 'text-crit' : 'text-text'} />
          <Kpi label="לא משויכים ללקוח" value={all.filter((r) => !r.device).length} tone="text-gold-600" />
        </div>
      </GlassCard>

      <ScreenToolbar
        search={search}
        onSearch={setSearch}
        searchPlaceholder="חיפוש לפי לקוח, עיר או MAC…"
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
              { value: 'unlinked', label: 'לא משויכים' },
            ],
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
            onRowClick={isAdmin ? (row) => setLinking(row) : undefined}
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
    </>
  );
}

/** שיוך מכשיר ענן למכשיר במערכת (ומשם ללקוח) ולדגם */
function LinkModal({ row, modelOptions, onClose, onSaved }) {
  const devices = useQuery(listLinkableDevices, [], { enabled: !!row });
  const [deviceId, setDeviceId] = useState('');
  const [supplierModel, setSupplierModel] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const rowId = row?.id;
  useEffect(() => {
    setDeviceId(row?.device?.id ?? '');
    setSupplierModel(row?.supplier_model ?? '');
    setError('');
  }, [rowId]); // eslint-disable-line react-hooks/exhaustive-deps

  const deviceOptions = (devices.data ?? []).map((d) => ({
    value: d.id,
    label: `${d.serial} · ${d.model} · ${d.customer?.name ?? ''}${d.location_note ? ` · ${d.location_note}` : ''}`,
  }));

  async function save() {
    setSaving(true);
    setError('');
    try {
      await updateIotDevice(row.id, { device_id: deviceId || null, supplier_model: supplierModel || null });
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
      title="שיוך מכשיר"
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
        <Field label="מכשיר במערכת" hint="המכשיר הפיזי אצל הלקוח, מתוך טאב מכשירים">
          <Select value={deviceId} onChange={(e) => setDeviceId(e.target.value)} options={deviceOptions} placeholder="לא משויך" />
        </Field>
        <Field label="דגם אצל היצרן">
          <Select value={supplierModel} onChange={(e) => setSupplierModel(e.target.value)} options={modelOptions} placeholder="לא ידוע" />
        </Field>
        {error && <p className="text-[14px] font-semibold text-crit-soft">{error}</p>}
      </div>
    </Modal>
  );
}
