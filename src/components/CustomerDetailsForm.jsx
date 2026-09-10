import { useState } from 'react';
import { Field, TextInput, TextArea, Select, PrimaryButton, SecondaryButton } from './ui/Field';
import { createCustomer, updateCustomer } from '../lib/queries';
import { describeError } from '../lib/supabase';
import {
  CUSTOMER_STATUS_LABEL, PAYMENT_TYPE_LABEL, VAT_MODE_LABEL, computeVat, formatCurrency,
} from '../lib/mappers';

const EMPTY_FORM = {
  name: '', contact_name: '', phone: '', email: '',
  city: '', address: '', route_name: '', status: 'active', notes: '',
  payment_type: 'deferred', amount_due: '0', is_paid: false, vat_mode: 'included', payment_due_date: '',
};

function fromCustomer(customer) {
  if (!customer) return EMPTY_FORM;
  return {
    name: customer.name ?? '',
    contact_name: customer.contact_name ?? '',
    phone: customer.phone ?? '',
    email: customer.email ?? '',
    city: customer.city ?? '',
    address: customer.address ?? '',
    route_name: customer.route_name ?? '',
    status: customer.status ?? 'active',
    notes: customer.notes ?? '',
    payment_type: customer.payment_type ?? 'deferred',
    amount_due: String(customer.amount_due ?? 0),
    is_paid: Boolean(customer.is_paid),
    vat_mode: customer.vat_mode ?? 'included',
    payment_due_date: customer.payment_due_date ?? '',
  };
}

/**
 * שדות הלקוח — פרטי קשר, כתובת ראשית, קו, סטטוס, והחיוב הכללי של
 * הלקוח (למנהלים). טופס אחד שמשמש גם ליצירה ("לקוח חדש") וגם לעריכה
 * מוטבעת בתוך כרטיס הלקוח המאוחד — אותם שדות, אותה ולידציה, מקור
 * אמת אחד. customer === null → יצירה; אחרת עדכון של אותו לקוח.
 *
 * הערה על החיוב (עודכן 2026-09-10): amount_due הוא הסכום *הכללי* הידני
 * של לקוח בלי שום מכשיר מתומחר. ללקוח עם תמחור מכשירים/כתובות (הרוב
 * המכריע כיום, כולל ריבוי-כתובות כמו אוורסט) computedBilling — שמגיע
 * מ-CustomerProfile.jsx, אותו חישוב בדיוק כמו רצועת הסיכום למעלה
 * בכרטיס — הוא הסכום הקובע, והשדה הופך לתצוגה בלבד. ר' pricing.js
 * effectiveCustomerBilling לאותה לוגיקה, ו-CustomersScreen.jsx לאותו
 * עיקרון ברשימת הלקוחות/הדוחות.
 */
export default function CustomerDetailsForm({ customer = null, isAdmin, computedBilling, onSaved, onCancel, submitLabel }) {
  const [form, setForm] = useState(() => fromCustomer(customer));
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const set = (key) => (event) => setForm((prev) => ({ ...prev, [key]: event.target.value }));
  const vat = computeVat(form.amount_due, form.vat_mode);
  const displayVat = computedBilling?.hasDeviceBilling ? computedBilling : vat;
  const isEdit = Boolean(customer?.id);

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
      const saved = isEdit ? await updateCustomer(customer.id, payload) : await createCustomer(payload);
      onSaved?.(saved);
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
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
        <Field label="אימייל">
          <TextInput dir="ltr" className="text-start" type="email" value={form.email} onChange={set('email')} />
        </Field>
        <Field label="עיר">
          <TextInput value={form.city} onChange={set('city')} />
        </Field>
        <Field label="כתובת ראשית">
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
        <div className="rounded-row border border-black/[0.07] bg-black/[0.02] p-3.5">
          <div className="mb-3 text-[12.5px] font-semibold text-text-dim">חיוב וגבייה כלליים</div>
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
            {computedBilling?.hasDeviceBilling ? (
              <Field label="חיוב כללי" hint="מחושב אוטומטית מהמכשירים/הכתובות — לא ניתן לעריכה ידנית כאן">
                <div className="flex h-[42px] items-center rounded-[10px] border border-black/[0.09] bg-ink-800 px-3.5 text-[15px] font-semibold text-text-dim">
                  {formatCurrency(computedBilling.total)} <span className="ms-1.5 text-[13px] font-normal text-text-faint">כולל מע״מ</span>
                </div>
              </Field>
            ) : (
              <>
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
              </>
            )}
            <Field label="תאריך פירעון" hint="מתי אמור להיכנס התשלום">
              <TextInput type="date" value={form.payment_due_date} onChange={set('payment_due_date')} />
            </Field>
          </div>

          {computedBilling?.hasDeviceBilling && (
            <div className="mt-2 text-[13px] text-teal-500">
              ללקוח הזה יש תמחור מכשירים/כתובות בכרטיס — הסכום כאן עוקב אחריו אוטומטית.
              לשינוי הסכום, ערכו את מחירי המכשירים/הדגמים בכתובות למטה.
            </div>
          )}

          <div className="mt-3.5 grid grid-cols-3 gap-2.5 rounded-row border border-black/[0.06] bg-ink-800 px-3.5 py-3 text-center">
            <div>
              <div className="text-[10.5px] text-text-faint">לפני מע״מ</div>
              <div className="tabular mt-0.5 font-mono text-[13px] font-semibold">{formatCurrency(displayVat.preVat)}</div>
            </div>
            <div>
              <div className="text-[10.5px] text-text-faint">מע״מ (18%)</div>
              <div className="tabular mt-0.5 font-mono text-[13px] font-semibold text-text-dim">{formatCurrency(displayVat.vatAmount)}</div>
            </div>
            <div>
              <div className="text-[10.5px] text-text-faint">סה״כ לתשלום</div>
              <div className="tabular mt-0.5 font-mono text-[13px] font-semibold text-gold-600">{formatCurrency(displayVat.total)}</div>
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
        <PrimaryButton type="submit" loading={busy}>
          {submitLabel ?? (isEdit ? 'שמור שינויים' : 'שמור לקוח')}
        </PrimaryButton>
        {onCancel && <SecondaryButton onClick={onCancel}>ביטול</SecondaryButton>}
      </div>
    </form>
  );
}
