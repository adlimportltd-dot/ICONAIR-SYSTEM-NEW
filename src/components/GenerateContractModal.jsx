import { useEffect, useMemo, useState } from 'react';
import Modal from './ui/Modal';
import ContractDocument from './ContractDocument';
import { Field, TextInput, PrimaryButton, SecondaryButton } from './ui/Field';
import { createGeneratedContract } from '../lib/queries';
import { describeError } from '../lib/supabase';
import { renderContractHtml, todayHebrew } from '../lib/contractTemplate';
import { whatsappLink } from '../lib/navLinks';

/** דגם+כמות מתוך המכשירים המותקנים בפועל — נקודת פתיחה, לא נעולה; המנהל יכול לתקן כמות/מחיר לפני ההפקה */
function seedItemsFromDevices(devices) {
  const counts = new Map();
  for (const d of devices) {
    if (d.status === 'uninstalled') continue;
    counts.set(d.model, (counts.get(d.model) ?? 0) + 1);
  }
  return [...counts.entries()].map(([model, quantity]) => ({ model, quantity, monthlyPrice: '' }));
}

/**
 * הפקת חוזה דיגיטלי מהתבנית הסטנדרטית: פרטי הלקוח כבר ידועים,
 * המנהל רק קובע מחיר חודשי לכל דגם ומאשר. לאחר ההפקה מוצג קישור
 * חתימה אישי (הלקוח לא צריך חשבון) — עם כפתור שליחה בוואטסאפ, כי
 * זה ערוץ התקשורת שהעסק כבר משתמש בו מול הלקוחות.
 */
export default function GenerateContractModal({ open, customer, devices = [], onClose, onCreated }) {
  const seeded = useMemo(() => seedItemsFromDevices(devices), [devices]);

  const [idNumber, setIdNumber] = useState('');
  const [items, setItems] = useState(seeded);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (!open) return;
    setIdNumber('');
    setItems(seeded);
    setError(null);
    setResult(null);
  }, [open, seeded]);

  const contractDate = todayHebrew();

  function updatePrice(index, value) {
    setItems((prev) => prev.map((row, i) => (i === index ? { ...row, monthlyPrice: value } : row)));
  }

  function updateQuantity(index, value) {
    setItems((prev) => prev.map((row, i) => (i === index ? { ...row, quantity: value } : row)));
  }

  function addBlankRow() {
    setItems((prev) => [...prev, { model: '', quantity: 1, monthlyPrice: '' }]);
  }

  function updateModel(index, value) {
    setItems((prev) => prev.map((row, i) => (i === index ? { ...row, model: value } : row)));
  }

  function removeRow(index) {
    setItems((prev) => prev.filter((_, i) => i !== index));
  }

  const numericItems = items.map((row) => ({
    model: row.model,
    quantity: Number(row.quantity) || 0,
    monthlyPrice: Number(row.monthlyPrice) || 0,
  }));

  async function submit(event) {
    event.preventDefault();
    setError(null);

    if (numericItems.every((row) => !row.quantity)) {
      setError('הוסף לפחות מערכת אחת עם כמות גדולה מ-0');
      return;
    }

    setBusy(true);
    try {
      const html = renderContractHtml({
        customer,
        idNumber,
        items: numericItems,
        contractDate,
        generatedAt: new Date().toLocaleString('he-IL'),
      });

      const contract = await createGeneratedContract({
        customerId: customer.id,
        title: `הסכם התקשרות — ${contractDate}`,
        html,
      });

      const link = `${window.location.origin}${window.location.pathname}?sign=${contract.sign_token}`;
      const message = `שלום ${customer.name}, מצורף חוזה ההתקשרות מול ICON AIR לחתימה דיגיטלית:\n${link}`;

      setResult({ link, whatsappHref: whatsappLink(customer.phone, message) });
      onCreated?.();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(result.link);
    } catch {
      // אין clipboard API (הקשר לא מאובטח וכו') — הקישור עדיין מוצג על המסך לבחירה ידנית
    }
  }

  if (result) {
    return (
      <Modal open={open} title="החוזה נשלח לחתימה" subtitle={customer?.name} onClose={onClose}>
        <div className="flex flex-col gap-3.5">
          <div className="rounded-row border border-ok/25 bg-ok/[0.07] px-3.5 py-3 text-[13px] text-ok">
            הקישור נוצר בהצלחה. שלח אותו ללקוח — הוא לא צריך חשבון או התחברות כדי לצפות ולחתום.
          </div>

          <div dir="ltr" className="break-all rounded-row border border-white/[0.09] bg-black/30 px-3.5 py-2.5 font-mono text-[12px] text-text-dim">
            {result.link}
          </div>

          <div className="flex flex-wrap gap-2.5">
            {result.whatsappHref && (
              <PrimaryButton onClick={() => window.open(result.whatsappHref, '_blank', 'noopener')}>
                שלח בוואטסאפ
              </PrimaryButton>
            )}
            <SecondaryButton onClick={copyLink}>העתק קישור</SecondaryButton>
            <SecondaryButton onClick={onClose}>סגירה</SecondaryButton>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal open={open} title="הפקת חוזה דיגיטלי" subtitle={customer?.name} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-3.5">
        <Field label="ת.ז. / ח.פ. הלקוח" hint="יופיע בגוף החוזה">
          <TextInput value={idNumber} onChange={(e) => setIdNumber(e.target.value)} />
        </Field>

        <div className="rounded-row border border-white/[0.07] bg-white/[0.02] p-3.5">
          <div className="mb-2.5 flex items-center gap-2">
            <div className="text-[12.5px] font-semibold text-text-dim">מערכות ותשלום חודשי (נספח א׳)</div>
            <button type="button" onClick={addBlankRow} className="ghost-btn ms-auto !px-2.5 !py-1.5 text-[12px]">
              + שורה
            </button>
          </div>

          <div className="flex flex-col gap-2">
            {items.map((row, i) => (
              <div key={i} className="grid grid-cols-[1.4fr_0.7fr_1fr_auto] items-center gap-2">
                <TextInput
                  placeholder="דגם (Icon 500)"
                  value={row.model}
                  onChange={(e) => updateModel(i, e.target.value)}
                  className="!py-2 text-[12.5px]"
                />
                <TextInput
                  type="number" min={0} step={1}
                  value={row.quantity}
                  onChange={(e) => updateQuantity(i, e.target.value)}
                  className="!py-2 text-[12.5px]"
                />
                <TextInput
                  type="number" min={0} step={1}
                  placeholder="מחיר חודשי ליחידה"
                  value={row.monthlyPrice}
                  onChange={(e) => updatePrice(i, e.target.value)}
                  className="!py-2 text-[12.5px]"
                />
                <button
                  type="button"
                  onClick={() => removeRow(i)}
                  aria-label="הסר שורה"
                  className="grid h-8 w-8 place-items-center rounded-full text-text-faint hover:text-crit-soft"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="mb-1.5 text-[12.5px] font-medium text-text-dim">תצוגה מקדימה</div>
          <div className="max-h-[420px] overflow-y-auto rounded-row border border-white/[0.09]">
            <ContractDocument customer={customer} idNumber={idNumber} items={numericItems} contractDate={contractDate} />
          </div>
        </div>

        {error && (
          <div className="rounded-row border border-crit/25 bg-crit/[0.07] px-3.5 py-2.5 text-[12.5px] text-crit-soft">
            {error}
          </div>
        )}

        <div className="mt-1 flex gap-2.5">
          <PrimaryButton type="submit" loading={busy}>הפק ושלח לחתימה</PrimaryButton>
          <SecondaryButton onClick={onClose}>ביטול</SecondaryButton>
        </div>
      </form>
    </Modal>
  );
}
