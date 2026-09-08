import { useEffect, useMemo, useRef, useState } from 'react';
import Modal from './ui/Modal';
import DeviceFormModal from './DeviceFormModal';
import GenerateContractModal from './GenerateContractModal';
import { StatusChip, MiniMeter, oilTone } from './ui/DataTable';
import { Async, EmptyState } from './ui/States';
import { PrimaryButton, SecondaryButton } from './ui/Field';
import { TrashIcon } from './ui/Icons';
import { useAuth } from '../context/AuthContext';
import { useQuery } from '../hooks/useQuery';
import { useRealtime } from '../hooks/useRealtime';
import {
  listCustomerDevices,
  listCustomerSites,
  upsertSiteModelPrice,
  listScents,
  listDeviceModels,
  listContracts,
  uploadContract,
  getContractUrl,
  deleteContract,
  deleteDevice,
} from '../lib/queries';
import { describeError } from '../lib/supabase';
import {
  DEVICE_STATUS_LABEL, modelTone, relativeTime, formatDate, formatDateTime,
  summarizeDevicesByModel, computeVat, formatCurrency,
} from '../lib/mappers';
import { whatsappLink } from '../lib/navLinks';

const STATUS_TONE = { active: 'ok', offline: 'crit', maintenance: 'warn', uninstalled: 'slate' };

const CONTRACT_STATUS_LABEL = {
  uploaded: 'הועלה ידנית',
  draft: 'טיוטה',
  sent: 'ממתין לחתימה',
  viewed: 'נצפה ע״י הלקוח',
  signed: 'נחתם',
  declined: 'נדחה',
};

const CONTRACT_STATUS_TONE = {
  uploaded: 'slate', draft: 'slate', sent: 'gold', viewed: 'teal', signed: 'ok', declined: 'crit',
};

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
  const [deviceFormSite, setDeviceFormSite] = useState(null);
  const [confirmDeleteDeviceId, setConfirmDeleteDeviceId] = useState(null);
  const [deleteError, setDeleteError] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  const customerId = customer?.id ?? null;

  // איפוס מצב "אישור מחיקה" כשעוברים ללקוח אחר — בלי זה, אישור שנשאר
  // "דלוק" מכרטיס קודם עלול למחוק בטעות מכשיר של הלקוח החדש בלחיצה אחת.
  useEffect(() => {
    setConfirmDeleteDeviceId(null);
    setDeleteError(null);
  }, [customerId]);

  const devices = useQuery(
    () => listCustomerDevices(customerId),
    [customerId],
    { enabled: Boolean(customerId) }
  );

  // רק ללקוח רב-כתובתי (כמו אוורסט) יש שורות ב-customer_sites בכלל —
  // לרוב הלקוחות (חד-כתובתיים) זו תמיד רשימה ריקה, וה-UI נשאר ברשימה
  // השטוחה הרגילה בלי שינוי.
  const sites = useQuery(
    () => listCustomerSites(customerId),
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
  const siteRows = sites.data ?? [];
  const hasSites = siteRows.length > 0;
  const siteOptions = useMemo(
    () => siteRows.map((s) => ({ value: s.id, label: [s.label, s.city].filter(Boolean).join(' · ') })),
    [siteRows]
  );

  // מכשיר עם site_id מקובץ תחת הכתובת שלו; מכשיר בלי site_id (למשל
  // לפני שהכתובות יובאו, או נרשם ידנית בלי לבחור כתובת) נופל ל"ללא
  // כתובת משוייכת" כדי שאף מכשיר לא ייעלם מהתצוגה בשקט.
  const devicesBySite = useMemo(() => {
    const map = new Map();
    for (const device of rows) {
      const key = device.site_id ?? '__none__';
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(device);
    }
    return map;
  }, [rows]);

  function handleCreated() {
    devices.refetch();
    sites.refetch();
    onDevicesChanged?.();
  }

  function openAddDevice(site = null) {
    setDeviceFormSite(site);
    setFormOpen(true);
  }

  async function handleDeleteDevice(device) {
    if (confirmDeleteDeviceId !== device.id) {
      setConfirmDeleteDeviceId(device.id);
      return;
    }
    setConfirmDeleteDeviceId(null);
    setDeleteError(null);
    setDeletingId(device.id);
    try {
      await deleteDevice(device.id);
      devices.refetch();
      onDevicesChanged?.();
    } catch (caught) {
      setDeleteError(describeError(caught));
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <>
      <Modal
        open={Boolean(customer)}
        title={customer?.name ?? ''}
        subtitle={[customer?.city, customer?.route_name].filter(Boolean).join(' · ') || undefined}
        onClose={onClose}
      >
        <div className="mb-3.5 flex flex-wrap items-center gap-2.5">
          <div className="text-[12.5px] text-text-dim">
            {devices.loading ? 'טוען מכשירים…' : `${rows.length} מכשירים רשומים`}
          </div>
          {/* כפתור אחד, לא שניים מנותקים: פתיחת כתובת חדשה קורית בתוך
              טופס המכשיר עצמו (בורר "כתובת" → "+ הוספת כתובת חדשה"),
              כדי שהמכשיר הראשון שם ישויך אליה מייד באותה פעולה. */}
          <PrimaryButton className="ms-auto" onClick={() => openAddDevice(null)}>
            הוסף מכשיר
          </PrimaryButton>
        </div>

        {deleteError && (
          <div className="mb-3 rounded-row border border-crit/25 bg-crit/[0.07] px-3.5 py-2.5 text-[12.5px] text-crit-soft">
            {deleteError}
          </div>
        )}

        {hasSites ? (
          <SitesSection
            sites={siteRows}
            devicesBySite={devicesBySite}
            isAdmin={isAdmin}
            confirmDeleteDeviceId={confirmDeleteDeviceId}
            deletingId={deletingId}
            onDeleteDevice={handleDeleteDevice}
            onAddDevice={openAddDevice}
            onPriceSaved={sites.refetch}
          />
        ) : (
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
                <DeviceRow
                  key={device.id}
                  device={device}
                  isAdmin={isAdmin}
                  confirmDeleteDeviceId={confirmDeleteDeviceId}
                  deletingId={deletingId}
                  onDelete={handleDeleteDevice}
                />
              ))}
            </div>
          </Async>
        )}

        {isAdmin && <ContractsSection customer={customer} devices={rows} />}
      </Modal>

      <DeviceFormModal
        open={formOpen}
        lockedCustomer={customer}
        siteOptions={siteOptions}
        lockedSite={deviceFormSite}
        scentOptions={scentOptions}
        modelOptions={modelOptions}
        onClose={() => setFormOpen(false)}
        onCreated={handleCreated}
      />
    </>
  );
}

/** שורת מכשיר בודדת — משמשת גם ברשימה השטוחה (לקוח חד-כתובתי) וגם בתוך כל כרטיס כתובת */
function DeviceRow({ device, isAdmin, confirmDeleteDeviceId, deletingId, onDelete }) {
  return (
    <div className="inner-row px-3.5 py-3">
      <div className="flex items-start gap-2.5">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2.5">
          <span dir="ltr" className="font-mono text-[12.5px] text-gold-600">{device.serial}</span>
          <StatusChip tone={modelTone(device.model)}>{device.model}</StatusChip>
          <StatusChip tone={STATUS_TONE[device.status]}>
            {DEVICE_STATUS_LABEL[device.status]}
          </StatusChip>
        </div>

        {isAdmin && (
          <button
            type="button"
            onClick={() => onDelete(device)}
            disabled={deletingId === device.id}
            aria-label={confirmDeleteDeviceId === device.id ? `לאשר מחיקת מכשיר ${device.serial}` : `מחק מכשיר ${device.serial}`}
            title={confirmDeleteDeviceId === device.id ? 'לחץ שוב לאישור סופי' : 'הסרת מכשיר מהמערכת'}
            className={`flex flex-none items-center gap-1.5 rounded-[8px] border px-2 py-1
                        text-[11.5px] font-semibold transition-colors disabled:opacity-50 ${
              confirmDeleteDeviceId === device.id
                ? 'border-crit/50 bg-crit/10 text-crit-soft'
                : 'border-black/[0.09] text-text-faint hover:border-crit/35 hover:text-crit-soft'
            }`}
          >
            <TrashIcon className="h-[13px] w-[13px]" />
            {confirmDeleteDeviceId === device.id ? 'לאשר מחיקה' : 'מחיקה'}
          </button>
        )}
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
  );
}

/**
 * מחשב את פילוח הדגמים והסכום לכתובת: כמות מכל דגם (מכשירים מותקנים
 * בפועל, לא uninstalled) × מחיר-ליחידה שהוגדר לאותו דגם באותה כתובת
 * (customer_site_model_prices — ר' phase17). דגם בלי מחיר מוגדר נכנס
 * לסכימה עם 0 — מוצג בבירור בטבלה, לא נעלם. המחיר תמיד לפני מע״מ.
 */
function computeSiteBreakdown(devices, prices) {
  const priceByModel = new Map((prices ?? []).map((p) => [p.model, Number(p.unit_price)]));
  const countByModel = new Map();
  for (const d of devices) {
    if (d.status === 'uninstalled') continue;
    countByModel.set(d.model, (countByModel.get(d.model) ?? 0) + 1);
  }
  const lines = [...countByModel.entries()]
    .map(([model, count]) => {
      const unitPrice = priceByModel.get(model) ?? 0;
      return { model, count, unitPrice, lineTotal: count * unitPrice };
    })
    .sort((a, b) => a.model.localeCompare(b.model, 'he'));

  const preVatRaw = lines.reduce((sum, l) => sum + l.lineTotal, 0);
  return { lines, ...computeVat(preVatRaw, 'excluded') };
}

/**
 * פילוח לפי כתובת — ללקוח רב-כתובתי (כמו אוורסט) יש עשרות אתרים
 * (customer_sites), כל אחד עם המכשירים ומחירי-הדגמים שלו. במקום סכום
 * גלובלי אחד לכל הלקוח, כל כתובת היא כרטיסייה נפרדת עם פילוח דגמים,
 * מחיר ליחידה לכל דגם, וסיכום (לפני מע״מ / מע״מ / כולל) משלה.
 */
function SitesSection({
  sites, devicesBySite, isAdmin, confirmDeleteDeviceId, deletingId, onDeleteDevice, onAddDevice, onPriceSaved,
}) {
  const unassigned = devicesBySite.get('__none__') ?? [];
  const grandTotal = sites.reduce(
    (sum, s) => sum + computeSiteBreakdown(devicesBySite.get(s.id) ?? [], s.prices).total,
    0
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between rounded-row border border-gold-300/[0.2] bg-gold-500/[0.06] px-3.5 py-2.5">
        <span className="text-[12.5px] font-medium text-text-dim">{sites.length} כתובות · סה״כ לכל הכתובות (כולל מע״מ)</span>
        <span className="tabular font-mono text-[15px] font-bold text-gold-600">{formatCurrency(grandTotal)}</span>
      </div>

      {sites.map((site) => (
        <SiteCard
          key={site.id}
          site={site}
          devices={devicesBySite.get(site.id) ?? []}
          isAdmin={isAdmin}
          confirmDeleteDeviceId={confirmDeleteDeviceId}
          deletingId={deletingId}
          onDeleteDevice={onDeleteDevice}
          onAddDevice={onAddDevice}
          onPriceSaved={onPriceSaved}
        />
      ))}

      {unassigned.length > 0 && (
        <div className="rounded-row border border-black/[0.07] bg-black/[0.02] p-3.5">
          <div className="mb-2.5 text-[13px] font-semibold text-text-dim">ללא כתובת משוייכת</div>
          <div className="flex flex-col gap-[9px]">
            {unassigned.map((device) => (
              <DeviceRow
                key={device.id}
                device={device}
                isAdmin={isAdmin}
                confirmDeleteDeviceId={confirmDeleteDeviceId}
                deletingId={deletingId}
                onDelete={onDeleteDevice}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** כרטיסיית כתובת בודדת: כותרת + טבלת מחיר-לדגם + סיכום מע״מ + רשימת מכשירים */
function SiteCard({ site, devices, isAdmin, confirmDeleteDeviceId, deletingId, onDeleteDevice, onAddDevice, onPriceSaved }) {
  const [open, setOpen] = useState(false);
  const breakdown = computeSiteBreakdown(devices, site.prices);

  return (
    <div className="rounded-row border border-black/[0.07] bg-black/[0.02] p-3.5">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-3 text-start">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-semibold">{site.label}</div>
          <div className="mt-0.5 truncate text-[12px] text-text-faint">
            {site.city ? `${site.city} · ` : ''}{summarizeDevicesByModel(devices)}
          </div>
        </div>
        <div className="flex-none text-end">
          <div className="tabular font-mono text-[14px] font-semibold text-gold-600">{formatCurrency(breakdown.total)}</div>
          <div className="text-[10.5px] text-text-faint">{devices.length} מכשירים</div>
        </div>
      </button>

      {open && (
        <div className="mt-3 border-t border-black/[0.06] pt-3">
          <div className="mb-3 flex items-center justify-between">
            <h4 className="text-[12.5px] font-semibold text-text-dim">תמחור לפי דגם</h4>
            {isAdmin && (
              <SecondaryButton onClick={() => onAddDevice(site)}>הוסף מכשיר לכתובת זו</SecondaryButton>
            )}
          </div>

          {breakdown.lines.length === 0 ? (
            <div className="text-[12.5px] text-text-faint">אין מכשירים בכתובת הזו</div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {breakdown.lines.map((line) => (
                <ModelPriceRow key={line.model} site={site} line={line} isAdmin={isAdmin} onSaved={onPriceSaved} />
              ))}

              <div className="mt-2 flex flex-wrap items-center justify-end gap-x-4 gap-y-1 rounded-row bg-black/[0.03] px-3 py-2.5 text-[12px]">
                <span className="text-text-faint">לפני מע״מ <b className="tabular font-mono text-text">{formatCurrency(breakdown.preVat)}</b></span>
                <span className="text-text-faint">מע״מ (18%) <b className="tabular font-mono text-text">{formatCurrency(breakdown.vatAmount)}</b></span>
                <span className="text-text-faint">סה״כ כולל מע״מ <b className="tabular font-mono text-[13px] text-gold-600">{formatCurrency(breakdown.total)}</b></span>
              </div>
            </div>
          )}

          {devices.length > 0 && (
            <div className="mt-3.5 flex flex-col gap-[9px]">
              {devices.map((device) => (
                <DeviceRow
                  key={device.id}
                  device={device}
                  isAdmin={isAdmin}
                  confirmDeleteDeviceId={confirmDeleteDeviceId}
                  deletingId={deletingId}
                  onDelete={onDeleteDevice}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** שורת "דגם · כמות · מחיר ליחידה · סה״כ" בטבלת התמחור של כתובת אחת */
function ModelPriceRow({ site, line, isAdmin, onSaved }) {
  const [price, setPrice] = useState(String(line.unitPrice));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function save() {
    setError(null);
    setSaving(true);
    try {
      await upsertSiteModelPrice(site.id, line.model, Number(price || 0));
      onSaved?.();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2.5 rounded-row border border-black/[0.06] bg-ink-900 px-3 py-2">
      <StatusChip tone={modelTone(line.model)}>{line.model}</StatusChip>
      <span className="tabular text-[12px] text-text-faint">× {line.count}</span>

      {isAdmin ? (
        <div className="ms-auto flex items-center gap-1.5">
          <input
            type="number"
            min={0}
            step="0.01"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            className="w-[90px] rounded-pill border border-black/[0.09] bg-ink-800 px-2.5 py-1 text-[12.5px] text-text
                       focus:border-gold-500/45 focus:outline-none"
          />
          <span className="text-[11px] text-text-faint">₪ / יח׳</span>
          <button
            type="button"
            onClick={save}
            disabled={saving || Number(price || 0) === line.unitPrice}
            className="rounded-pill border border-gold-300/[0.3] bg-gold-500/[0.1] px-2.5 py-1 text-[11.5px]
                       font-semibold text-gold-600 transition-colors disabled:opacity-40
                       hover:border-gold-300/50"
          >
            {saving ? 'שומר…' : 'שמירה'}
          </button>
        </div>
      ) : (
        <span className="tabular ms-auto text-[12px] text-text-faint">{formatCurrency(line.unitPrice)} / יח׳</span>
      )}

      <span className="tabular w-[80px] flex-none text-end font-mono text-[13px] font-semibold">
        {formatCurrency(line.lineTotal)}
      </span>

      {error && <div className="w-full text-[11px] text-crit-soft">{error}</div>}
    </div>
  );
}

/**
 * חוזים של הלקוח — גלוי למנהלים בלבד. ה-RLS על הטבלה וה-Storage כבר
 * חוסמים טכנאי מהנתונים עצמם, וכאן חוסמים גם את התצוגה — כדי שהוא
 * לא יראה בכלל שהמקטע קיים, באותו עיקרון של הנתונים הכספיים.
 *
 * שני מסלולים: "העלאת חוזה" — חוזה שכבר נחתם על נייר (סריקה/PDF).
 * "הפקת חוזה דיגיטלי" — יוצר קישור חתימה מרחוק מהתבנית הסטנדרטית
 * (ר׳ GenerateContractModal), שאפשר לשלוח בוואטסאפ; ההתקדמות שלו
 * (נשלח/נצפה/נחתם) מוצגת כאן בלי לרענן ידנית.
 */
function ContractsSection({ customer, devices = [] }) {
  const customerId = customer?.id ?? null;
  const fileInputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [generateOpen, setGenerateOpen] = useState(false);

  const contracts = useQuery(
    () => listContracts(customerId),
    [customerId],
    { enabled: Boolean(customerId) }
  );
  const rows = contracts.data ?? [];

  // חתימת לקוח נכנסת דרך RPC ציבורי, לא דרך session שלנו — בלי
  // Realtime המנהל היה צריך לסגור ולפתוח מחדש את כרטיס הלקוח כדי לראות שנחתם.
  useRealtime(['contracts'], contracts.refetch, { enabled: Boolean(customerId) });

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

  function shareLink(contract) {
    const link = `${window.location.origin}${window.location.pathname}?sign=${contract.sign_token}`;
    const message = `שלום ${customer?.name ?? ''}, מצורף חוזה ההתקשרות מול ICON AIR לחתימה דיגיטלית:\n${link}`;
    const href = whatsappLink(customer?.phone, message);
    if (href) window.open(href, '_blank', 'noopener');
    else navigator.clipboard?.writeText(link);
  }

  return (
    <div className="mt-5 border-t border-black/[0.07] pt-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h3 className="text-[14px] font-semibold">חוזים</h3>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf,image/*"
          className="hidden"
          onChange={handleFileChange}
        />
        <div className="ms-auto flex gap-2">
          <SecondaryButton disabled={busy} onClick={() => fileInputRef.current?.click()}>
            {busy ? 'מעלה…' : 'העלאת חוזה'}
          </SecondaryButton>
          <PrimaryButton onClick={() => setGenerateOpen(true)}>
            הפקת חוזה דיגיטלי
          </PrimaryButton>
        </div>
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
            hint="״הפקת חוזה דיגיטלי״ יוצרת קישור חתימה מרחוק; ״העלאת חוזה״ מיועדת לחוזה שכבר נחתם על נייר."
          />
        }
      >
        <div className="flex flex-col gap-[9px]">
          {rows.map((contract) => (
            <div key={contract.id} className="inner-row flex flex-wrap items-center gap-3 px-3.5 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-[13.5px] font-medium">{contract.title}</span>
                  <StatusChip tone={CONTRACT_STATUS_TONE[contract.status] ?? 'slate'}>
                    {CONTRACT_STATUS_LABEL[contract.status] ?? contract.status}
                  </StatusChip>
                </div>
                <div className="mt-0.5 text-[11.5px] text-text-faint">
                  {contract.status === 'signed' && contract.signed_at
                    ? `נחתם ${formatDateTime(contract.signed_at)} ע״י ${contract.signer_name ?? 'הלקוח'}`
                    : `נוצר ${formatDate(contract.created_at)}`}
                </div>
              </div>

              {contract.sign_token && contract.status !== 'signed' && contract.status !== 'declined' && (
                <SecondaryButton onClick={() => shareLink(contract)}>שליחה בוואטסאפ</SecondaryButton>
              )}
              {contract.file_path && <SecondaryButton onClick={() => handleView(contract)}>צפייה</SecondaryButton>}
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

      <GenerateContractModal
        open={generateOpen}
        customer={customer}
        devices={devices}
        onClose={() => setGenerateOpen(false)}
        onCreated={contracts.refetch}
      />
    </div>
  );
}