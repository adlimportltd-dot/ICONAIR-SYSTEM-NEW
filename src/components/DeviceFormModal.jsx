import { useEffect, useRef, useState } from 'react';
import Modal from './ui/Modal';
import { Field, TextInput, Select, PrimaryButton, SecondaryButton } from './ui/Field';
import { createDevice, createCustomerSite } from '../lib/queries';
import { describeError } from '../lib/supabase';
import { DEVICE_STATUS_LABEL } from '../lib/mappers';

const EMPTY_FORM = {
  model: 'Icon 500', customer_id: '', site_id: '', scent_name: '',
  oil_level_pct: 100, location_note: '', status: 'active',
};

// ערך-סנטינל בבורר הכתובת: לא id אמיתי, רק דגל "פתח טופס כתובת חדשה
// כאן במקום". זה מה שמאחד את שתי הפעולות שהיו קודם מנותקות (כתובת
// חדשה / מכשיר חדש) לזרימה אחת — בוחרים "+ הוספת כתובת חדשה", ממלאים
// שם ועיר באותו טופס, והמכשיר הראשון משתייך אליה בלחיצה אחת על שמירה.
const NEW_SITE_VALUE = '__new_site__';

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
 *
 * siteOptions/lockedSite — רק ללקוח רב-כתובתי (יש לו customer_sites).
 * lockedSite קובע מראש איזו כתובת (למשל כשנפתח מתוך כרטיסיית כתובת
 * ספציפית); בלעדיו, וכשיש siteOptions, מוצג בורר כתובת חופשי.
 */
export default function DeviceFormModal({
  open,
  customerOptions = [],
  scentOptions = [],
  modelOptions = [],
  lockedCustomer = null,
  siteOptions = [],
  lockedSite = null,
  onClose,
  onCreated,
}) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [newSiteLabel, setNewSiteLabel] = useState('');
  const [newSiteCity, setNewSiteCity] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState([]);

  // איזה כפתור נלחץ. ref ולא state: הערך נקרא בתוך אותו אירוע submit,
  // לפני ש-React הספיק להחיל עדכון state.
  const keepOpen = useRef(false);

  const customerId = lockedCustomer?.id ?? '';
  const siteId = lockedSite?.id ?? '';

  useEffect(() => {
    if (!open) return;
    setForm({ ...EMPTY_FORM, customer_id: customerId, site_id: siteId });
    setNewSiteLabel('');
    setNewSiteCity('');
    setError(null);
    setAdded([]);
  }, [open, customerId, siteId]);

  const set = (key) => (event) => setForm((prev) => ({ ...prev, [key]: event.target.value }));

  async function submit(event) {
    event.preventDefault();
    const again = keepOpen.current;

    setError(null);
    setBusy(true);

    try {
      // אם נבחר "+ הוספת כתובת חדשה" — פותחים אותה קודם, ומשייכים את
      // המכשיר אליה מייד. זו הזרימה המאוחדת: לא שני כפתורים מנותקים,
      // אלא צעד אחד בתוך אותו טופס.
      let resolvedSiteId = form.site_id || null;
      if (resolvedSiteId === NEW_SITE_VALUE) {
        const site = await createCustomerSite(form.customer_id, {
          label: newSiteLabel.trim(),
          city: newSiteCity.trim(),
        });
        resolvedSiteId = site.id;
      }

      // serial לא נשלח — טריגר בבסיס הנתונים מייצר אותו לפי הדגם
      const device = await createDevice({
        model: form.model,
        customer_id: form.customer_id,
        site_id: resolvedSiteId,
        scent_name: form.scent_name || null,
        status: form.status,
        oil_level_pct: Number(form.oil_level_pct),
        location_note: form.location_note || null,
      });

      onCreated?.(device);

      if (again) {
        setAdded((prev) => [...prev, device.serial]);
        // הכתובת (אם נוצרה כרגע) והלקוח נשארים — רק מה שמשתנה בין מכשיר
        // למכשיר מתאפס. מכשיר הבא באותה פעימה כבר לא יוצר את הכתובת שוב.
        setForm((prev) => ({ ...prev, site_id: resolvedSiteId, scent_name: '', location_note: '' }));
        setNewSiteLabel('');
        setNewSiteCity('');
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

        {lockedSite ? (
          <Field label="כתובת">
            <div className="inner-row flex items-center gap-2 px-3.5 py-2.5 text-[14px]">
              <span className="truncate font-semibold">{lockedSite.label}</span>
              <span className="ms-auto flex-none text-[11.5px] text-text-faint">קבוע לכרטיסייה זו</span>
            </div>
          </Field>
        ) : lockedCustomer && (
          <>
            <Field
              label="כתובת"
              hint={siteOptions.length > 0
                ? 'ללקוח הזה כמה כתובות — לאיזו שייך המכשיר? אפשר גם לפתוח כתובת חדשה'
                : 'אופציונלי — אם ללקוח יש כמה סניפים/בניינים, אפשר לפתוח כתובת חדשה ולשייך אליה ישר'}
            >
              <Select
                value={form.site_id}
                onChange={set('site_id')}
                options={[...siteOptions, { value: NEW_SITE_VALUE, label: '+ הוספת כתובת חדשה' }]}
                placeholder="ללא כתובת ספציפית"
              />
            </Field>

            {form.site_id === NEW_SITE_VALUE && (
              <div className="rounded-row border border-gold-300/[0.2] bg-gold-500/[0.05] p-3.5">
                <div className="grid grid-cols-1 gap-3.5 xs:grid-cols-2">
                  <Field label="שם הכתובת" required>
                    <TextInput
                      autoFocus
                      value={newSiteLabel}
                      onChange={(e) => setNewSiteLabel(e.target.value)}
                      placeholder="לדוגמה: אהוד מנור 9"
                      required
                    />
                  </Field>
                  <Field label="עיר">
                    <TextInput value={newSiteCity} onChange={(e) => setNewSiteCity(e.target.value)} />
                  </Field>
                </div>
              </div>
            )}
          </>
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
