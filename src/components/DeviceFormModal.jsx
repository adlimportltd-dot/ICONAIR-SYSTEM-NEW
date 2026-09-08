import { useEffect, useRef, useState } from 'react';
import Modal from './ui/Modal';
import { Field, TextInput, Select, PrimaryButton, SecondaryButton } from './ui/Field';
import { createDevice, updateDevice, createCustomerSite } from '../lib/queries';
import { describeError } from '../lib/supabase';
import { DEVICE_STATUS_LABEL } from '../lib/mappers';

const EMPTY_FORM = {
  model: 'Icon 500', customer_id: '', site_id: '', scent_name: '',
  oil_level_pct: 100, location_note: '', status: 'active', unit_price: '',
};

// ערך-סנטינל בבורר הכתובת: לא id אמיתי, רק דגל "פתח טופס כתובת חדשה
// כאן במקום". זה מה שמאחד את שתי הפעולות (כתובת חדשה / מכשיר חדש)
// לזרימה אחת — בוחרים "+ הוספת כתובת חדשה", ממלאים שם ועיר באותו
// טופס, והמכשיר הראשון משתייך אליה בלחיצה אחת על שמירה.
const NEW_SITE_VALUE = '__new_site__';

function fromDevice(device, customerId, siteId) {
  if (!device) return { ...EMPTY_FORM, customer_id: customerId, site_id: siteId };
  return {
    model: device.model ?? 'Icon 500',
    customer_id: device.customer_id ?? customerId,
    site_id: device.site_id ?? '',
    scent_name: device.scent_name ?? '',
    oil_level_pct: device.oil_level_pct ?? 100,
    location_note: device.location_note ?? '',
    status: device.status ?? 'active',
    unit_price: device.unit_price ?? '',
  };
}

/**
 * טופס מכשיר — יצירה או עריכה. גוף הטופס בלבד (בלי Modal), כדי
 * שכרטיס הלקוח המאוחד יוכל להטמיע אותו כפאנל מוטבע במקום חלון קופץ.
 * DeviceFormModal (למטה) עוטף אותו ב-Modal למסך "מכשירים בשטח".
 *
 * lockedCustomer — הלקוח ידוע (נפתח מתוך כרטיס לקוח); אחרת בוחרים מרשימה.
 * siteOptions/lockedSite — כתובות הלקוח; lockedSite מקבע כתובת מראש.
 * canCreateSite — האם להציג "+ הוספת כתובת חדשה" (RLS: מנהלים בלבד).
 * editDevice — מכשיר קיים לעריכה; בלעדיו זו יצירה.
 */
export function DeviceForm({
  customerOptions = [],
  scentOptions = [],
  modelOptions = [],
  lockedCustomer = null,
  siteOptions = [],
  lockedSite = null,
  canCreateSite = false,
  editDevice = null,
  onSaved,
  onCancel,
}) {
  const customerId = lockedCustomer?.id ?? '';
  const siteId = lockedSite?.id ?? '';

  const [form, setForm] = useState(() => fromDevice(editDevice, customerId, siteId));
  const [newSiteLabel, setNewSiteLabel] = useState('');
  const [newSiteCity, setNewSiteCity] = useState('');
  const [newSiteCode, setNewSiteCode] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState([]);

  // איזה כפתור נלחץ. ref ולא state: הערך נקרא בתוך אותו אירוע submit,
  // לפני ש-React הספיק להחיל עדכון state.
  const keepOpen = useRef(false);

  const isEdit = Boolean(editDevice?.id);
  const set = (key) => (event) => setForm((prev) => ({ ...prev, [key]: event.target.value }));

  async function submit(event) {
    event.preventDefault();
    const again = keepOpen.current;

    setError(null);
    setBusy(true);

    try {
      // "+ הוספת כתובת חדשה" — פותחים אותה קודם, ומשייכים את המכשיר
      // אליה מייד. צעד אחד בתוך אותו טופס, לא שני כפתורים מנותקים.
      let resolvedSiteId = form.site_id || null;
      if (resolvedSiteId === NEW_SITE_VALUE) {
        const site = await createCustomerSite(form.customer_id, {
          label: newSiteLabel.trim(),
          city: newSiteCity.trim(),
          building_code: newSiteCode.trim(),
        });
        resolvedSiteId = site.id;
      }

      const payload = {
        model: form.model,
        customer_id: form.customer_id,
        site_id: resolvedSiteId,
        scent_name: form.scent_name || null,
        status: form.status,
        oil_level_pct: Number(form.oil_level_pct),
        location_note: form.location_note || null,
        unit_price: form.unit_price === '' || form.unit_price == null ? null : Number(form.unit_price),
      };

      // serial לא נשלח — טריגר בבסיס הנתונים מייצר אותו לפי הדגם
      const device = isEdit ? await updateDevice(editDevice.id, payload) : await createDevice(payload);

      if (again && !isEdit) {
        setAdded((prev) => [...prev, device.serial]);
        // הכתובת (גם אם נוצרה כרגע) והלקוח נשארים — רק מה שמשתנה בין
        // מכשיר למכשיר מתאפס. המכשיר הבא לא יוצר את הכתובת שוב.
        setForm((prev) => ({ ...prev, site_id: resolvedSiteId ?? '', scent_name: '', location_note: '' }));
        setNewSiteLabel('');
        setNewSiteCity('');
        setNewSiteCode('');
        onSaved?.(device, { keepOpen: true });
      } else {
        onSaved?.(device, { keepOpen: false });
      }
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  const siteSelectOptions = canCreateSite
    ? [...siteOptions, { value: NEW_SITE_VALUE, label: '+ הוספת כתובת חדשה' }]
    : siteOptions;

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      {lockedCustomer ? null : (
        <Field label="לקוח" required>
          <Select value={form.customer_id} onChange={set('customer_id')} options={customerOptions}
                  placeholder="בחר לקוח" required />
        </Field>
      )}

      {lockedSite && !isEdit ? (
        <Field label="כתובת">
          <div className="inner-row flex items-center gap-2 px-4 py-3 text-[15px]">
            <span className="truncate font-semibold">{lockedSite.label}</span>
            <span className="ms-auto flex-none text-[13px] text-text-faint">קבוע לכרטיסייה זו</span>
          </div>
        </Field>
      ) : lockedCustomer && (siteSelectOptions.length > 0) && (
        <>
          <Field
            label="כתובת"
            hint={siteOptions.length > 0
              ? 'לאיזו כתובת של הלקוח שייך המכשיר?'
              : 'אופציונלי — אם ללקוח כמה סניפים/בניינים, אפשר לפתוח כתובת חדשה ולשייך אליה ישר'}
          >
            <Select
              value={form.site_id}
              onChange={set('site_id')}
              options={siteSelectOptions}
              placeholder="ללא כתובת ספציפית"
            />
          </Field>

          {form.site_id === NEW_SITE_VALUE && (
            <div className="rounded-row border border-gold-300/[0.3] bg-gold-500/[0.06] p-4">
              <div className="grid grid-cols-1 gap-4 xs:grid-cols-3">
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
                <Field label="קוד בניין">
                  <TextInput dir="ltr" className="text-start" value={newSiteCode} onChange={(e) => setNewSiteCode(e.target.value)} placeholder="#1234" />
                </Field>
              </div>
            </div>
          )}
        </>
      )}

      <div className="grid grid-cols-1 gap-4 xs:grid-cols-2">
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
        <Field label="סטטוס">
          <Select
            value={form.status}
            onChange={set('status')}
            options={Object.entries(DEVICE_STATUS_LABEL)
              .filter(([value]) => value !== 'uninstalled' || isEdit)
              .map(([value, label]) => ({ value, label }))}
          />
        </Field>
        <Field
          label="מחיר ליחידה (₪, לפני מע״מ)"
          hint="אופציונלי. ריק = לפי מחיר הדגם בכתובת; מלא = מחיר ידני למכשיר הזה בלבד"
        >
          <TextInput type="number" min={0} step="0.01" value={form.unit_price} onChange={set('unit_price')} placeholder="לפי דגם" />
        </Field>
      </div>

      {added.length > 0 && (
        <div className="rounded-row border border-ok/25 bg-ok/[0.07] px-4 py-3 text-[14px] text-ok">
          נרשמו {added.length} מכשירים בפעימה הזו:{' '}
          <span dir="ltr" className="font-mono">{added.join(', ')}</span>
        </div>
      )}

      {error && (
        <div className="rounded-row border border-crit/25 bg-crit/[0.07] px-4 py-3 text-[14px] text-crit-soft">
          {error}
        </div>
      )}

      <div className="mt-1 flex flex-wrap gap-3">
        <PrimaryButton type="submit" loading={busy} onClick={() => { keepOpen.current = false; }}>
          {isEdit ? 'שמור שינויים' : 'שמור וסגור'}
        </PrimaryButton>
        {!isEdit && (
          <SecondaryButton type="submit" disabled={busy} onClick={() => { keepOpen.current = true; }}>
            שמור והוסף עוד
          </SecondaryButton>
        )}
        {onCancel && (
          <SecondaryButton onClick={onCancel}>
            {added.length > 0 ? 'סיום' : 'ביטול'}
          </SecondaryButton>
        )}
      </div>
    </form>
  );
}

/**
 * גרסת ה-Modal של הטופס — למסך "מכשירים בשטח" (רישום מכשיר לכל לקוח
 * שהוא, בלי כרטיס לקוח פתוח). כרטיס הלקוח עצמו משתמש ב-DeviceForm
 * מוטבע, לא בזה.
 */
export default function DeviceFormModal({ open, onClose, onCreated, ...formProps }) {
  // key מאלץ את הטופס להתחיל מחדש בכל פתיחה (state נקי), במקום effect
  // שמאפס שדות ידנית.
  const [instance, setInstance] = useState(0);
  useEffect(() => { if (open) setInstance((n) => n + 1); }, [open]);

  return (
    <Modal
      open={open}
      title="מכשיר חדש"
      subtitle="המספר הסידורי נוצר אוטומטית לפי הדגם"
      onClose={onClose}
    >
      <DeviceForm
        key={instance}
        {...formProps}
        onSaved={(device, { keepOpen }) => {
          onCreated?.(device);
          if (!keepOpen) onClose();
        }}
        onCancel={onClose}
      />
    </Modal>
  );
}
