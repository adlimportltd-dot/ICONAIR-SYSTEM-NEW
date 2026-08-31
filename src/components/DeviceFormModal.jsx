import { useEffect, useRef, useState } from 'react';
import Modal from './ui/Modal';
import { Field, TextInput, Select, PrimaryButton, SecondaryButton } from './ui/Field';
import { createDevice } from '../lib/queries';
import { describeError } from '../lib/supabase';
import { DEVICE_STATUS_LABEL } from '../lib/mappers';

const EMPTY_FORM = {
  model: 'Icon 500', customer_id: '', scent_name: '',
  oil_level_pct: 100, location_note: '', status: 'active',
};

/**
 * טופס "מכשיר חדש".
 *
 * ללקוח אחד יכולים להיות עשרות מכשירים, וכל אחד הוא שורה עצמאית עם
 * הדגם, הניחוח והמיקום שלו. לכן יש כאן שתי דרכי שמירה:
 * "שמור וסגור" לרישום בודד, ו"שמור והוסף עוד" לרישום סדרה שלמה
 * בהתקנה אחת — שם הלקוח והדגם נשארים, והניחוח והמיקום מתאפסים
 * כי הם מה שמשתנה בין מכשיר למכשיר.
 *
 * lockedCustomer — כשהחלון נפתח מתוך כרטיס לקוח, הלקוח כבר ידוע
 * ואי אפשר לשנות אותו; אחרת בוחרים אותו מהרשימה.
 */
export default function DeviceFormModal({
  open,
  customerOptions = [],
  scentOptions = [],
  modelOptions = [],
  lockedCustomer = null,
  onClose,
  onCreated,
}) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState([]);

  // איזה כפתור נלחץ. ref ולא state: הערך נקרא בתוך אותו אירוע submit,
  // לפני ש-React הספיק להחיל עדכון state.
  const keepOpen = useRef(false);

  const customerId = lockedCustomer?.id ?? '';

  useEffect(() => {
    if (!open) return;
    setForm({ ...EMPTY_FORM, customer_id: customerId });
    setError(null);
    setAdded([]);
  }, [open, customerId]);

  const set = (key) => (event) => setForm((prev) => ({ ...prev, [key]: event.target.value }));

  async function submit(event) {
    event.preventDefault();
    const again = keepOpen.current;

    setError(null);
    setBusy(true);

    try {
      // serial לא נשלח — טריגר בבסיס הנתונים מייצר אותו לפי הדגם
      const device = await createDevice({
        model: form.model,
        customer_id: form.customer_id,
        scent_name: form.scent_name || null,
        status: form.status,
        oil_level_pct: Number(form.oil_level_pct),
        location_note: form.location_note || null,
      });

      onCreated?.(device);

      if (again) {
        setAdded((prev) => [...prev, device.serial]);
        setForm((prev) => ({ ...prev, scent_name: '', location_note: '' }));
      } else {
        onClose();
      }
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      title="מכשיר חדש"
      subtitle={
        lockedCustomer
          ? `נרשם ל${lockedCustomer.name} · המספר הסידורי נוצר אוטומטית`
          : 'המספר הסידורי נוצר אוטומטית לפי הדגם'
      }
      onClose={onClose}
    >
      <form onSubmit={submit} className="flex flex-col gap-3.5">
        {lockedCustomer ? (
          <Field label="לקוח">
            <div className="inner-row flex items-center gap-2 px-3.5 py-2.5 text-[14px]">
              <span className="truncate font-semibold">{lockedCustomer.name}</span>
              <span className="ms-auto flex-none text-[11.5px] text-text-faint">קבוע לכרטיס זה</span>
            </div>
          </Field>
        ) : (
          <Field label="לקוח" required>
            <Select value={form.customer_id} onChange={set('customer_id')} options={customerOptions}
                    placeholder="בחר לקוח" required />
          </Field>
        )}

        <div className="grid grid-cols-1 gap-3.5 xs:grid-cols-2">
          <Field label="דגם" required>
            <Select value={form.model} onChange={set('model')} options={modelOptions} required />
          </Field>
          <Field label="ניחוח" hint="ייחודי למכשיר הזה">
            <Select value={form.scent_name} onChange={set('scent_name')} options={scentOptions}
                    placeholder="בחר ניחוח" />
          </Field>
          <Field label="מיקום במתחם" hint="לובי ראשי, קומה 2…">
            <TextInput value={form.location_note} onChange={set('location_note')} />
          </Field>
          <Field label="מפלס שמן התחלתי (%)">
            <TextInput type="number" min={0} max={100} value={form.oil_level_pct} onChange={set('oil_level_pct')} />
          </Field>
        </div>

        <Field label="סטטוס">
          <Select
            value={form.status}
            onChange={set('status')}
            options={Object.entries(DEVICE_STATUS_LABEL)
              .filter(([value]) => value !== 'uninstalled')
              .map(([value, label]) => ({ value, label }))}
          />
        </Field>

        {added.length > 0 && (
          <div className="rounded-row border border-ok/25 bg-ok/[0.07] px-3.5 py-2.5 text-[12.5px] text-ok">
            נרשמו {added.length} מכשירים בפעימה הזו:{' '}
            <span dir="ltr" className="font-mono">{added.join(', ')}</span>
          </div>
        )}

        {error && (
          <div className="rounded-row border border-crit/25 bg-crit/[0.07] px-3.5 py-2.5 text-[12.5px] text-crit-soft">
            {error}
          </div>
        )}

        <div className="mt-1 flex flex-wrap gap-2.5">
          <PrimaryButton type="submit" loading={busy} onClick={() => { keepOpen.current = false; }}>
            שמור וסגור
          </PrimaryButton>
          <SecondaryButton type="submit" disabled={busy} onClick={() => { keepOpen.current = true; }}>
            שמור והוסף עוד
          </SecondaryButton>
          <SecondaryButton onClick={onClose}>
            {added.length > 0 ? 'סיום' : 'ביטול'}
          </SecondaryButton>
        </div>
      </form>
    </Modal>
  );
}
