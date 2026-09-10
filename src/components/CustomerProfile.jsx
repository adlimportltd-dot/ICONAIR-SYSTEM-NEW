import { useEffect, useMemo, useRef, useState } from 'react';
import GlassCard, { CardHead } from './ui/GlassCard';
import GenerateContractModal from './GenerateContractModal';
import CustomerDetailsForm from './CustomerDetailsForm';
import { DeviceForm } from './DeviceFormModal';
import { StatusChip, MiniMeter, oilTone } from './ui/DataTable';
import { Async, EmptyState } from './ui/States';
import { PrimaryButton, SecondaryButton, Field, TextInput } from './ui/Field';
import { TrashIcon, UsersIcon, DeviceIcon, PhoneIcon, PrinterIcon, EditIcon, PlusIcon, ChevronRightIcon } from './ui/Icons';
import { useAuth } from '../context/AuthContext';
import { useQuery } from '../hooks/useQuery';
import { useRealtime } from '../hooks/useRealtime';
import {
  getCustomer,
  listCustomerDevices,
  listCustomerSites,
  updateCustomerSite,
  deleteCustomerSite,
  upsertSiteModelPrice,
  updateDevice,
  deleteDevice,
  deleteCustomerCascade,
  listScents,
  listDeviceModels,
  listContracts,
  uploadContract,
  getContractUrl,
  deleteContract,
} from '../lib/queries';
import { describeError } from '../lib/supabase';
import {
  DEVICE_STATUS_LABEL, CUSTOMER_STATUS_LABEL, PAYMENT_TYPE_LABEL, modelTone, relativeTime,
  formatDate, formatDateTime, summarizeDevicesByModel, computeVat, formatCurrency,
} from '../lib/mappers';
import {
  computeDeviceBreakdown, computeCustomerDeviceTotal, priceMapOf, hasOwnPrice, effectivePrice,
} from '../lib/pricing';
import { whatsappLink } from '../lib/navLinks';

const DEVICE_STATUS_TONE = { active: 'ok', offline: 'crit', maintenance: 'warn', uninstalled: 'slate' };
const CUSTOMER_STATUS_TONE = { active: 'ok', onboarding: 'gold', paused: 'warn', churned: 'crit' };

const CONTRACT_STATUS_LABEL = {
  uploaded: 'הועלה ידנית', draft: 'טיוטה', sent: 'ממתין לחתימה',
  viewed: 'נצפה ע״י הלקוח', signed: 'נחתם', declined: 'נדחה',
};
const CONTRACT_STATUS_TONE = {
  uploaded: 'slate', draft: 'slate', sent: 'gold', viewed: 'teal', signed: 'ok', declined: 'crit',
};

const UNASSIGNED = '__none__';

/*
 * תמחור — מקור אמת אחד לכל המערכת, לא רק לכרטיס הזה: computeDeviceBreakdown/
 * computeCustomerDeviceTotal עברו ל-src/lib/pricing.js (2026-09-10) כדי
 * ש-CustomersScreen/דוחות יחשבו בדיוק אותו סכום ללקוחות ריבוי-כתובות
 * כמו אוורסט, במקום ליפול ל-amount_due הידני שנשאר 0 עבורם.
 */

/**
 * כרטיס לקוח מאוחד (Master Profile) — מסך שלם בתוך מסך הלקוחות, לא
 * חלון קופץ. מקור אמת אחד לכל מה שקשור ללקוח: פרטי קשר וחיוב, כתובות
 * (עם קוד בניין), מכשירים לפי דגם, תמחור (לדגם/למכשיר) עם מע"מ, חוזים.
 * כל פעולה (הוספה/עריכה/מחיקה של כתובת, מכשיר, מחיר) היא פאנל מוטבע
 * כאן — לא מודאל צדדי. הכרטיס טוען את הנתונים שלו בעצמו ומאזין
 * ב-Realtime, כך שכל שינוי (גם ממכשיר אחר) משתקף מייד, ומדווח להורה
 * (onChanged) כדי שרשימת הלקוחות תתרענן.
 */
export default function CustomerProfile({ customer: initialCustomer, onBack, onChanged, onDeleted, startEditing = false }) {
  const { isAdmin } = useAuth();
  const customerId = initialCustomer?.id ?? null;

  const customerQ = useQuery(() => getCustomer(customerId), [customerId], { enabled: Boolean(customerId) });
  const customer = customerQ.data ?? initialCustomer;

  const devices = useQuery(() => listCustomerDevices(customerId), [customerId], { enabled: Boolean(customerId) });
  const sites = useQuery(() => listCustomerSites(customerId), [customerId], { enabled: Boolean(customerId) });
  const scents = useQuery(listScents, []);
  const models = useQuery(listDeviceModels, []);

  const scentOptions = useMemo(() => (scents.data ?? []).map((s) => ({ value: s.name, label: s.name })), [scents.data]);
  const modelOptions = useMemo(() => (models.data ?? []).map((m) => ({ value: m.name, label: m.name })), [models.data]);

  // סנכרון רוחבי: כל שינוי במכשירים/כתובות/מחירים/לקוח — גם ממסך אחר
  // או ממשתמש אחר — מרענן את הכרטיס בלי רענון ידני.
  useRealtime(['devices', 'customer_sites', 'customer_site_model_prices'], () => { devices.refetch(); sites.refetch(); }, { enabled: Boolean(customerId) });
  useRealtime(['customers'], customerQ.refetch, { enabled: Boolean(customerId) });

  const [detailsEditing, setDetailsEditing] = useState(startEditing);
  const [deviceForm, setDeviceForm] = useState(null); // null | { site, editDevice }
  const [actionError, setActionError] = useState(null);

  useEffect(() => {
    setDetailsEditing(startEditing);
    setDeviceForm(null);
    setActionError(null);
  }, [customerId, startEditing]);

  const rows = devices.data ?? [];
  const siteRows = sites.data ?? [];
  const hasSites = siteRows.length > 0;
  const siteOptions = useMemo(
    () => siteRows.map((s) => ({ value: s.id, label: [s.label, s.city].filter(Boolean).join(' · ') })),
    [siteRows]
  );

  const devicesBySite = useMemo(() => {
    const map = new Map();
    for (const device of rows) {
      const key = device.site_id ?? UNASSIGNED;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(device);
    }
    return map;
  }, [rows]);

  const unassigned = devicesBySite.get(UNASSIGNED) ?? [];

  // סיכום כולל: כתובות (לפי מחיר-דגם/מכשיר) + מכשירים בלי כתובת (לפי מחיר-מכשיר בלבד)
  const totals = useMemo(
    () => computeCustomerDeviceTotal(rows, siteRows),
    [rows, siteRows]
  );

  function refreshAll() {
    devices.refetch();
    sites.refetch();
    customerQ.refetch();
    onChanged?.();
  }

  const deviceFormRef = useRef(null);
  function openDeviceForm(next) {
    setDeviceForm(next);
    setTimeout(() => deviceFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  }

  if (!customer) return null;

  const activeCount = rows.filter((d) => d.status !== 'uninstalled').length;

  return (
    <div className="animate-rise">
      {/*
        --- כותרת המסך --- כפתור החזרה (2026-09-09, בעקבות משוב "צריך
        לחפש איך לחזור אחורה"): גדול, עם שברון, וממוקם ראשון בשורה כדי
        שהעין תיתקל בו מיד — לא ghost-btn דק שנבלע בין שאר האלמנטים.
      */}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1.5 rounded-pill border border-[#CBD5E1] bg-white px-4 py-2.5
                     text-[15px] font-bold text-text shadow-nest transition-colors
                     hover:border-gold-500/50 hover:bg-gold-500/[0.06] hover:text-gold-600"
        >
          <ChevronRightIcon className="h-[18px] w-[18px]" />
          חזרה לרשימה
        </button>
        <div className="min-w-0">
          <h2 className="truncate font-display text-[28px] font-bold leading-tight">{customer.name}</h2>
          <div className="mt-1 text-[14px] font-medium text-text-faint">
            {[customer.city, customer.route_name].filter(Boolean).join(' · ') || 'ללא עיר/קו'}
          </div>
        </div>
        <StatusChip tone={CUSTOMER_STATUS_TONE[customer.status] ?? 'neutral'}>
          {CUSTOMER_STATUS_LABEL[customer.status] ?? customer.status}
        </StatusChip>
        <div className="ms-auto flex flex-wrap gap-2.5">
          {isAdmin && (
            <SecondaryButton onClick={() => setDetailsEditing((v) => !v)}>
              <EditIcon className="h-4 w-4" />
              {detailsEditing ? 'סגור עריכת פרטים' : 'עריכת פרטים'}
            </SecondaryButton>
          )}
          <PrimaryButton onClick={() => openDeviceForm({ site: null, editDevice: null })}>
            <PlusIcon className="h-4 w-4" />
            הוסף מכשיר
          </PrimaryButton>
        </div>
      </div>

      {actionError && (
        <div className="mb-5 rounded-row border border-crit/25 bg-crit/[0.07] px-4 py-3 text-[14px] text-crit-soft">
          {actionError}
        </div>
      )}

      {/*
        2026-09-09 Full Design Overhaul #2 — "Vertical Stacked Flow": בלי
        עמודת-צד מקבילה לתוכן הראשי. כל בלוק תופס את מלוא הרוחב ונערם
        אנכית מלמעלה למטה: (1) פרטי לקוח + סיכום כספי מאוחדים בכרטיס אחד
        עליון, (2) כתובות ומכשירים, (3) חוזים, (4) אזור מסוכן.
      */}
      <div className="flex flex-col gap-6">
        {/* --- בלוק עליון: פרטי לקוח + סיכום כספי כולל, מאוחד --- */}
        <GlassCard>
          <div className="flex flex-col gap-6">
            <div className="flex flex-wrap items-stretch gap-4 rounded-row border border-amber-400/25 bg-amber-500/[0.07] p-5 sm:p-6">
              <SummaryStat label="מכשירים פעילים" value={activeCount} />
              <div className="hidden w-px self-stretch bg-black/[0.08] sm:block" />
              <SummaryStat label="כתובות" value={siteRows.length} />
              <div className="hidden w-px self-stretch bg-black/[0.08] sm:block" />
              <div className="min-w-[200px] flex-1">
                <div className="text-[13px] font-bold uppercase tracking-[0.8px] text-text-faint">עלות חודשית כוללת · כולל מע״מ</div>
                <div className="tabular mt-1 font-display text-[38px] font-extrabold leading-none text-gold-600">
                  {formatCurrency(totals.total)}
                </div>
                <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-[14px] font-semibold text-text-dim">
                  <span>לפני מע״מ <b className="tabular font-mono text-text">{formatCurrency(totals.preVat)}</b></span>
                  <span>מע״מ 18% <b className="tabular font-mono text-text">{formatCurrency(totals.vatAmount)}</b></span>
                </div>
              </div>
            </div>

            <div>
              <CardHead icon={UsersIcon} title="פרטי לקוח" subtitle={detailsEditing ? 'השינויים נשמרים מיד' : 'קשר, כתובת ראשית, קו וחיוב'} />
              {detailsEditing ? (
                <CustomerDetailsForm
                  key={customer.updated_at ?? customer.id}
                  customer={customer}
                  isAdmin={isAdmin}
                  computedBilling={totals}
                  onSaved={() => { setDetailsEditing(false); refreshAll(); }}
                  onCancel={() => setDetailsEditing(false)}
                />
              ) : (
                <CustomerDetailsView customer={customer} isAdmin={isAdmin} computedBilling={totals} />
              )}
            </div>
          </div>
        </GlassCard>

        {/* --- כתובות, מכשירים, תמחור, חוזים — כל אחד נערם במלוא הרוחב --- */}
        <div className="flex min-w-0 flex-col gap-6">
          {deviceForm && (
            <GlassCard as="section" className="border-gold-300/[0.35]">
              <div ref={deviceFormRef} />
              <CardHead
                icon={DeviceIcon}
                title={deviceForm.editDevice ? `עריכת מכשיר ${deviceForm.editDevice.serial}` : 'מכשיר חדש'}
                subtitle={deviceForm.editDevice ? 'שינויים נשמרים לכרטיס הזה' : `נרשם ל${customer.name} · המספר הסידורי נוצר אוטומטית`}
              />
              <DeviceForm
                key={`${deviceForm.editDevice?.id ?? 'new'}:${deviceForm.site?.id ?? 'any'}`}
                lockedCustomer={customer}
                lockedSite={deviceForm.site}
                editDevice={deviceForm.editDevice}
                siteOptions={siteOptions}
                canCreateSite={isAdmin}
                scentOptions={scentOptions}
                modelOptions={modelOptions}
                onSaved={(_device, { keepOpen }) => {
                  refreshAll();
                  if (!keepOpen) setDeviceForm(null);
                }}
                onCancel={() => setDeviceForm(null)}
              />
            </GlassCard>
          )}

          <GlassCard as="section">
            <CardHead
              icon={DeviceIcon}
              title="כתובות ומכשירים"
              subtitle={devices.loading ? 'טוען…' : `${rows.length} מכשירים${hasSites ? ` · ${siteRows.length} כתובות` : ''}`}
            />

            <Async
              loading={devices.loading || sites.loading}
              error={devices.error || sites.error}
              onRetry={refreshAll}
              isEmpty={rows.length === 0 && !hasSites}
              empty={
                <EmptyState
                  title="ללקוח הזה עוד אין מכשירים"
                  hint="לחץ על ״הוסף מכשיר״ — אפשר לפתוח שם גם כתובת חדשה ולשייך אליה ישר."
                  action={(
                    <PrimaryButton onClick={() => openDeviceForm({ site: null, editDevice: null })}>
                      <PlusIcon className="h-4 w-4" />
                      הוסף מכשיר
                    </PrimaryButton>
                  )}
                />
              }
            >
              {/*
                2026-09-09 (בעקבות משוב "הכל נראה מחובר ונוזל יחד"): "באר"
                אפורה-כחלחלה (bg-ink-800) שמפרידה חזותית בין כל כרטיסי-הכתובת
                הלבנים — כרטיס אחד (border-slate-300 + shadow-nest) "מרחף"
                בבירור מעל הרקע השקוע, במקום לשבת צמוד לכרטיס-האם הלבן
                שגם הוא לבן. זה מה שנותן את ה"אפשר להבחין מיד איפה כתובת אחת
                נגמרת והשנייה מתחילה" גם ללקוח עם עשרות כתובות (כמו אוורסט).
              */}
              <div className="flex flex-col gap-5 rounded-row bg-ink-800 p-3 sm:p-4">
                {siteRows.map((site) => (
                  <SiteCard
                    key={site.id}
                    site={site}
                    devices={devicesBySite.get(site.id) ?? []}
                    isAdmin={isAdmin}
                    onAddDevice={() => openDeviceForm({ site, editDevice: null })}
                    onEditDevice={(device) => openDeviceForm({ site: null, editDevice: device })}
                    onChanged={refreshAll}
                    onError={setActionError}
                  />
                ))}

                {(unassigned.length > 0 || !hasSites) && (
                  <DeviceGroup
                    title={hasSites ? 'ללא כתובת משוייכת' : 'מכשירים'}
                    subtitle={hasSites ? 'מכשירים שעדיין לא שויכו לכתובת — ערוך מכשיר כדי לשייך' : summarizeDevicesByModel(unassigned)}
                    devices={unassigned}
                    prices={[]}
                    isAdmin={isAdmin}
                    onEditDevice={(device) => openDeviceForm({ site: null, editDevice: device })}
                    onChanged={refreshAll}
                    onError={setActionError}
                    showSummary={!hasSites}
                  />
                )}
              </div>
            </Async>
          </GlassCard>

          {isAdmin && (
            <GlassCard as="section">
              <ContractsSection customer={customer} devices={rows} />
            </GlassCard>
          )}

          {isAdmin && (
            <DangerZone customer={customer} deviceCount={rows.length} onDeleted={onDeleted} onError={setActionError} />
          )}
        </div>
      </div>
    </div>
  );
}

/** מספר-על בתוך רצועת הסיכום הכספי העליונה (מכשירים פעילים / כתובות) */
function SummaryStat({ label, value }) {
  return (
    <div className="min-w-[110px]">
      <div className="text-[13px] font-bold uppercase tracking-[0.8px] text-text-faint">{label}</div>
      <div className="tabular mt-1 font-display text-[38px] font-extrabold leading-none text-text">{value}</div>
    </div>
  );
}

/**
 * תצוגת פרטי הלקוח — שורות ברורות, טלפון ואימייל לחיצים לשטח.
 * "חיוב כללי" מציג את computedBilling (סכום המכשירים/כתובות האמיתי,
 * אותו מקור בדיוק כמו רצועת הסיכום למעלה בכרטיס) כשקיים תמחור-מכשירים
 * ללקוח — לא את amount_due הידני, שנשאר 0/מיושן אצל לקוחות ריבוי-כתובות
 * כמו אוורסט. amount_due עדיין המקור היחיד ללקוח בלי שום מכשיר מתומחר
 * (חיוב-גלובלי ידני טהור) — ר' effectiveCustomerBilling ב-pricing.js
 * לאותה לוגיקה בדיוק, כאן פשוט אין צורך לקרוא לה כי totals כבר מחושב.
 */
function CustomerDetailsView({ customer, isAdmin, computedBilling }) {
  const tel = customer.phone ? `tel:${String(customer.phone).replace(/[^\d+]/g, '')}` : null;
  const wa = whatsappLink(customer.phone, '');
  const vat = computedBilling?.hasDeviceBilling ? computedBilling : computeVat(customer.amount_due, customer.vat_mode);

  return (
    <dl className="flex flex-col divide-y divide-black/[0.06] text-[15px]">
      <Row label="איש קשר">{customer.contact_name || '—'}</Row>
      <Row label="טלפון">
        {customer.phone ? (
          <span className="flex flex-wrap items-center gap-2">
            <a dir="ltr" href={tel} className="font-mono text-gold-600 underline-offset-2 hover:underline">{customer.phone}</a>
            <a href={tel} className="ghost-btn !px-3 !py-1.5 inline-flex items-center gap-1.5 text-[14px]" aria-label="התקשר">
              <PhoneIcon className="h-4 w-4" /> התקשר
            </a>
            {wa && <a href={wa} target="_blank" rel="noopener" className="ghost-btn !px-3 !py-1.5 text-[14px]">וואטסאפ</a>}
          </span>
        ) : '—'}
      </Row>
      <Row label="אימייל">{customer.email ? <a dir="ltr" href={`mailto:${customer.email}`} className="font-mono text-gold-600 hover:underline">{customer.email}</a> : '—'}</Row>
      <Row label="כתובת ראשית">{[customer.address, customer.city].filter(Boolean).join(', ') || '—'}</Row>
      <Row label="קו הפצה">{customer.route_name || '—'}</Row>
      {isAdmin && (
        <>
          <Row label="סוג תשלום">{PAYMENT_TYPE_LABEL[customer.payment_type] ?? customer.payment_type ?? '—'}</Row>
          <Row label="גבייה">
            <StatusChip tone={customer.is_paid ? 'ok' : 'crit'}>{customer.is_paid ? 'שולם' : 'ממתין לגבייה'}</StatusChip>
            {customer.payment_due_date && <span className="ms-2 text-[14px] text-text-faint">פירעון {formatDate(customer.payment_due_date)}</span>}
          </Row>
          <Row label="חיוב כללי (כולל מע״מ)">
            <span className="tabular font-mono font-semibold">{formatCurrency(vat.total)}</span>
            <span className="ms-2 text-[13px] text-text-faint">לפני מע״מ {formatCurrency(vat.preVat)}</span>
            {computedBilling?.hasDeviceBilling && (
              <span className="ms-2 text-[13px] text-teal-500">מחושב אוטומטית ממכשירים/כתובות</span>
            )}
          </Row>
        </>
      )}
      {customer.notes && <Row label="הערות"><span className="whitespace-pre-wrap">{customer.notes}</span></Row>}
    </dl>
  );
}

function Row({ label, children }) {
  return (
    <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-3 py-3 first:pt-0 last:pb-0">
      <dt className="text-[14px] text-text-faint">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

/* =====================================================================
   כתובת (אתר) — כרטיסייה עם עריכה/מחיקה מוטבעות, תמחור לדגם, ומכשירים
   ===================================================================== */
function SiteCard({ site, devices, isAdmin, onAddDevice, onEditDevice, onChanged, onError }) {
  const [open, setOpen] = useState(devices.length > 0 && devices.length <= 6);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const breakdown = computeDeviceBreakdown(devices, site.prices);

  async function handleDelete() {
    if (!confirmDelete) { setConfirmDelete(true); return; }
    setBusy(true);
    try {
      await deleteCustomerSite(site.id);
      onChanged();
    } catch (caught) {
      onError(describeError(caught));
    } finally {
      setBusy(false);
      setConfirmDelete(false);
    }
  }

  return (
    <div className="rounded-row border border-[#CBD5E1] bg-ink-900 shadow-nest">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-4 px-4 py-4 text-start"
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[17px] font-semibold">{site.label}</span>
            {site.building_code && (
              <span dir="ltr" className="chip font-mono">קוד {site.building_code}</span>
            )}
          </div>
          <div className="mt-1 text-[14px] text-text-faint">
            {site.city ? `${site.city} · ` : ''}{summarizeDevicesByModel(devices)}
          </div>
        </div>
        <div className="flex-none text-end">
          <div className="tabular font-mono text-[17px] font-bold text-gold-600">{formatCurrency(breakdown.total)}</div>
          <div className="text-[12.5px] text-text-faint">כולל מע״מ · {devices.length} מכשירים</div>
        </div>
        <span className={`flex-none text-text-faint transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden>▾</span>
      </button>

      {open && (
        <div className="border-t border-black/[0.06] px-4 pb-4 pt-4">
          {isAdmin && (
            <div className="mb-4 flex flex-wrap items-center gap-2.5">
              <SecondaryButton onClick={onAddDevice}>
                <PlusIcon className="h-4 w-4 text-ok" />
                הוסף מכשיר לכתובת זו
              </SecondaryButton>
              <SecondaryButton onClick={() => setEditing((v) => !v)}>
                <EditIcon className="h-4 w-4" />
                {editing ? 'סגור עריכה' : 'עריכת כתובת'}
              </SecondaryButton>
              <button
                type="button"
                onClick={handleDelete}
                disabled={busy}
                className={`ghost-btn px-4 py-2.5 text-[14px] ${confirmDelete ? '!border-crit/60 !bg-crit/10 !text-crit-soft' : 'hover:!border-crit/40 hover:!text-crit-soft'}`}
              >
                <TrashIcon className={`h-4 w-4 ${confirmDelete ? '' : 'text-crit-soft'}`} />
                {confirmDelete ? 'לאשר מחיקת כתובת (המכשירים נשארים)' : 'מחיקת כתובת'}
              </button>
            </div>
          )}

          {editing && (
            <SiteEditForm site={site} onSaved={() => { setEditing(false); onChanged(); }} onCancel={() => setEditing(false)} />
          )}

          <DeviceGroup
            devices={devices}
            prices={site.prices}
            isAdmin={isAdmin}
            site={site}
            onEditDevice={onEditDevice}
            onChanged={onChanged}
            onError={onError}
            showSummary
            bare
          />
        </div>
      )}
    </div>
  );
}

function SiteEditForm({ site, onSaved, onCancel }) {
  const [label, setLabel] = useState(site.label ?? '');
  const [city, setCity] = useState(site.city ?? '');
  const [code, setCode] = useState(site.building_code ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function submit(event) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await updateCustomerSite(site.id, { label: label.trim(), city: city.trim() || null, building_code: code.trim() || null });
      onSaved();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mb-4 rounded-row border border-gold-300/[0.3] bg-gold-500/[0.06] p-4">
      <div className="grid grid-cols-1 gap-4 xs:grid-cols-3">
        <Field label="שם הכתובת" required>
          <TextInput value={label} onChange={(e) => setLabel(e.target.value)} required autoFocus />
        </Field>
        <Field label="עיר" hint="קובעת לאיזה קו הפצה הכתובת שייכת">
          <TextInput value={city} onChange={(e) => setCity(e.target.value)} />
        </Field>
        <Field label="קוד בניין">
          <TextInput dir="ltr" className="text-start" value={code} onChange={(e) => setCode(e.target.value)} placeholder="#1234" />
        </Field>
      </div>
      {error && <div className="mt-3 text-[14px] text-crit-soft">{error}</div>}
      <div className="mt-4 flex gap-2.5">
        <PrimaryButton type="submit" loading={busy}>שמירת כתובת</PrimaryButton>
        <SecondaryButton onClick={onCancel}>ביטול</SecondaryButton>
      </div>
    </form>
  );
}

/* =====================================================================
   קבוצת מכשירים (של כתובת, או "ללא כתובת") + טבלת תמחור לדגם + סיכום
   ===================================================================== */
function DeviceGroup({ title, subtitle, devices, prices, isAdmin, site = null, onEditDevice, onChanged, onError, showSummary, bare = false }) {
  const breakdown = computeDeviceBreakdown(devices, prices);
  const priceMap = priceMapOf(prices);

  const body = (
    <>
      {site && breakdown.lines.length > 0 && (
        <div className="mb-4">
          <div className="mb-2 text-[14px] font-semibold text-text-dim">תמחור לפי דגם (מחיר ברירת מחדל ליחידה, לפני מע״מ)</div>
          <div className="flex flex-col gap-2">
            {breakdown.lines.map((line) => (
              <ModelPriceRow key={line.model} site={site} line={line} isAdmin={isAdmin} onSaved={onChanged} onError={onError} />
            ))}
          </div>
        </div>
      )}

      {devices.length === 0 ? (
        <div className="rounded-row border border-dashed border-black/[0.1] px-4 py-6 text-center text-[14px] text-text-faint">
          אין מכשירים כאן עדיין
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {devices.map((device) => (
            <DeviceRow
              key={device.id}
              device={device}
              effective={effectivePrice(device, priceMap)}
              isAdmin={isAdmin}
              onEdit={() => onEditDevice(device)}
              onChanged={onChanged}
              onError={onError}
            />
          ))}
        </div>
      )}

      {showSummary && devices.length > 0 && (
        <div className="mt-4 grid grid-cols-3 gap-3 rounded-row border border-black/[0.06] bg-ink-800 px-4 py-3.5 text-center">
          <div>
            <div className="text-[12.5px] text-text-faint">לפני מע״מ</div>
            <div className="tabular mt-0.5 font-mono text-[15px] font-semibold">{formatCurrency(breakdown.preVat)}</div>
          </div>
          <div>
            <div className="text-[12.5px] text-text-faint">מע״מ (18%)</div>
            <div className="tabular mt-0.5 font-mono text-[15px] font-semibold text-text-dim">{formatCurrency(breakdown.vatAmount)}</div>
          </div>
          <div>
            <div className="text-[12.5px] text-text-faint">סה״כ כולל מע״מ</div>
            <div className="tabular mt-0.5 font-mono text-[16px] font-bold text-gold-600">{formatCurrency(breakdown.total)}</div>
          </div>
        </div>
      )}
    </>
  );

  if (bare) return body;

  return (
    <div className="rounded-row border border-[#CBD5E1] bg-ink-900 p-4 shadow-nest">
      <div className="mb-3">
        <div className="text-[17px] font-semibold">{title}</div>
        {subtitle && <div className="mt-0.5 text-[14px] text-text-faint">{subtitle}</div>}
      </div>
      {body}
    </div>
  );
}

/** שורת "דגם · כמות · מחיר ברירת מחדל ליחידה · סה״כ" */
function ModelPriceRow({ site, line, isAdmin, onSaved, onError }) {
  const [price, setPrice] = useState(String(line.defaultUnitPrice));
  const [saving, setSaving] = useState(false);

  useEffect(() => { setPrice(String(line.defaultUnitPrice)); }, [line.defaultUnitPrice]);

  async function save() {
    setSaving(true);
    try {
      await upsertSiteModelPrice(site.id, line.model, Number(price || 0));
      onSaved?.();
    } catch (caught) {
      onError?.(describeError(caught));
    } finally {
      setSaving(false);
    }
  }

  const dirty = Number(price || 0) !== line.defaultUnitPrice;

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-row border border-black/[0.06] bg-ink-800 px-4 py-2.5">
      <StatusChip tone={modelTone(line.model)}>{line.model}</StatusChip>
      <span className="tabular text-[14px] text-text-dim">× {line.count}</span>
      {line.overrides > 0 && (
        <span className="text-[12.5px] text-text-faint">({line.overrides} עם מחיר ידני)</span>
      )}

      {isAdmin ? (
        <div className="ms-auto flex items-center gap-2">
          <input
            type="number"
            min={0}
            step="0.01"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (dirty) save(); } }}
            aria-label={`מחיר ליחידה ל-${line.model}`}
            className="w-[110px] rounded-pill border border-black/[0.09] bg-ink-900 px-3 py-2 text-[15px] text-text
                       focus:border-gold-500/45 focus:outline-none"
          />
          <span className="text-[13px] text-text-faint">₪ / יח׳</span>
          <button
            type="button"
            onClick={save}
            disabled={saving || !dirty}
            className="rounded-pill border border-gold-300/[0.35] bg-gold-500/[0.12] px-3.5 py-2 text-[14px]
                       font-semibold text-gold-600 transition-colors disabled:opacity-40 hover:border-gold-300/60"
          >
            {saving ? 'שומר…' : 'שמירה'}
          </button>
        </div>
      ) : (
        <span className="tabular ms-auto text-[14px] text-text-faint">{formatCurrency(line.defaultUnitPrice)} / יח׳</span>
      )}

      <span className="tabular w-[92px] flex-none text-end font-mono text-[15px] font-semibold">
        {formatCurrency(line.lineTotal)}
      </span>
    </div>
  );
}

/** שורת מכשיר: זיהוי, מצב, מחיר אפקטיבי עם דריסה ידנית, עריכה ומחיקה — הכול במקום */
function DeviceRow({ device, effective, isAdmin, onEdit, onChanged, onError }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [priceEditing, setPriceEditing] = useState(false);
  const [price, setPrice] = useState(hasOwnPrice(device) ? String(device.unit_price) : '');

  useEffect(() => { setPrice(hasOwnPrice(device) ? String(device.unit_price) : ''); }, [device.unit_price]);

  async function handleDelete() {
    if (!confirmDelete) { setConfirmDelete(true); return; }
    setBusy(true);
    try {
      await deleteDevice(device.id);
      onChanged();
    } catch (caught) {
      onError(describeError(caught));
    } finally {
      setBusy(false);
      setConfirmDelete(false);
    }
  }

  async function savePrice(value) {
    setBusy(true);
    try {
      await updateDevice(device.id, { unit_price: value === '' ? null : Number(value) });
      setPriceEditing(false);
      onChanged();
    } catch (caught) {
      onError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="inner-row px-4 py-3.5">
      <div className="flex flex-wrap items-center gap-2.5">
        <span dir="ltr" className="font-mono text-[14px] font-semibold text-gold-600">{device.serial}</span>
        <StatusChip tone={modelTone(device.model)}>{device.model}</StatusChip>
        <StatusChip tone={DEVICE_STATUS_TONE[device.status]}>{DEVICE_STATUS_LABEL[device.status]}</StatusChip>

        <div className="ms-auto flex flex-wrap items-center gap-2">
          {priceEditing ? (
            <>
              <input
                type="number"
                min={0}
                step="0.01"
                value={price}
                autoFocus
                placeholder="לפי דגם"
                onChange={(e) => setPrice(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); savePrice(price); } if (e.key === 'Escape') setPriceEditing(false); }}
                aria-label={`מחיר ידני למכשיר ${device.serial}`}
                className="w-[110px] rounded-pill border border-gold-500/45 bg-ink-900 px-3 py-2 text-[15px] text-text focus:outline-none"
              />
              <button type="button" onClick={() => savePrice(price)} disabled={busy}
                      className="rounded-pill border border-gold-300/[0.35] bg-gold-500/[0.12] px-3.5 py-2 text-[14px] font-semibold text-gold-600">
                שמירה
              </button>
              {hasOwnPrice(device) && (
                <button type="button" onClick={() => savePrice('')} disabled={busy} className="ghost-btn !px-3 !py-2 text-[13.5px]">
                  חזרה למחיר דגם
                </button>
              )}
              <button type="button" onClick={() => setPriceEditing(false)} className="ghost-btn !px-3 !py-2 text-[13.5px]">ביטול</button>
            </>
          ) : (
            <button
              type="button"
              onClick={isAdmin ? () => setPriceEditing(true) : undefined}
              title={isAdmin ? 'לחץ לקביעת מחיר ידני למכשיר הזה' : undefined}
              className={`tabular rounded-pill border px-3.5 py-2 text-[14px] font-semibold ${
                hasOwnPrice(device)
                  ? 'border-gold-300/[0.4] bg-gold-500/[0.1] text-gold-600'
                  : 'border-black/[0.08] bg-black/[0.02] text-text-dim'
              } ${isAdmin ? 'hover:border-gold-300/60' : 'cursor-default'}`}
            >
              {formatCurrency(effective)} <span className="text-[12.5px] font-normal text-text-faint">{hasOwnPrice(device) ? 'ידני' : 'לפי דגם'}</span>
            </button>
          )}

          {isAdmin && !priceEditing && (
            <>
              <button type="button" onClick={onEdit} className="ghost-btn !px-3.5 !py-2 text-[14px]">
                <EditIcon className="h-4 w-4" />
                עריכה
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={busy}
                aria-label={confirmDelete ? `לאשר מחיקת מכשיר ${device.serial}` : `מחק מכשיר ${device.serial}`}
                className={`flex items-center gap-1.5 rounded-pill border px-3.5 py-2 text-[14px] font-semibold transition-colors disabled:opacity-50 ${
                  confirmDelete
                    ? 'border-crit/50 bg-crit/10 text-crit-soft'
                    : 'border-black/[0.09] text-text-faint hover:border-crit/35 hover:text-crit-soft'
                }`}
              >
                <TrashIcon className={`h-4 w-4 ${confirmDelete ? '' : 'text-crit-soft'}`} />
                {confirmDelete ? 'לאשר מחיקה' : 'מחיקה'}
              </button>
            </>
          )}
        </div>
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[14px]">
        <span className="text-text-faint">מיקום: <span className="text-text">{device.location_note || 'לא צוין'}</span></span>
        <span className="text-text-faint">ניחוח: <span className="text-text">{device.scent_name || 'לא משויך'}</span></span>
        <span className="tabular text-text-faint">נראה {relativeTime(device.last_seen_at)}</span>
        <div className="w-full max-w-[260px] sm:w-auto sm:flex-1">
          <MiniMeter value={device.oil_level_pct} tone={oilTone(device.oil_level_pct)} />
        </div>
      </div>
    </div>
  );
}

/* =====================================================================
   חוזים (מנהלים) — ללא שינוי במהות, רק גדלים
   ===================================================================== */
function ContractsSection({ customer, devices = [] }) {
  const customerId = customer?.id ?? null;
  const fileInputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [generateOpen, setGenerateOpen] = useState(false);

  const contracts = useQuery(() => listContracts(customerId), [customerId], { enabled: Boolean(customerId) });
  const rows = contracts.data ?? [];

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
    if (confirmDeleteId !== contract.id) { setConfirmDeleteId(contract.id); return; }
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
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <CardHead icon={PrinterIcon} tone="slate" title="חוזים" subtitle="חתימה דיגיטלית מרחוק או העלאת חוזה חתום" />
        <input ref={fileInputRef} type="file" accept="application/pdf,image/*" className="hidden" onChange={handleFileChange} />
        <div className="ms-auto -mt-5 flex flex-wrap gap-2.5">
          <SecondaryButton disabled={busy} onClick={() => fileInputRef.current?.click()}>
            {busy ? 'מעלה…' : 'העלאת חוזה'}
          </SecondaryButton>
          <PrimaryButton onClick={() => setGenerateOpen(true)}>הפקת חוזה דיגיטלי</PrimaryButton>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-row border border-crit/25 bg-crit/[0.07] px-4 py-3 text-[14px] text-crit-soft">{error}</div>
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
        <div className="flex flex-col gap-2.5">
          {rows.map((contract) => (
            <div key={contract.id} className="inner-row flex flex-wrap items-center gap-3 px-4 py-3.5">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-[15px] font-medium">{contract.title}</span>
                  <StatusChip tone={CONTRACT_STATUS_TONE[contract.status] ?? 'slate'}>
                    {CONTRACT_STATUS_LABEL[contract.status] ?? contract.status}
                  </StatusChip>
                </div>
                <div className="mt-0.5 text-[13px] text-text-faint">
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
                className={confirmDeleteId === contract.id ? '!border-crit/40 !text-crit-soft' : ''}
                onClick={() => handleDelete(contract)}
              >
                <TrashIcon className="h-4 w-4 text-crit-soft" />
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
    </>
  );
}

/** אזור מסוכן — מחיקת לקוח מלאה, אישור כפול */
function DangerZone({ customer, deviceCount, onDeleted, onError }) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleDelete() {
    if (!confirm) { setConfirm(true); return; }
    setBusy(true);
    try {
      await deleteCustomerCascade(customer.id);
      onDeleted?.();
    } catch (caught) {
      onError(describeError(caught));
      setConfirm(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-card border border-crit/25 bg-crit/[0.04] p-5 sm:p-6">
      <div className="text-[15px] font-semibold text-crit-soft">אזור מסוכן</div>
      <p className="mt-1.5 max-w-prose text-[14px] leading-relaxed text-text-faint">
        מחיקת הלקוח מוחקת לצמיתות גם את {deviceCount} המכשירים שלו (כולל כל היסטוריית השמן), את קריאות השירות,
        החוזים, הכתובות ושיוכי המסלול. אי אפשר לשחזר.
      </p>
      <button
        type="button"
        onClick={handleDelete}
        disabled={busy}
        className={`mt-4 flex items-center gap-1.5 rounded-pill border px-5 py-2.5 text-[14px] font-semibold transition-colors disabled:opacity-50 ${
          confirm ? 'border-crit bg-crit text-white hover:bg-crit/90' : 'border-crit/40 text-crit-soft hover:border-crit/60'
        }`}
      >
        <TrashIcon className="h-4 w-4" />
        {busy ? 'מוחק…' : confirm ? 'לחץ שוב כדי למחוק לצמיתות' : 'מחק לקוח לצמיתות'}
      </button>
    </div>
  );
}
