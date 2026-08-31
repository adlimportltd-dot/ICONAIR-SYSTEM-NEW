import { useMemo, useState } from 'react';
import Modal from './ui/Modal';
import DeviceFormModal from './DeviceFormModal';
import { StatusChip, MiniMeter, oilTone } from './ui/DataTable';
import { Async, EmptyState } from './ui/States';
import { PrimaryButton } from './ui/Field';
import { useQuery } from '../hooks/useQuery';
import { useRealtime } from '../hooks/useRealtime';
import { listCustomerDevices, listScents, listDeviceModels } from '../lib/queries';
import { DEVICE_STATUS_LABEL, modelTone, relativeTime } from '../lib/mappers';

const STATUS_TONE = { active: 'ok', offline: 'crit', maintenance: 'warn', uninstalled: 'slate' };

/**
 * כרטיס לקוח: כל המכשירים שמותקנים אצלו, כל אחד עם הדגם, הניחוח
 * והמיקום שלו במתחם. מכאן גם רושמים מכשיר נוסף בלי לעבור מסך
 * ובלי לבחור את הלקוח מחדש.
 *
 * customer === null סוגר את החלון.
 */
export default function CustomerDevicesModal({ customer, onClose, onDevicesChanged }) {
  const [formOpen, setFormOpen] = useState(false);

  const customerId = customer?.id ?? null;

  const devices = useQuery(
    () => listCustomerDevices(customerId),
    [customerId],
    { enabled: Boolean(customerId) }
  );
  const scents = useQuery(listScents, []);
  const scentOptions = useMemo(
    () => (scents.data ?? []).map((s) => ({ value: s.name, label: s.name })),
    [scents.data]
  );

  const models = useQuery(listDeviceModels, []);
  const modelOptions = useMemo(
    () => (models.data ?? []).map((m) => ({ value: m.name, label: m.name })),
    [models.data]
  );

  // טכנאי שמתקין מכשיר בשטח מופיע כאן בלי שצריך לרענן.
  // רק כשהכרטיס פתוח — אחרת הערוץ היה פתוח כל עוד מסך הלקוחות מוצג.
  useRealtime(['devices'], devices.refetch, { enabled: Boolean(customerId) });

  const rows = devices.data ?? [];

  function handleCreated() {
    devices.refetch();
    onDevicesChanged?.();
  }

  return (
    <>
      <Modal
        open={Boolean(customer)}
        title={customer?.name ?? ''}
        subtitle={[customer?.city, customer?.route_name].filter(Boolean).join(' · ') || undefined}
        onClose={onClose}
      >
        <div className="mb-3.5 flex items-center gap-3">
          <div className="text-[12.5px] text-text-dim">
            {devices.loading ? 'טוען מכשירים…' : `${rows.length} מכשירים רשומים`}
          </div>
          <PrimaryButton className="ms-auto" onClick={() => setFormOpen(true)}>
            הוסף מכשיר
          </PrimaryButton>
        </div>

        <Async
          loading={devices.loading}
          error={devices.error}
          onRetry={devices.refetch}
          isEmpty={rows.length === 0}
          empty={
            <EmptyState
              title="ללקוח הזה עוד אין מכשירים"
              hint="לחץ על ״הוסף מכשיר״ כדי לרשום את הראשון. אפשר לרשום כמה שצריך באותה פתיחה."
            />
          }
        >
          <div className="flex flex-col gap-[9px]">
            {rows.map((device) => (
              <div key={device.id} className="inner-row px-3.5 py-3">
                <div className="flex items-center gap-2.5">
                  <span dir="ltr" className="font-mono text-[12.5px] text-gold-300">{device.serial}</span>
                  <StatusChip tone={modelTone(device.model)}>{device.model}</StatusChip>
                  <StatusChip tone={STATUS_TONE[device.status]}>
                    {DEVICE_STATUS_LABEL[device.status]}
                  </StatusChip>
                </div>

                <div className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[12.5px]">
                  <span className="text-text-faint">
                    מיקום: <span className="text-text">{device.location_note || 'לא צוין'}</span>
                  </span>
                  <span className="text-text-faint">
                    ניחוח: <span className="text-text">{device.scent_name || 'לא משויך'}</span>
                  </span>
                  <span className="tabular text-text-faint">
                    נראה {relativeTime(device.last_seen_at)}
                  </span>
                </div>

                <div className="mt-2.5 max-w-[220px]">
                  <MiniMeter value={device.oil_level_pct} tone={oilTone(device.oil_level_pct)} />
                </div>
              </div>
            ))}
          </div>
        </Async>
      </Modal>

      <DeviceFormModal
        open={formOpen}
        lockedCustomer={customer}
        scentOptions={scentOptions}
        modelOptions={modelOptions}
        onClose={() => setFormOpen(false)}
        onCreated={handleCreated}
      />
    </>
  );
}
