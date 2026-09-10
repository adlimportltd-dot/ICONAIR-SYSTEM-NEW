import { useMemo, useState } from 'react';
import GlassCard, { CardHead } from '../components/ui/GlassCard';
import DataTable, { StatusChip } from '../components/ui/DataTable';
import ScreenToolbar from '../components/ui/ScreenToolbar';
import CustomerProfile from '../components/CustomerProfile';
import CustomerDetailsForm from '../components/CustomerDetailsForm';
import { Async, EmptyState } from '../components/ui/States';
import { PrinterIcon, UsersIcon } from '../components/ui/Icons';
import { useAuth } from '../context/AuthContext';
import { useQuery } from '../hooks/useQuery';
import { useRealtime } from '../hooks/useRealtime';
import { listCustomers, setCustomerPaid, listAllCustomerDevicePricing } from '../lib/queries';
import {
  CUSTOMER_STATUS_LABEL, PAYMENT_TYPE_LABEL, PAYMENT_TYPE_ICON,
  formatCurrency, formatDate, summarizeDevicesByModel, summarizeDevicesByScent, isOverdue,
} from '../lib/mappers';
import { computeAllCustomerTotals, effectiveCustomerBilling } from '../lib/pricing';

const STATUS_TONE = { active: 'ok', onboarding: 'gold', paused: 'warn', churned: 'crit' };

const EMPTY_VAT_BUCKET = { preVat: 0, vatAmount: 0, total: 0 };

/**
 * deviceTotalsMap (מ-computeAllCustomerTotals, pricing.js) הוא הבסיס
 * לכל סיכום כספי כאן — 2026-09-10, תיקון לבאג שבו לקוחות ריבוי-כתובות
 * (כמו אוורסט) נספרו כ-0 בסיכום הכללי כי amount_due הידני שלהם מעולם
 * לא עודכן, בעוד התמחור האמיתי יושב על המכשירים/הכתובות בכרטיס עצמו.
 * effectiveCustomerBilling נופל אוטומטית ל-amount_due רק ללקוח בלי שום
 * מכשיר מתומחר.
 */
function summarizeCollection(rows, deviceTotalsMap) {
  const totals = rows.reduce(
    (acc, row) => {
      const vat = effectiveCustomerBilling(row, deviceTotalsMap.get(row.id));
      const bucket = row.is_paid ? acc.paidBreakdown : acc.unpaidBreakdown;
      bucket.preVat += vat.preVat;
      bucket.vatAmount += vat.vatAmount;
      bucket.total += vat.total;
      acc.byMethod[row.payment_type] = (acc.byMethod[row.payment_type] ?? 0) + vat.total;
      return acc;
    },
    { paidBreakdown: { ...EMPTY_VAT_BUCKET }, unpaidBreakdown: { ...EMPTY_VAT_BUCKET }, byMethod: {} }
  );

  const revenueBreakdown = {
    preVat: totals.paidBreakdown.preVat + totals.unpaidBreakdown.preVat,
    vatAmount: totals.paidBreakdown.vatAmount + totals.unpaidBreakdown.vatAmount,
    total: totals.paidBreakdown.total + totals.unpaidBreakdown.total,
  };

  return {
    paid: totals.paidBreakdown.total,
    unpaid: totals.unpaidBreakdown.total,
    paidBreakdown: totals.paidBreakdown,
    unpaidBreakdown: totals.unpaidBreakdown,
    revenueBreakdown,
    totalRevenue: revenueBreakdown.total,
    methodBreakdown: Object.entries(totals.byMethod)
      .filter(([, amount]) => amount > 0)
      .sort((a, b) => b[1] - a[1]),
  };
}

function VatBreakdownStrip({ preVat, vatAmount }) {
  return (
    <div className="mt-2.5 flex items-center gap-3 border-t border-black/[0.06] pt-2 text-[13px] text-text-faint">
      <span>🔹 לפני מע״מ: <span className="tabular font-mono text-text-dim">{formatCurrency(preVat)}</span></span>
      <span>🔹 מע״מ (18%): <span className="tabular font-mono text-text-dim">{formatCurrency(vatAmount)}</span></span>
    </div>
  );
}

export default function CustomersScreen() {
  const { isAdmin } = useAuth();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [paymentStatus, setPaymentStatus] = useState('');
  const [paymentType, setPaymentType] = useState('');
  // creating — פאנל "לקוח חדש" מוטבע מעל הרשימה (לא חלון קופץ).
  // openCustomer — כרטיס הלקוח המאוחד תופס את המסך במקום הרשימה.
  const [creating, setCreating] = useState(false);
  const [openCustomer, setOpenCustomer] = useState(null);
  const [openEditing, setOpenEditing] = useState(false);

  const customers = useQuery(
    () => listCustomers({ search, status, paymentStatus, paymentType }),
    [search, status, paymentStatus, paymentType]
  );

  const allCustomers = useQuery(() => listCustomers({}), []);

  // תמחור-מכשירים גורף לכל הלקוחות — ר' ההערה על summarizeCollection
  // למעלה. admin בלבד (unit_price רגיש כספית, ורק admin רואה בכלל את
  // עמודות/סיכומי הכספים במסך הזה).
  const pricing = useQuery(listAllCustomerDevicePricing, [], { enabled: isAdmin });
  const deviceTotalsMap = useMemo(
    () => computeAllCustomerTotals(pricing.data?.devices ?? [], pricing.data?.sitePrices ?? []),
    [pricing.data]
  );

  const collectionTotals = summarizeCollection(allCustomers.data ?? [], deviceTotalsMap);
  const { totalRevenue, methodBreakdown, revenueBreakdown, paidBreakdown, unpaidBreakdown } = collectionTotals;

  const printSummary = summarizeCollection(customers.data ?? [], deviceTotalsMap);

  function refetchAll() {
    customers.refetch();
    allCustomers.refetch();
    pricing.refetch();
  }

  // סנכרון רוחבי: שינוי בכרטיס לקוח (גם ממכשיר/משתמש אחר) מרענן את
  // הרשימה והסיכומים הכספיים חי. customer_site_model_prices נוסף
  // 2026-09-10 — עריכת מחיר-דגם לכתובת חייבת לעדכן את הסיכום הכללי חי.
  useRealtime(['customers', 'devices', 'customer_sites', 'customer_site_model_prices'], refetchAll);

  async function togglePaid(row, event) {
    event.stopPropagation();
    try {
      await setCustomerPaid(row.id, !row.is_paid);
      refetchAll();
    } catch {
      // כשל בטוגל מהיר לא צריך להרעיש
    }
  }

  const baseColumns = [
    {
      key: 'name',
      label: 'לקוח',
      width: 'minmax(0,1.5fr)',
      render: (row) => (
        <div className="min-w-0">
          <div className="truncate font-semibold">{row.name}</div>
          <div className="truncate text-[13px] text-text-faint">{row.address}</div>
        </div>
      ),
    },
    { key: 'contact', label: 'איש קשר', render: (row) => row.contact_name || '—' },
    {
      key: 'phone',
      label: 'טלפון',
      render: (row) => (
      <a
          href={'tel:' + row.phone}
          dir="ltr"
          onClick={(event) => event.stopPropagation()}
          className="tabular font-mono text-[14px] text-text-dim hover:text-gold-600"
        >
          {row.phone || '—'}
        </a>
      ),
    },
    { key: 'city', label: 'עיר', width: '100px', render: (row) => row.city || '—' },
    {
      key: 'devices',
      label: 'מכשירים בשטח',
      width: 'minmax(0,1.1fr)',
      render: (row) => (
        <span className="truncate text-[14px] text-gold-600">{summarizeDevicesByModel(row.devices)}</span>
      ),
    },
    {
      key: 'scents',
      label: 'ניחוחות',
      width: 'minmax(0,1.1fr)',
      render: (row) => (
        <span className="truncate text-[14px] text-teal-500">{summarizeDevicesByScent(row.devices)}</span>
      ),
    },
  ];

  const financialColumns = [
    {
      key: 'payment',
      label: 'תשלום',
      width: '160px',
      render: (row) => {
        const { total, vatAmount } = effectiveCustomerBilling(row, deviceTotalsMap.get(row.id));
        return (
          <div className="min-w-0">
            <div className="truncate text-[14px]">{PAYMENT_TYPE_LABEL[row.payment_type]}</div>
            <div className="tabular font-mono text-[13.5px] text-text-dim">
              {formatCurrency(total)}
              <span className="text-text-faint"> · מע״מ {formatCurrency(vatAmount)}</span>
            </div>
          </div>
        );
      },
    },
    {
      key: 'collection',
      label: 'גבייה',
      width: '110px',
      render: (row) => (
        <button
          type="button"
          onClick={(event) => togglePaid(row, event)}
          title="לחץ כדי להחליף סטטוס"
          className={'chip transition-colors ' + (
            row.is_paid
              ? 'border-ok/25 bg-ok/10 text-ok hover:border-ok/45'
              : 'border-crit/30 bg-crit/10 text-crit-soft hover:border-crit/50'
          )}
        >
          {row.is_paid ? 'שולם' : 'ממתין לגבייה'}
        </button>
      ),
    },
    {
      key: 'due',
      label: 'תאריך פירעון',
      width: '112px',
      render: (row) => (row.payment_due_date
        ? (
          <span className={'tabular font-mono text-[13.5px] ' + (
            isOverdue(row.payment_due_date, row.is_paid) ? 'font-semibold text-crit-soft' : 'text-text-dim'
          )}>
            {formatDate(row.payment_due_date)}
            {isOverdue(row.payment_due_date, row.is_paid) && ' · באיחור'}
          </span>
        )
        : <span className="text-text-faint">—</span>),
    },
  ];

  const statusColumn = {
    key: 'status',
    label: 'סטטוס',
    width: '96px',
    render: (row) => (
      <StatusChip tone={STATUS_TONE[row.status]}>{CUSTOMER_STATUS_LABEL[row.status]}</StatusChip>
    ),
  };

  const columns = isAdmin
    ? [...baseColumns, ...financialColumns, statusColumn]
    : [...baseColumns, statusColumn];

  // כרטיס לקוח = מסך שלם, לא חלון קופץ: תופס את מקום הרשימה עם "חזרה".
  if (openCustomer) {
    return (
      <CustomerProfile
        key={openCustomer.id}
        customer={openCustomer}
        startEditing={openEditing}
        onBack={() => setOpenCustomer(null)}
        onChanged={refetchAll}
        onDeleted={() => { setOpenCustomer(null); refetchAll(); }}
      />
    );
  }

  return (
    <>
    <div className="print:hidden">
      {isAdmin && (
        <div className="mb-3.5 grid grid-cols-1 gap-3.5 sm:grid-cols-3">
          <GlassCard className="!py-[18px]">
            <div className="text-[14px] font-medium text-text-dim">סך הכל הכנסות הקו</div>
            <div className="tabular mt-1.5 font-display text-[28px] font-bold leading-tight text-gold-600">
              💰 {formatCurrency(revenueBreakdown.total)}
            </div>
            <VatBreakdownStrip preVat={revenueBreakdown.preVat} vatAmount={revenueBreakdown.vatAmount} />
          </GlassCard>

          <GlassCard className="!py-[18px]">
            <div className="flex items-center gap-3">
              <div className="grid h-[38px] w-[38px] flex-none place-items-center rounded-xl border border-ok/25 bg-ok/10 text-[18px]">
                🟢
              </div>
              <div className="min-w-0">
                <div className="text-[14px] font-medium text-text-dim">שולם בפועל</div>
                <div className="tabular font-display text-[22px] font-bold leading-tight text-ok">
                  {formatCurrency(paidBreakdown.total)}
                </div>
              </div>
            </div>
            <VatBreakdownStrip preVat={paidBreakdown.preVat} vatAmount={paidBreakdown.vatAmount} />
          </GlassCard>

          <GlassCard className="!py-[18px]">
            <div className="flex items-center gap-3">
              <div className="grid h-[38px] w-[38px] flex-none place-items-center rounded-xl border border-crit/25 bg-crit/10 text-[18px]">
                🔴
              </div>
              <div className="min-w-0">
                <div className="text-[14px] font-medium text-text-dim">ממתין לגבייה / חובות פתוחים</div>
                <div className="tabular font-display text-[22px] font-bold leading-tight text-crit-soft">
                  {formatCurrency(unpaidBreakdown.total)}
                </div>
              </div>
            </div>
            <VatBreakdownStrip preVat={unpaidBreakdown.preVat} vatAmount={unpaidBreakdown.vatAmount} />
          </GlassCard>
        </div>
      )}

      {isAdmin && methodBreakdown.length > 0 && (
        <GlassCard className="mb-3.5 !py-[18px]">
          <div className="mb-3 text-[14px] font-medium text-text-dim">פילוח לפי אמצעי תשלום</div>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
            {methodBreakdown.map(([type, amount]) => (
              <div key={type} className="rounded-row border border-black/[0.07] bg-black/[0.02] px-3 py-2.5">
                <div className="flex items-center gap-1.5 text-[13.5px] text-text-faint">
                  <span>{PAYMENT_TYPE_ICON[type] ?? '💰'}</span>
                  <span className="truncate">{PAYMENT_TYPE_LABEL[type] ?? type}</span>
                </div>
                <div className="tabular mt-1 font-mono text-[15px] font-semibold">{formatCurrency(amount)}</div>
                <div className="tabular text-[13px] text-text-faint">
                  {totalRevenue > 0 ? Math.round((amount / totalRevenue) * 100) : 0}% מהקופה
                </div>
              </div>
            ))}
          </div>
        </GlassCard>
      )}

      {isAdmin && (
        <div className="mb-3.5 flex flex-wrap gap-2">
          {[
            { key: '', label: 'הצג הכל' },
            { key: 'paid', label: 'רק שולם (🟢)' },
            { key: 'unpaid', label: 'רק ממתין לגבייה (🔴)' },
          ].map((opt) => (
            <button
              key={opt.key || 'all'}
              type="button"
              onClick={() => setPaymentStatus(opt.key)}
              className={'rounded-pill border px-3.5 py-2 text-[14px] font-medium transition-colors ' + (
                paymentStatus === opt.key
                  ? 'border-gold-500/45 bg-gold-500/[0.14] text-gold-600'
                  : 'border-black/[0.09] text-text-dim hover:border-black/[0.2]'
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}

      <ScreenToolbar
        search={search}
        onSearch={setSearch}
        searchPlaceholder="חיפוש לפי שם לקוח, איש קשר או עיר…"
        count={customers.data?.length}
        countLabel="לקוחות"
        actionLabel="לקוח חדש"
        onAction={() => setCreating((v) => !v)}
        extra={isAdmin ? (
          <button
            type="button"
            onClick={() => window.print()}
            className="ghost-btn flex items-center gap-1.5"
            title="מייצא PDF של הרשימה המוצגת כרגע, כולל תקציר נתונים"
          >
            <PrinterIcon className="h-4 w-4" />
            ייצוא ל-PDF
          </button>
        ) : undefined}
        filters={[
          {
            key: 'status',
            value: status,
            onChange: setStatus,
            placeholder: 'כל הסטטוסים',
            options: Object.entries(CUSTOMER_STATUS_LABEL).map(([value, label]) => ({ value, label })),
          },
          ...(isAdmin ? [{
            key: 'paymentType',
            value: paymentType,
            onChange: setPaymentType,
            placeholder: 'כל סוגי התשלום',
            options: Object.entries(PAYMENT_TYPE_LABEL).map(([value, label]) => ({ value, label })),
          }] : []),
        ]}
      />

      {creating && (
        <GlassCard className="mb-5 border-gold-300/[0.35]">
          <CardHead
            icon={UsersIcon}
            title="לקוח חדש"
            subtitle="הלקוח ייווצר מיד ויופיע ברשימה — ואז ייפתח כרטיס הלקוח שלו להוספת כתובות ומכשירים"
          />
          <CustomerDetailsForm
            isAdmin={isAdmin}
            onSaved={(saved) => {
              setCreating(false);
              refetchAll();
              if (saved?.id) { setOpenEditing(false); setOpenCustomer(saved); }
            }}
            onCancel={() => setCreating(false)}
          />
        </GlassCard>
      )}

      <GlassCard>
        <Async
          loading={customers.loading}
          error={customers.error}
          onRetry={customers.refetch}
          isEmpty={customers.data?.length === 0}
          empty={
            <EmptyState
              title={search || status || paymentStatus || paymentType ? 'אין לקוח שתואם את החיפוש' : 'עוד לא הוזנו לקוחות'}
              hint={search || status || paymentStatus || paymentType
                ? 'נסה מונח אחר או נקה את המסננים.'
                : 'התחל בהוספת הלקוח הראשון — אחר כך אפשר לשייך לו מכשירים.'}
            />
          }
        >
          <DataTable
            columns={columns}
            rows={customers.data ?? []}
            rowKey={(row) => row.id}
            onRowClick={(row) => { setOpenEditing(false); setOpenCustomer(row); }}
            actions={(row) => (
              <button
                type="button"
                onClick={(event) => { event.stopPropagation(); setOpenEditing(true); setOpenCustomer(row); }}
                className="ghost-btn !px-3.5 !py-2 text-[15px]"
              >
                עריכה
              </button>
            )}
          />
        </Async>
      </GlassCard>

    </div>

      {isAdmin && <CustomersPrintReport rows={customers.data ?? []} summary={printSummary} deviceTotalsMap={deviceTotalsMap} />}
    </>
  );
}

function CustomersPrintReport({ rows, summary, deviceTotalsMap }) {
  const generatedAt = new Date().toLocaleString('he-IL', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });

  return (
    <div className="hidden print:block" style={{ color: '#111', background: '#fff' }} dir="rtl">
      <div style={{ marginBottom: 18, borderBottom: '2px solid #222', paddingBottom: 10 }}>
        <div style={{ fontSize: 22, fontWeight: 700 }}>סיכום נתוני קו — ICON AIR</div>
        <div style={{ fontSize: 12, color: '#555', marginTop: 4 }}>הופק בתאריך: {generatedAt}</div>
      </div>

      <div style={{ display: 'flex', gap: 14, marginBottom: 16 }}>
        <SummaryBox label="סך הכל הכנסות" value={formatCurrency(summary.totalRevenue)} />
        <SummaryBox label="שולם" value={formatCurrency(summary.paid)} accent="#0a7a3d" />
        <SummaryBox label="ממתין לגבייה" value={formatCurrency(summary.unpaid)} accent="#b3261e" />
      </div>

      {summary.methodBreakdown.length > 0 && (
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>פילוח לפי אמצעי תשלום</div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {summary.methodBreakdown.map(([type, amount]) => (
              <div key={type} style={{ border: '1px solid #ccc', borderRadius: 6, padding: '6px 10px', fontSize: 11.5 }}>
                {PAYMENT_TYPE_ICON[type] ?? ''} {PAYMENT_TYPE_LABEL[type] ?? type}: {formatCurrency(amount)}
                {' '}({summary.totalRevenue > 0 ? Math.round((amount / summary.totalRevenue) * 100) : 0}%)
              </div>
            ))}
          </div>
        </div>
      )}

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
        <thead>
          <tr style={{ background: '#f0f0f0', textAlign: 'start' }}>
            {['שם לקוח', 'כתובת', 'מכשירים בשטח', 'סוג תשלום', 'סה״כ (כולל מע״מ)', 'סטטוס גבייה'].map((h) => (
              <th key={h} style={{ border: '1px solid #ccc', padding: '5px 7px' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const { total } = effectiveCustomerBilling(row, deviceTotalsMap.get(row.id));
            return (
              <tr key={row.id}>
                <td style={{ border: '1px solid #ccc', padding: '5px 7px', fontWeight: 600 }}>{row.name}</td>
                <td style={{ border: '1px solid #ccc', padding: '5px 7px' }}>{row.address || '—'}</td>
                <td style={{ border: '1px solid #ccc', padding: '5px 7px' }}>{summarizeDevicesByModel(row.devices)}</td>
                <td style={{ border: '1px solid #ccc', padding: '5px 7px' }}>{PAYMENT_TYPE_LABEL[row.payment_type]}</td>
                <td style={{ border: '1px solid #ccc', padding: '5px 7px', fontWeight: 600 }}>{formatCurrency(total)}</td>
                <td style={{
                  border: '1px solid #ccc', padding: '5px 7px', fontWeight: 700,
                  color: row.is_paid ? '#0a7a3d' : '#b3261e',
                }}>
                  {row.is_paid ? '🟢 שולם' : '🔴 ממתין לגבייה'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SummaryBox({ label, value, accent = '#222' }) {
  return (
    <div style={{ flex: 1, border: '1px solid #ccc', borderRadius: 6, padding: '10px 14px' }}>
      <div style={{ fontSize: 11, color: '#666' }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: accent, marginTop: 2 }}>{value}</div>
    </div>
  );
}
