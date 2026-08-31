import { useState } from 'react';
import GlassCard from '../components/ui/GlassCard';
import DataTable, { StatusChip } from '../components/ui/DataTable';
import ScreenToolbar from '../components/ui/ScreenToolbar';
import Modal from '../components/ui/Modal';
import CustomerDevicesModal from '../components/CustomerDevicesModal';
import { Field, TextInput, TextArea, Select, PrimaryButton, SecondaryButton } from '../components/ui/Field';
import { Async, EmptyState } from '../components/ui/States';
import { PrinterIcon } from '../components/ui/Icons';
import { useAuth } from '../context/AuthContext';
import { useQuery } from '../hooks/useQuery';
import { listCustomers, createCustomer, updateCustomer, setCustomerPaid } from '../lib/queries';
import { describeError } from '../lib/supabase';
import {
  CUSTOMER_STATUS_LABEL, PAYMENT_TYPE_LABEL, PAYMENT_TYPE_ICON, VAT_MODE_LABEL,
  formatCurrency, formatDate, summarizeDevicesByModel, computeVat, isOverdue,
} from '../lib/mappers';

const STATUS_TONE = { active: 'ok', onboarding: 'gold', paused: 'warn', churned: 'crit' };

const EMPTY_VAT_BUCKET = { preVat: 0, vatAmount: 0, total: 0 };

function summarizeCollection(rows) {
  const totals = rows.reduce(
    (acc, row) => {
      const vat = computeVat(row.amount_due, row.vat_mode);
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

const EMPTY_FORM = {
  name: '', contact_name: '', phone: '', email: '',
  city: '', address: '', route_name: '', status: 'active', notes: '',
  payment_type: 'deferred', amount_due: '0', is_paid: false, vat_mode: 'included', payment_due_date: '',
};

function VatBreakdownStrip({ preVat, vatAmount }) {
  return (
    <div className="mt-2.5 flex items-center gap-3 border-t border-white/[0.06] pt-2 text-[11px] text-text-faint">
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
  const [formOpen, setFormOpen] = useState(false);
  const [editCustomer, setEditCustomer] = useState(null);
  const [openCustomer, setOpenCustomer] = useState(null);

  const customers = useQuery(
    () => listCustomers({ search, status, paymentStatus, paymentType }),
    [search, status, paymentStatus, paymentType]
  );

  const allCustomers = useQuery(() => listCustomers({}), []);

  const collectionTotals = summarizeCollection(allCustomers.data ?? []);
  const { totalRevenue, methodBreakdown, revenueBreakdown, paidBreakdown, unpaidBreakdown } = collectionTotals;

  const printSummary = summarizeCollection(customers.data ?? []);

  function refetchAll() {
    customers.refetch();
    allCustomers.refetch();
  }

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
          <div className="truncate text-[11.5px] text-text-faint">{row.address}</div>
        </div>
      ),
    },
    { key: 'contact', label: 'איש קשר', render: (row) => row.contact_name || '—' },
    {
      key: 'phone',
      label: 'טלפון',
      render: (row) => (
      <a>
          href={'tel:' + row.phone}
          dir="ltr"
          onClick={(event) => event.stopPropagation()}
          className="tabular font-mono text-[12.5px] text-text-dim hover:text-gold-300"
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
        <span className="truncate text-[12.5px] text-gold-300">{summarizeDevicesByModel(row.devices)}</span>
      ),
    },
  ];

  const financialColumns = [
    {
      key: 'payment',
      label: 'תשלום',
      width: '160px',
      render: (row) => {
        const { total, vatAmount } = computeVat(row.amount_due, row.vat_mode);
        return (
          <div className="min-w-0">
            <div className="truncate text-[12.5px]">{PAYMENT_TYPE_LABEL[row.payment_type]}</div>
            <div className="tabular font-mono text-[12px] text-text-dim">
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
          <span className={'tabular font-mono text-[12px] ' + (
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

  return (
    <>
    <div className="print:hidden">
      {isAdmin && (
        <div className="mb-3.5 grid grid-cols-1 gap-3.5 sm:grid-cols-3">
          <GlassCard className="!py-[18px]">
            <div className="text-[13px] font-medium text-text-dim">סך הכל הכנסות הקו</div>
            <div className="tabular mt-1.5 font-display text-[28px] font-bold leading-tight text-gold-300">
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
                <div className="text-[13px] font-medium text-text-dim">שולם בפועל</div>
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
                <div className="text-[13px] font-medium text-text-dim">ממתין לגבייה / חובות פתוחים</div>
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
          <div className="mb-3 text-[13px] font-medium text-text-dim">פילוח לפי אמצעי תשלום</div>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
            {methodBreakdown.map(([type, amount]) => (
              <div key={type} className="rounded-row border border-white/[0.07] bg-white/[0.02] px-3 py-2.5">
                <div className="flex items-center gap-1.5 text-[12px] text-text-faint">
                  <span>{PAYMENT_TYPE_ICON[type] ?? '💰'}</span>
                  <span className="truncate">{PAYMENT_TYPE_LABEL[type] ?? type}</span>
                </div>
                <div className="tabular mt-1 font-mono text-[14px] font-semibold">{formatCurrency(amount)}</div>
                <div className="tabular text-[11px] text-text-faint">
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
              className={'rounded-pill border px-3.5 py-2 text-[13px] font-medium transition-colors ' + (
                paymentStatus === opt.key
                  ? 'border-gold-500/45 bg-gold-500/[0.14] text-gold-300'
                  : 'border-white/[0.09] text-text-dim hover:border-white/20'
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
        onAction={() => { setEditCustomer(null); setFormOpen(true); }}
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
            onRowClick={setOpenCustomer}
            actions={(row) => (
              <button
                type="button"
                onClick={(event) => { event.stopPropagation(); setEditCustomer(row); setFormOpen(true); }}
                className="ghost-btn !px-2.5 !py-1.5 text-[12px]"
              >
                עריכה
              </button>
            )}
          />
        </Async>
      </GlassCard>

      <CustomerFormModal
        key={formOpen ? (editCustomer?.id ?? 'new') : 'closed'}
        open={formOpen}
        editCustomer={editCustomer}
        isAdmin={isAdmin}
        onClose={() => setFormOpen(false)}
        onSaved={() => {
          setFormOpen(false);
          refetchAll();
        }}
      />

      <CustomerDevicesModal
        customer={openCustomer}
        onClose={() => setOpenCustomer(null)}
        onDevicesChanged={refetchAll}
      />
    </div>

      {isAdmin && <CustomersPrintReport rows={customers.data ?? []} summary={printSummary} />}
    </>
  );
}

function CustomersPrintReport({ rows, summary }) {
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
            const { total } = computeVat(row.amount_due, row.vat_mode);
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

function CustomerFormModal({ open, editCustomer, isAdmin, onClose, onSaved }) {
  const [form, setForm] = useState(() => editCustomer
    ? {
        name: editCustomer.name ?? '',
        contact_name: editCustomer.contact_name ?? '',
        phone: editCustomer.phone ?? '',
        email: editCustomer.email ?? '',
        city: editCustomer.city ?? '',
        address: editCustomer.address ?? '',
        route_name: editCustomer.route_name ?? '',
        status: editCustomer.status ?? 'active',
        notes: editCustomer.notes ?? '',
        payment_type: editCustomer.payment_type ?? 'deferred',
        amount_due: String(editCustomer.amount_due ?? 0),
        is_paid: Boolean(editCustomer.is_paid),
        vat_mode: editCustomer.vat_mode ?? 'included',
        payment_due_date: editCustomer.payment_due_date ?? '',
      }
    : EMPTY_FORM);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const set = (key) => (event) => setForm((prev) => ({ ...prev, [key]: event.target.value }));
  const vat = computeVat(form.amount_due, form.vat_mode);

  async function submit(event) {
    event.preventDefault();
    setError(null);
    setBusy(true);

    const payload = {
      ...form,
      route_name: form.route_name || null,
      email: form.email || null,
      amount_due: Number(form.amount_due || 0),
      is_paid: form.is_paid === true || form.is_paid === 'true',
      payment_due_date: form.payment_due_date || null,
    };

    try {
      if (editCustomer) {
        await updateCustomer(editCustomer.id, payload);
      } else {
        await createCustomer(payload);
      }
      onSaved();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      title={editCustomer ? ('עריכת ' + editCustomer.name) : 'לקוח חדש'}
      subtitle={editCustomer ? 'השינויים נשמרים מיד' : 'הלקוח ייווצר מיד ויופיע ברשימה'}
      onClose={onClose}
    >
      <form onSubmit={submit} className="flex flex-col gap-3.5">
        <Field label="שם הלקוח" required>
          <TextInput value={form.name} onChange={set('name')} placeholder="מלון דן · תל אביב" required />
        </Field>

        <div className="grid grid-cols-1 gap-3.5 xs:grid-cols-2">
          <Field label="איש קשר">
            <TextInput value={form.contact_name} onChange={set('contact_name')} />
          </Field>
          <Field label="טלפון">
            <TextInput dir="ltr" className="text-start" value={form.phone} onChange={set('phone')} placeholder="03-5202525" />
          </Field>
          <Field label="עיר">
            <TextInput value={form.city} onChange={set('city')} />
          </Field>
          <Field label="כתובת">
            <TextInput value={form.address} onChange={set('address')} />
          </Field>
          <Field label="קו הפצה">
            <TextInput value={form.route_name} onChange={set('route_name')} placeholder="קו מרכז, קו צפון…" />
          </Field>
          <Field label="סטטוס">
            <Select
              value={form.status}
              onChange={set('status')}
              options={Object.entries(CUSTOMER_STATUS_LABEL).map(([value, label]) => ({ value, label }))}
            />
          </Field>
        </div>

        {isAdmin && (
          <div className="rounded-row border border-white/[0.07] bg-white/[0.02] p-3.5">
            <div className="mb-3 text-[12.5px] font-semibold text-text-dim">חיוב וגבייה</div>
            <div className="grid grid-cols-1 gap-3.5 xs:grid-cols-2">
              <Field label="סוג תשלום">
                <Select
                  value={form.payment_type}
                  onChange={set('payment_type')}
                  options={Object.entries(PAYMENT_TYPE_LABEL).map(([value, label]) => ({ value, label }))}
                />
              </Field>
              <Field label="סטטוס גבייה">
                <Select
                  value={String(form.is_paid)}
                  onChange={(event) => setForm((prev) => ({ ...prev, is_paid: event.target.value === 'true' }))}
                  options={[
                    { value: 'false', label: 'ממתין לגבייה' },
                    { value: 'true', label: 'שולם' },
                  ]}
                />
              </Field>
              <Field label="אופן חישוב מע״מ" hint="קובע איך הסכום שתזין מתפרש">
                <Select
                  value={form.vat_mode}
                  onChange={set('vat_mode')}
                  options={Object.entries(VAT_MODE_LABEL).map(([value, label]) => ({ value, label }))}
                />
              </Field>
              <Field label={form.vat_mode === 'excluded' ? 'מחיר בסיס (לפני מע״מ)' : 'סה״כ לתשלום (כולל מע״מ)'}>
                <TextInput type="number" min={0} step="0.01" value={form.amount_due} onChange={set('amount_due')} />
              </Field>
              <Field label="תאריך פירעון" hint="מתי אמור להיכנס התשלום">
                <TextInput type="date" value={form.payment_due_date} onChange={set('payment_due_date')} />
              </Field>
            </div>

            <div className="mt-3.5 grid grid-cols-3 gap-2.5 rounded-row border border-white/[0.06] bg-black/20 px-3.5 py-3 text-center">
              <div>
                <div className="text-[10.5px] text-text-faint">לפני מע״מ</div>
                <div className="tabular mt-0.5 font-mono text-[13px] font-semibold">{formatCurrency(vat.preVat)}</div>
              </div>
              <div>
                <div className="text-[10.5px] text-text-faint">מע״מ (18%)</div>
                <div className="tabular mt-0.5 font-mono text-[13px] font-semibold text-text-dim">{formatCurrency(vat.vatAmount)}</div>
              </div>
              <div>
                <div className="text-[10.5px] text-text-faint">סה״כ לתשלום</div>
                <div className="tabular mt-0.5 font-mono text-[13px] font-semibold text-gold-300">{formatCurrency(vat.total)}</div>
              </div>
            </div>
          </div>
        )}

        <Field label="הערות">
          <TextArea value={form.notes} onChange={set('notes')} rows={2} />
        </Field>

        {error && (
          <div className="rounded-row border border-crit/25 bg-crit/[0.07] px-3.5 py-2.5 text-[12.5px] text-crit-soft">
            {error}
          </div>
        )}

        <div className="mt-1 flex gap-2.5">
          <PrimaryButton type="submit" loading={busy}>{editCustomer ? 'שמור שינויים' : 'שמור לקוח'}</PrimaryButton>
          <SecondaryButton onClick={onClose}>ביטול</SecondaryButton>
        </div>
      </form>
    </Modal>
  );
}
