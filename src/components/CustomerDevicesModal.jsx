import { useMemo, useRef, useState } from 'react';
import Modal from './ui/Modal';
import DeviceFormModal from './DeviceFormModal';
import { StatusChip, MiniMeter, oilTone } from './ui/DataTable';
import { Async, EmptyState } from './ui/States';
import { PrimaryButton, SecondaryButton } from './ui/Field';
import { useAuth } from '../context/AuthContext';
import { useQuery } from '../hooks/useQuery';
import { useRealtime } from '../hooks/useRealtime';
import {
  listCustomerDevices,
  listScents,
  listDeviceModels,
  listContracts,
  uploadContract,
  getContractUrl,
  deleteContract,
} from '../lib/queries';
import { describeError } from '../lib/supabase';
import { DEVICE_STATUS_LABEL, modelTone, relativeTime, formatDate } from '../lib/mappers';

const STATUS_TONE = { active: 'ok', offline: 'crit', maintenance: 'warn', uninstalled: 'slate' };

/**
 * כרטיס לקוח: כל המכשירים שמותקנים אצלו, כל אחד עם הדגם, הניחוח
 * והמיקום שלו במתחם. מכאן גם רושמים מכשיר נוסף בלי לעבור מסך
 * ובלי לבחור את הלקוח מחדש.
 *
 * למנהלים בלבד מופיע כאן גם מקטע חוזים (ר׳ ContractsSection למטה).
 *
 * customer === null סוגר את החלון.
 */
export default function CustomerDevicesModal({ customer, onClose, onDevicesChanged }) {
  const { isAdmin } = useAuth();
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

        {isAdmin && <ContractsSection customerId={customerId} />}
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

/**
 * חוזים של הלקוח — גלוי למנהלים בלבד. ה-RLS על הטבלה וה-Storage כבר
 * חוסמים טכנאי מהנתונים עצמם, וכאן חוסמים גם את התצוגה — כדי שהוא
 * לא יראה בכלל שהמקטע קיים, באותו עיקרון של הנתונים הכספיים.
 *
 * שלב א׳ בלבד: העלאת חוזה קיים שכבר חתום (סריקה / תמונה / PDF).
 * שליחה לחתימה דיגיטלית זה מקטע נפרד שיתווסף בשלב הבא.
 */
function ContractsSection({ customerId }) {
  const fileInputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  const contracts = useQuery(
    () => listContracts(customerId),
    [customerId],
    { enabled: Boolean(customerId) }
  );
  const rows = contracts.data ?? [];

  async function handleFileChange(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setError(null);
    setBusy(true);
    try {
      await uploadContract(customerId, file, file.name.replace(/\.[^.]+$/, ''));
      contracts.refetch();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  async function handleView(contract) {
    setError(null);
    try {
      const url = await getContractUrl(contract.file_path);
      window.open(url, '_blank', 'noopener');
    } catch (caught) {
      setError(describeError(caught));
    }
  }

  async function handleDelete(contract) {
    if (confirmDeleteId !== contract.id) {
      setConfirmDeleteId(contract.id);
      return;
    }
    setConfirmDeleteId(null);
    setError(null);
    try {
      await deleteContract(contract);
      contracts.refetch();
    } catch (caught) {
      setError(describeError(caught));
    }
  }

  return (
    <div className="mt-5 border-t border-white/[0.07] pt-4">
      <div className="mb-3 flex items-center gap-3">
        <h3 className="text-[14px] font-semibold">חוזים</h3>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf,image/*"
          className="hidden"
          onChange={handleFileChange}
        />
        <PrimaryButton className="ms-auto" loading={busy} onClick={() => fileInputRef.current?.click()}>
          העלאת חוזה
        </PrimaryButton>
      </div>

      {error && (
        <div className="mb-3 rounded-row border border-crit/25 bg-crit/[0.07] px-3.5 py-2.5 text-[12.5px] text-crit-soft">
          {error}
        </div>
      )}

      <Async
        loading={contracts.loading}
        error={contracts.error}
        onRetry={contracts.refetch}
        isEmpty={rows.length === 0}
        empty={
          <EmptyState
            title="עדיין לא הועלה חוזה ללקוח הזה"
            hint="לחץ על ״העלאת חוזה״ כדי להעלות סריקה, תמונה או PDF של החוזה החתום."
          />
        }
      >
        <div className="flex flex-col gap-[9px]">
          {rows.map((contract) => (
            <div key={contract.id} className="inner-row flex items-center gap-3 px-3.5 py-3">
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13.5px] font-medium">{contract.title}</div>
                <div className="mt-0.5 text-[11.5px] text-text-faint">
                  הועלה {formatDate(contract.created_at)}
                </div>
              </div>
              <SecondaryButton onClick={() => handleView(contract)}>צפייה</SecondaryButton>
              <SecondaryButton
                className={confirmDeleteId === contract.id ? 'border-crit/40 text-crit-soft' : ''}
                onClick={() => handleDelete(contract)}
              >
                {confirmDeleteId === contract.id ? 'לאשר מחיקה' : 'מחיקה'}
              </SecondaryButton>
            </div>
          ))}
        </div>
      </Async>
    </div>
  );
}