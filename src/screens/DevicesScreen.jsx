import { useMemo, useState } from 'react';
import GlassCard from '../components/ui/GlassCard';
import DataTable, { StatusChip, MiniMeter, oilTone } from '../components/ui/DataTable';
import ScreenToolbar from '../components/ui/ScreenToolbar';
import DeviceFormModal from '../components/DeviceFormModal';
import { Async, EmptyState } from '../components/ui/States';
import { useQuery } from '../hooks/useQuery';
import { useRealtime } from '../hooks/useRealtime';
import { listDevices, listCustomerOptions, listScents, listDeviceModels } from '../lib/queries';
import { DEVICE_STATUS_LABEL, modelTone, relativeTime } from '../lib/mappers';

const STATUS_TONE = { active: 'ok', offline: 'crit', maintenance: 'warn', uninstalled: 'slate' };

export default function DevicesScreen() {
  const [search, setSearch] = useState('');
  const [model, setModel] = useState('');
  const [status, setStatus] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [formOpen, setFormOpen] = useState(false);

  const devices = useQuery(
    () => listDevices({ search, model, status, customerId }),
    [search, model, status, customerId]
  );
  const customers = useQuery(listCustomerOptions, []);
  const scents = useQuery(listScents, []);
  const models = useQuery(listDeviceModels, []);

  // מכשיר שיוצא מהרשת או שמתמלא לו השמן — מתעדכן כאן בלי רענון
  useRealtime(['devices'], devices.refetch);

  const customerOptions = useMemo(
    () => (customers.data ?? []).map((c) => ({ value: c.id, label: c.city ? `${c.name} · ${c.city}` : c.name })),
    [customers.data]
  );

  const scentOptions = useMemo(
    () => (scents.data ?? []).map((s) => ({ value: s.name, label: s.name })),
    [scents.data]
  );

  const modelOptions = useMemo(
    () => (models.data ?? []).map((m) => ({ value: m.name, label: m.name })),
    [models.data]
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
      render: (row) => <StatusChip tone={modelTone(row.model)}>{row.model}</StatusChip>,
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
            options: modelOptions,
          },
          {
            key: 'status',
            value: status,
            onChange: setStatus,
            placeholder: 'כל הסטטוסים',
            options: Object.entries(DEVICE_STATUS_LABEL).map(([value, label]) => ({ value, label })),
          },
          {
            key: 'customer',
            value: customerId,
            onChange: setCustomerId,
            placeholder: 'כל הלקוחות',
            options: customerOptions,
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

      <DeviceFormModal
        open={formOpen}
        customerOptions={customerOptions}
        scentOptions={scentOptions}
        modelOptions={modelOptions}
        onClose={() => setFormOpen(false)}
        onCreated={devices.refetch}
      />
    </>
  );
}
