import { useMemo, useState } from 'react';
import GlassCard from '../components/ui/GlassCard';
import DataTable, { StatusChip, MiniMeter, oilTone } from '../components/ui/DataTable';
import ScreenToolbar from '../components/ui/ScreenToolbar';
import Modal from '../components/ui/Modal';
import { Field, TextInput, Select, PrimaryButton, SecondaryButton } from '../components/ui/Field';
import { Async, EmptyState } from '../components/ui/States';
import { useQuery } from '../hooks/useQuery';
import { useRealtime } from '../hooks/useRealtime';
import { listDevices, createDevice, listCustomerOptions } from '../lib/queries';
import { describeError } from '../lib/supabase';
import { DEVICE_STATUS_LABEL, MODEL_TONE, relativeTime } from '../lib/mappers';

const MODELS = ['Icon 300', 'Icon 500', 'Icon 700'];
const STATUS_TONE = { active: 'ok', offline: 'crit', maintenance: 'warn', uninstalled: 'slate' };

const EMPTY_FORM = {
  model: 'Icon 500', customer_id: '', scent_name: '',
  oil_level_pct: 100, location_note: '', status: 'active',
};

export default function DevicesScreen() {
  const [search, setSearch] = useState('');
  const [model, setModel] = useState('');
  const [status, setStatus] = useState('');
  const [formOpen, setFormOpen] = useState(false);

  const devices = useQuery(() => listDevices({ search, model, status }), [search, model, status]);
  const customers = useQuery(listCustomerOptions, []);

  // מכשיר שיוצא מהרשת או שמתמלא לו השמן — מתעדכן כאן בלי רענון
  useRealtime(['devices'], devices.refetch);

  const customerOptions = useMemo(
    () => (customers.data ?? []).map((c) => ({ value: c.id, label: c.city ? `${c.name} · ${c.city}` : c.name })),
    [customers.data]
  );

  const columns = [
    {
      key: 'serial',
      label: 'מס\' סידורי',
      width: '150px',
      render: (row) => <span className="font-mono text-[12.5px] text-gold-300">{row.serial}</span>,
    },
    {
      key: 'model',
      label: 'דגם',
      width: '104px',
      render: (row) => <StatusChip tone={MODEL_TONE[row.model]}>{row.model}</StatusChip>,
    },
    {
      key: 'customer',
      label: 'לקוח',
      width: 'minmax(0,1.5fr)',
      render: (row) => (
        <div className="min-w-0">
          <div className="truncate font-semibold">{row.customer?.name ?? '—'}</div>
          <div className="truncate text-[11.5px] text-text-faint">{row.location_note || row.customer?.city}</div>
        </div>
      ),
    },
    { key: 'scent', label: 'ניחוח', render: (row) => row.scent_name ?? 'לא משויך' },
    {
      key: 'oil',
      label: 'מפלס שמן',
      width: '150px',
      render: (row) => <MiniMeter value={row.oil_level_pct} tone={oilTone(row.oil_level_pct)} />,
    },
    {
      key: 'status',
      label: 'סטטוס',
      width: '104px',
      render: (row) => <StatusChip tone={STATUS_TONE[row.status]}>{DEVICE_STATUS_LABEL[row.status]}</StatusChip>,
    },
    {
      key: 'seen',
      label: 'נראה לאחרונה',
      width: '110px',
      render: (row) => <span className="tabular text-[12px] text-text-faint">{relativeTime(row.last_seen_at)}</span>,
    },
  ];

  return (
    <>
      <ScreenToolbar
        search={search}
        onSearch={setSearch}
        searchPlaceholder="חיפוש לפי מספר סידורי…"
        count={devices.data?.length}
        countLabel="מכשירים"
        actionLabel="מכשיר חדש"
        onAction={() => setFormOpen(true)}
        filters={[
          {
            key: 'model',
            value: model,
            onChange: setModel,
            placeholder: 'כל הדגמים',
            options: MODELS.map((m) => ({ value: m, label: m })),
          },
          {
            key: 'status',
            value: status,
            onChange: setStatus,
            placeholder: 'כל הסטטוסים',
            options: Object.entries(DEVICE_STATUS_LABEL).map(([value, label]) => ({ value, label })),
          },
        ]}
      />

      <GlassCard>
        <Async
          loading={devices.loading}
          error={devices.error}
          onRetry={devices.refetch}
          isEmpty={devices.data?.length === 0}
          empty={
            <EmptyState
              title="אין מכשיר שתואם את הסינון"
              hint="נקה את המסננים, או הוסף מכשיר חדש ושייך אותו ללקוח."
            />
          }
        >
          <DataTable columns={columns} rows={devices.data ?? []} rowKey={(row) => row.id} />
        </Async>
      </GlassCard>

      <NewDeviceModal
        open={formOpen}
        customerOptions={customerOptions}
        onClose={() => setFormOpen(false)}
        onCreated={() => {
          setFormOpen(false);
          devices.refetch();
        }}
      />
    </>
  );
}

function NewDeviceModal({ open, customerOptions, onClose, onCreated }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const set = (key) => (event) => setForm((prev) => ({ ...prev, [key]: event.target.value }));

  async function submit(event) {
    event.preventDefault();
    setError(null);
    setBusy(true);

    try {
      await createDevice({
        model: form.model,
        customer_id: form.customer_id,
        scent_name: form.scent_name || null,
        status: form.status,
        oil_level_pct: Number(form.oil_level_pct),
        location_note: form.location_note || null,
      });
      setForm(EMPTY_FORM);
      onCreated();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      title="מכשיר חדש"
      subtitle="המספר הסידורי נוצר אוטומטית לפי הדגם"
      onClose={onClose}
    >
      <form onSubmit={submit} className="flex flex-col gap-3.5">
        <Field label="לקוח" required>
          <Select value={form.customer_id} onChange={set('customer_id')} options={customerOptions}
                  placeholder="בחר לקוח" required />
        </Field>

        <div className="grid grid-cols-1 gap-3.5 xs:grid-cols-2">
          <Field label="דגם" required>
            <Select value={form.model} onChange={set('model')} options={MODELS.map((m) => ({ value: m, label: m }))} />
          </Field>
          <Field label="ניחוח">
            <TextInput value={form.scent_name} onChange={set('scent_name')} placeholder="Signature Gold" />
          </Field>
          <Field label="מיקום במתחם" hint="לובי ראשי, חדר כושר…">
            <TextInput value={form.location_note} onChange={set('location_note')} />
          </Field>
          <Field label="מפלס שמן התחלתי (%)">
            <TextInput type="number" min={0} max={100} value={form.oil_level_pct} onChange={set('oil_level_pct')} />
          </Field>
        </div>

        <Field label="סטטוס">
          <Select
            value={form.status}
            onChange={set('status')}
            options={Object.entries(DEVICE_STATUS_LABEL)
              .filter(([value]) => value !== 'uninstalled')
              .map(([value, label]) => ({ value, label }))}
          />
        </Field>

        {error && (
          <div className="rounded-row border border-crit/25 bg-crit/[0.07] px-3.5 py-2.5 text-[12.5px] text-crit-soft">
            {error}
          </div>
        )}

        <div className="mt-1 flex gap-2.5">
          <PrimaryButton type="submit" loading={busy}>שמור מכשיר</PrimaryButton>
          <SecondaryButton onClick={onClose}>ביטול</SecondaryButton>
        </div>
      </form>
    </Modal>
  );
}
