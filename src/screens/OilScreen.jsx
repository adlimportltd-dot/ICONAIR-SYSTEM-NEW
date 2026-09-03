import { useEffect, useMemo, useState } from 'react';
import GlassCard, { CardHead } from '../components/ui/GlassCard';
import DataTable, { StatusChip, MiniMeter, oilTone } from '../components/ui/DataTable';
import ScreenToolbar from '../components/ui/ScreenToolbar';
import Modal from '../components/ui/Modal';
import { Field, TextInput, TextArea, Select, PrimaryButton, SecondaryButton } from '../components/ui/Field';
import { Async, EmptyState } from '../components/ui/States';
import { useQuery } from '../hooks/useQuery';
import {
  listOilEntries, completeVisit, createOilEntry, listDeviceOptions, getOilByScent, listScents,
} from '../lib/queries';
import { describeError } from '../lib/supabase';
import { OIL_EVENT_LABEL, formatDateTime, formatNumber, mapOilByScent } from '../lib/mappers';

const EVENT_TONE = { refill: 'teal', replacement: 'gold', reading: 'slate' };

const STOCK_FILL = {
  teal: 'linear-gradient(90deg,#4CC9C0,#8FE3DC)',
  gold: 'linear-gradient(90deg,#C5A059,#D4AF37)',
  slate: 'linear-gradient(90deg,#6E86A8,#A3B6CE)',
  crit: 'linear-gradient(90deg,#F0555C,#F0A43A)',
};

const emptyForm = () => ({
  device_id: '', scent_name: '', event_type: 'refill',
  liters_added: '0.35', level_before_pct: '', level_after_pct: '100', notes: '',
});

export default function OilScreen() {
  const [search, setSearch] = useState('');
  const [formOpen, setFormOpen] = useState(false);

  const entries = useQuery(() => listOilEntries({ limit: 80 }), []);
  const scentUsage = useQuery(() => getOilByScent({ limit: 8 }), []);
  const devices = useQuery(listDeviceOptions, []);
  const scents = useQuery(listScents, []);

  // הסינון מקומי: כבר הורדנו 80 שורות, אין טעם לחזור לשרת על כל תו
  const filtered = useMemo(() => {
    const rows = entries.data ?? [];
    if (!search.trim()) return rows;

    const needle = search.trim().toLowerCase();
    return rows.filter((row) =>
      [row.device?.serial, row.device?.customer?.name, row.scent_name]
        .filter(Boolean)
        .some((value) => value.toLowerCase().includes(needle))
    );
  }, [entries.data, search]);

  const deviceOptions = useMemo(
    () => (devices.data ?? []).map((d) => ({
      value: d.id,
      label: `${d.serial} · ${d.customer?.name ?? 'ללא לקוח'} (${d.oil_level_pct}%)`,
    })),
    [devices.data]
  );

  const scentOptions = useMemo(
    () => (scents.data ?? []).map((s) => ({ value: s.name, label: s.name })),
    [scents.data]
  );

  const columns = [
    {
      key: 'device',
      label: 'מכשיר',
      width: 'minmax(0,1.4fr)',
      render: (row) => (
        <div className="min-w-0">
          <div className="truncate font-semibold">{row.device?.customer?.name ?? '—'}</div>
          <div className="truncate font-mono text-[11.5px] text-text-faint">
            {row.device?.serial} · {row.device?.model}
          </div>
        </div>
      ),
    },
    {
      key: 'event',
      label: 'סוג',
      width: '108px',
      render: (row) => (
        <StatusChip tone={EVENT_TONE[row.event_type]}>{OIL_EVENT_LABEL[row.event_type]}</StatusChip>
      ),
    },
    { key: 'scent', label: 'ניחוח', render: (row) => row.scent_name ?? '—' },
    {
      key: 'liters',
      label: 'ליטרים',
      width: '86px',
      render: (row) => (
        <span className="tabular font-mono text-[13px]">{formatNumber(row.liters_added, 3)}</span>
      ),
    },
    {
      key: 'levels',
      label: 'מפלס',
      width: '112px',
      render: (row) => (
        <span dir="ltr" className="tabular font-mono text-[12.5px] text-text-dim">
          {row.level_before_pct ?? '—'}% → {row.level_after_pct}%
        </span>
      ),
    },
    { key: 'by', label: 'נרשם ע"י', width: '110px', render: (row) => row.recorder?.full_name ?? 'המערכת' },
    {
      key: 'at',
      label: 'מועד',
      width: '124px',
      render: (row) => <span className="tabular text-[12px] text-text-faint">{formatDateTime(row.recorded_at)}</span>,
    },
  ];

  return (
    <>
      <ScreenToolbar
        search={search}
        onSearch={setSearch}
        searchPlaceholder="חיפוש לפי מכשיר, לקוח או ניחוח…"
        count={filtered.length}
        countLabel="רישומים"
        actionLabel="רישום מילוי"
        onAction={() => setFormOpen(true)}
      />

      <section className="grid grid-cols-1 items-start gap-3.5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <GlassCard>
          <CardHead title="יומן מעקב שמנים" subtitle="80 הרישומים האחרונים" />
          <Async
            loading={entries.loading}
            error={entries.error}
            onRetry={entries.refetch}
            isEmpty={filtered.length === 0}
            empty={
              <EmptyState
                title={search ? 'אין רישום שתואם את החיפוש' : 'עוד לא נרשמו מילויים'}
                hint='כל רישום כאן מעדכן אוטומטית את מפלס השמן של המכשיר.'
              />
            }
          >
            <DataTable columns={columns} rows={filtered} rowKey={(row) => row.id} />
          </Async>
        </GlassCard>

        <GlassCard>
          <CardHead title="תצרוכת שמן לפי ניחוח" subtitle="החודש הנוכחי, מתוך יומן המילויים" />
          <Async loading={scentUsage.loading} error={scentUsage.error} onRetry={scentUsage.refetch}>
            <div className="flex flex-col gap-[15px]">
              {mapOilByScent(scentUsage.data ?? []).map((item) => (
                <div key={item.scent}>
                  <div className="flex items-baseline gap-2 text-[13.5px]">
                    <b className="font-semibold">{item.scent}</b>
                    <span className="tabular ms-auto font-mono text-xs text-text-dim">{item.level}%</span>
                  </div>
                  <div className="meter">
                    <span style={{ width: `${item.level}%`, background: STOCK_FILL[item.tone] }} />
                  </div>
                  <div className="mt-1.5 text-[11.5px] text-text-faint">
                    {formatNumber(item.liters, 2)} ליטר החודש
                  </div>
                </div>
              ))}
            </div>
          </Async>
        </GlassCard>
      </section>

      <NewOilEntryModal
        open={formOpen}
        deviceOptions={deviceOptions}
        scentOptions={scentOptions}
        devices={devices.data ?? []}
        onClose={() => setFormOpen(false)}
        onCreated={() => {
          setFormOpen(false);
          entries.refetch();
          devices.refetch();
          scentUsage.refetch();
        }}
      />
    </>
  );
}

function NewOilEntryModal({ open, deviceOptions, scentOptions, devices, onClose, onCreated }) {
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [noStockNotice, setNoStockNotice] = useState(false);

  useEffect(() => {
    if (open) {
      setError(null);
      setNoStockNotice(false);
    }
  }, [open]);

  const set = (key) => (event) => setForm((prev) => ({ ...prev, [key]: event.target.value }));

  /** בחירת מכשיר ממלאת מראש את המפלס הנוכחי — הטכנאי לא צריך לזכור אותו */
  function pickDevice(event) {
    const id = event.target.value;
    const device = devices.find((d) => d.id === id);
    setForm((prev) => ({
      ...prev,
      device_id: id,
      level_before_pct: device ? String(device.oil_level_pct) : '',
    }));
  }

  async function submit(event) {
    event.preventDefault();
    setError(null);
    setBusy(true);

    const payload = {
      device_id: form.device_id,
      scent_name: form.scent_name || null,
      event_type: form.event_type,
      liters_added: Number(form.liters_added || 0),
      level_before_pct: form.level_before_pct === '' ? null : Number(form.level_before_pct),
      level_after_pct: Number(form.level_after_pct),
      notes: form.notes || null,
    };

    try {
      let usedFallback = false;
      try {
        await completeVisit(payload);
      } catch (stockError) {
        // אין מלאי נייד תואם (דגם/ניחוח) לנכות ממנו — קורה הרבה כרגע כי
        // המלאי הנייד עוד לא באמת מאוכלס. עדיף לרשום את הביקור בלי ניכוי
        // מאשר לחסום את הטכנאי לגמרי; ר' createOilEntry ב-queries.js —
        // אותה טבלה, בלי הצד האטומי של המלאי. כל שגיאה אחרת (למשל מכשיר
        // לא נמצא) ממשיכה לזרוק כרגיל, לא נבלעת כאן.
        if (!String(stockError?.message ?? '').includes('אין מלאי נייד')) throw stockError;
        await createOilEntry(payload);
        usedFallback = true;
      }
      setForm(emptyForm());
      if (usedFallback) {
        setNoStockNotice(true); // המודל נשאר פתוח כדי שהטכנאי יראה את ההודעה; onCreated() רק כשהוא סוגר בעצמו
      } else {
        onCreated();
      }
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  const after = Number(form.level_after_pct || 0);

  return (
    <Modal
      open={open}
      title="סיום ביקור"
      subtitle="הרישום מעדכן את מפלס השמן במכשיר, ומנכה מהמלאי הנייד שלך אם יש לו מה לנכות"
      onClose={onClose}
    >
      <form onSubmit={submit} className="flex flex-col gap-3.5">
        <Field label="מכשיר" required>
          <Select value={form.device_id} onChange={pickDevice} options={deviceOptions}
                  placeholder="בחר מכשיר" required />
        </Field>

        <div className="grid grid-cols-1 gap-3.5 xs:grid-cols-2">
          <Field label="סוג רישום">
            <Select
              value={form.event_type}
              onChange={set('event_type')}
              options={Object.entries(OIL_EVENT_LABEL).map(([value, label]) => ({ value, label }))}
            />
          </Field>
          <Field label="ניחוח" hint="אם תואם למלאי הנייד שלך — ינוכה ממנו אוטומטית; אם לא, הביקור עדיין יירשם">
            <Select value={form.scent_name} onChange={set('scent_name')} options={scentOptions}
                    placeholder="ללא ניחוח ספציפי" />
          </Field>
          <Field label="ליטרים שהוזרמו">
            <TextInput type="number" step="0.001" min="0" value={form.liters_added} onChange={set('liters_added')} />
          </Field>
          <Field label="מפלס לפני (%)">
            <TextInput type="number" min={0} max={100} value={form.level_before_pct} onChange={set('level_before_pct')} />
          </Field>
        </div>

        <Field label="מפלס אחרי (%)" required>
          <TextInput type="number" min={0} max={100} value={form.level_after_pct}
                     onChange={set('level_after_pct')} required />
        </Field>

        <div className="rounded-row border border-white/[0.075] bg-white/[0.022] px-3.5 py-3">
          <div className="mb-1.5 text-[11.5px] text-text-faint">המפלס שיישמר במכשיר</div>
          <MiniMeter value={Math.min(Math.max(after, 0), 100)} tone={oilTone(after)} />
        </div>

        <Field label="הערות">
          <TextArea value={form.notes} onChange={set('notes')} rows={2} />
        </Field>

        {error && (
          <div className="rounded-row border border-crit/25 bg-crit/[0.07] px-3.5 py-2.5 text-[12.5px] text-crit-soft">
            {error}
          </div>
        )}

        {noStockNotice && (
          <div className="rounded-row border border-warn/25 bg-warn/[0.07] px-3.5 py-2.5 text-[12.5px] text-warn">
            הביקור נרשם בהצלחה — אבל לא ניכינו כלום מהמלאי הנייד שלך, כי לא היה לך מלאי רשום שתואם לדגם/ניחוח הזה.
            תעדכן את "מלאי נייד" כשתוכל, כדי שהניכוי האוטומטי יעבוד בפעם הבאה.
          </div>
        )}

        <div className="mt-1 flex gap-2.5">
          {noStockNotice ? (
            <PrimaryButton type="button" onClick={onCreated}>הבנתי, סגירה</PrimaryButton>
          ) : (
            <>
              <PrimaryButton type="submit" loading={busy}>סיום ביקור / בוצע</PrimaryButton>
              <SecondaryButton onClick={onClose}>ביטול</SecondaryButton>
            </>
          )}
        </div>
      </form>
    </Modal>
  );
}
