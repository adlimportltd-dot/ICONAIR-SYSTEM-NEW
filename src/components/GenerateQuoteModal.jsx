import { useEffect, useMemo, useState } from 'react';
import Modal from './ui/Modal';
import QuoteDocumentTemplate from './QuoteDocumentTemplate';
import { Field, TextInput, Select, PrimaryButton, SecondaryButton } from './ui/Field';
import { listDeviceModels } from '../lib/queries';
import { createLeadQuote } from '../lib/quoteReport';
import { useAuth } from '../context/AuthContext';
import { useQuery } from '../hooks/useQuery';
import { describeError } from '../lib/supabase';
import { computeVat, formatCurrency, dedupeRepeatedText } from '../lib/mappers';
import { whatsappLink } from '../lib/navLinks';

const emptyRow = () => ({ model: '', quantity: 1, unitPrice: '' });

/**
 * הפקת הצעת מחיר ממותגת מתוך כרטיס הליד — 2026-09-22, בקשה מפורשת:
 * "מודול הפקת הצעות מחיר מתקדם... שליפת דגמים אוטומטית... מחיר פתוח
 * ודינמי... מיתוג מלא... שליחה מהירה". הדגמים נשלפים מ-device_models
 * (הרשימה הגלובלית הקיימת, אותה רשימה שמוצגת בניהול המלאי) — אין
 * מחירון גלובלי בבסיס הנתונים (תמחור תמיד היה per-customer/per-device,
 * ר' CLAUDE.md), ולכן המחיר לכל שורה הוא קלט פתוח, לא נשלף אוטומטית.
 * "שליחה מהירה" = קישור וואטסאפ לקובץ ה-PDF הציבורי, אותו ערוץ בדיוק
 * שכבר משמש לחוזים (GenerateContractModal) — לא אינטגרציה חדשה.
 */
export default function GenerateQuoteModal({ lead, onClose, onCreated }) {
  const { session } = useAuth();
  const models = useQuery(listDeviceModels, []);
  const modelOptions = useMemo(() => (models.data ?? []).map((m) => ({ value: m.name, label: m.name })), [models.data]);

  const [rows, setRows] = useState([emptyRow()]);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (lead) {
      setRows([emptyRow()]);
      setError(null);
      setResult(null);
    }
  }, [lead]);

  function updateRow(index, patch) {
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }
  function addRow() {
    setRows((prev) => [...prev, emptyRow()]);
  }
  function removeRow(index) {
    setRows((prev) => prev.filter((_, i) => i !== index));
  }

  const numericItems = rows.map((row) => ({
    model: row.model,
    quantity: Number(row.quantity) || 0,
    unitPrice: Number(row.unitPrice) || 0,
  }));
  const validItems = numericItems.filter((row) => row.model && row.quantity > 0);
  const subtotal = validItems.reduce((sum, row) => sum + row.quantity * row.unitPrice, 0);
  const { vatAmount, total } = computeVat(subtotal, 'excluded');

  async function submit(event) {
    event.preventDefault();
    setError(null);

    if (validItems.length === 0) {
      setError('הוסף לפחות דגם אחד עם כמות ומחיר גדולים מ-0');
      return;
    }

    setBusy(true);
    try {
      const quote = await createLeadQuote({
        leadId: lead.id,
        leadName: lead.full_name,
        leadCity: lead.city ? dedupeRepeatedText(lead.city) : null,
        leadPhone: lead.phone,
        items: validItems,
        userId: session.user.id,
      });

      const message = `שלום ${lead.full_name}, מצורפת הצעת מחיר מ-ICON AIR:\n${quote.file_url}`;
      setResult({ url: quote.file_url, whatsappHref: whatsappLink(lead.phone, message) });
      onCreated?.();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return (
      <Modal open={Boolean(lead)} title="הצעת המחיר הופקה" subtitle={lead?.full_name} onClose={onClose}>
        <div className="flex flex-col gap-3.5">
          <div className="rounded-row border border-ok/25 bg-ok/[0.07] px-3.5 py-3 text-[14px] text-ok">
            קובץ ה-PDF נוצר ונשמר. אפשר לפתוח/להוריד אותו, או לשלוח את הקישור ישירות ללקוח בוואטסאפ.
          </div>

          <div dir="ltr" className="break-all rounded-row border border-black/[0.09] bg-ink-800 px-3.5 py-2.5 font-mono text-[13.5px] text-text-dim">
            {result.url}
          </div>

          <div className="flex flex-wrap gap-2.5">
            {result.whatsappHref && (
              <PrimaryButton onClick={() => window.open(result.whatsappHref, '_blank', 'noopener')}>
                שלח בוואטסאפ
              </PrimaryButton>
            )}
            <SecondaryButton onClick={() => window.open(result.url, '_blank', 'noopener')}>
              פתח / הורד PDF
            </SecondaryButton>
            <SecondaryButton onClick={onClose}>סגירה</SecondaryButton>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal open={Boolean(lead)} title="הפקת הצעת מחיר" subtitle={lead?.full_name} onClose={onClose}>
      {lead && (
        <form onSubmit={submit} className="flex flex-col gap-3.5">
          <div className="rounded-row border border-black/[0.07] bg-black/[0.02] p-3.5">
            <div className="mb-2.5 flex items-center gap-2">
              <div className="text-[14px] font-semibold text-text-dim">דגמים ומחירים</div>
              <button type="button" onClick={addRow} className="ghost-btn ms-auto !px-2.5 !py-1.5 text-[13.5px]">
                + שורה
              </button>
            </div>

            <div className="flex flex-col gap-2">
              {rows.map((row, i) => (
                <div key={i} className="grid grid-cols-[1.4fr_0.6fr_0.9fr_auto] items-center gap-2">
                  <Select
                    value={row.model}
                    onChange={(e) => updateRow(i, { model: e.target.value })}
                    options={modelOptions}
                    placeholder="בחר דגם"
                    className="!py-2 text-[14px]"
                  />
                  <TextInput
                    type="number" min={1} step={1}
                    value={row.quantity}
                    onChange={(e) => updateRow(i, { quantity: e.target.value })}
                    className="!py-2 text-[14px]"
                  />
                  <TextInput
                    type="number" min={0} step={1}
                    placeholder="מחיר ליחידה"
                    value={row.unitPrice}
                    onChange={(e) => updateRow(i, { unitPrice: e.target.value })}
                    className="!py-2 text-[14px]"
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

            {validItems.length > 0 && (
              <div className="mt-3.5 flex flex-col gap-1 border-t border-black/[0.07] pt-3 text-[13.5px]">
                <div className="flex justify-between text-text-dim">
                  <span>סה״כ לפני מע״מ</span>
                  <span className="tabular font-semibold">{formatCurrency(subtotal)}</span>
                </div>
                <div className="flex justify-between text-text-faint">
                  <span>מע״מ (18%)</span>
                  <span className="tabular">{formatCurrency(vatAmount)}</span>
                </div>
                <div className="flex justify-between text-[15px] font-bold">
                  <span>סה״כ כולל מע״מ</span>
                  <span className="tabular text-gold-600">{formatCurrency(total)}</span>
                </div>
              </div>
            )}
          </div>

          <div>
            <div className="mb-1.5 text-[14px] font-medium text-text-dim">תצוגה מקדימה</div>
            <div className="max-h-[420px] overflow-auto rounded-row border border-black/[0.09]">
              <QuoteDocumentTemplate
                leadName={lead.full_name}
                leadCity={lead.city ? dedupeRepeatedText(lead.city) : null}
                leadPhone={lead.phone}
                items={numericItems}
              />
            </div>
          </div>

          {error && (
            <div className="rounded-row border border-crit/25 bg-crit/[0.07] px-3.5 py-2.5 text-[14px] text-crit-soft">
              {error}
            </div>
          )}

          <div className="mt-1 flex gap-2.5">
            <PrimaryButton type="submit" loading={busy}>הפק הצעת מחיר</PrimaryButton>
            <SecondaryButton onClick={onClose}>ביטול</SecondaryButton>
          </div>
        </form>
      )}
    </Modal>
  );
}
