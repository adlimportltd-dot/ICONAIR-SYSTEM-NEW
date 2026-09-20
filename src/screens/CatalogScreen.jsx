import { useEffect, useMemo, useState } from 'react';
import GlassCard, { CardHead } from '../components/ui/GlassCard';
import DataTable, { StatusChip } from '../components/ui/DataTable';
import { Field, TextInput, Select, PrimaryButton } from '../components/ui/Field';
import { Async, EmptyState } from '../components/ui/States';
import { BoxIcon, TagIcon, EditIcon, TrashIcon } from '../components/ui/Icons';
import { useQuery } from '../hooks/useQuery';
import { useRealtime } from '../hooks/useRealtime';
import { useAuth } from '../context/AuthContext';
import {
  listScents, listDeviceModels, listTechnicianOptions,
  listWarehouseStock, receiveStock, allocateStockToTechnician, returnStockToWarehouse,
  updateWarehouseStockQuantity, deleteWarehouseStockRow,
} from '../lib/queries';
import { describeError } from '../lib/supabase';

const LOW_STOCK = 2;

/**
 * שורה בלי ניחוח = מכשירים, נספרים ביחידות שלמות. שורה עם ניחוח = שמן,
 * נמדד בליטרים ומותר עם שבר עשרוני (5.5 ל' וכו'). אותה מוסכמה חוזרת
 * בטבלה ובשני הטפסים, כדי שמספר לא יוצג בלי שברור אם הוא יחידות או
 * ליטרים.
 */
const isDeviceRow = (scentName) => !scentName;

function formatQty(quantity, scentName) {
  const n = Number(quantity ?? 0);
  return isDeviceRow(scentName)
    ? `${n} יח׳`
    : `${n.toLocaleString('he-IL', { maximumFractionDigits: 2 })} ל׳`;
}

/**
 * טוגל בלעדי בין "מכשירים" ל"שמן/ניחוח" — מרכיב משותף לשני הטפסים.
 * בלעדיות מובנית מהמבנה עצמו: כשבוחרים צד אחד, שדות הצד השני
 * פשוט לא מוצגים בכלל, אז אין דרך למלא את שניהם בטעות.
 */
function ItemTypeToggle({ value, onChange }) {
  return (
    <div className="inline-flex rounded-pill border border-black/[0.09] p-1">
      {[
        { key: 'device', label: 'מכשירים' },
        { key: 'scent', label: 'שמן / ניחוח' },
      ].map((opt) => (
        <button
          key={opt.key}
          type="button"
          onClick={() => onChange(opt.key)}
          className={`rounded-pill px-4 py-1.5 text-[14px] font-medium transition-colors ${
            value === opt.key ? 'bg-gold-500/20 text-gold-600' : 'text-text-faint hover:text-text-dim'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

/**
 * ניהול מלאי — מסך ניהול ייעודי, מנהל בלבד (מוסתר גם בסיידבר למי
 * שאינו מנהל, וגם כאן ליתר ביטחון אם מישהו הגיע לכתובת ישירות).
 *
 * שני אזורים בלבד, זה מתחת לזה (flex-col, בלי position:absolute
 * ובלי חלונות מרחפים): קליטת סחורה למעלה, מלאי + הקצאה לטכנאים
 * למטה. ניהול רשימות הקטלוג עצמן (דגמים/ניחוחות — הוספת שם חדש
 * לרשימה) עבר למסך "הגדרות", כי זה לא "מלאי" — זה קטלוג שמות.
 */
export default function CatalogScreen() {
  const { isAdmin } = useAuth();

  const warehouse = useQuery(listWarehouseStock, [], { enabled: isAdmin });
  const technicians = useQuery(listTechnicianOptions, [], { enabled: isAdmin });
  const scents = useQuery(listScents, [], { enabled: isAdmin });
  const models = useQuery(listDeviceModels, [], { enabled: isAdmin });

  useRealtime(['warehouse_stock'], warehouse.refetch, { enabled: isAdmin });
  // ניחוח/דגם חדש שנוסף במסך "הגדרות" — מופיע כאן חי, בלי רענון
  useRealtime(['scents', 'device_models'], () => { scents.refetch(); models.refetch(); }, { enabled: isAdmin });

  const technicianOptions = useMemo(
    () => (technicians.data ?? []).map((t) => ({ value: t.id, label: t.full_name ?? 'ללא שם' })),
    [technicians.data]
  );
  const scentOptions = useMemo(
    () => (scents.data ?? []).map((s) => ({ value: s.name, label: s.name })),
    [scents.data]
  );
  const modelOptions = useMemo(
    () => (models.data ?? []).map((m) => ({ value: m.name, label: m.name })),
    [models.data]
  );

  if (!isAdmin) {
    return (
      <GlassCard>
        <CardHead title="אין הרשאה" subtitle="המסך הזה זמין למנהלים בלבד" />
      </GlassCard>
    );
  }

  return (
    <div className="flex flex-col gap-3.5">
      <ReceiveStockCard
        modelOptions={modelOptions}
        scentOptions={scentOptions}
        onReceived={warehouse.refetch}
      />

      <WarehouseStatusCard
        warehouse={warehouse}
        technicianOptions={technicianOptions}
        modelOptions={modelOptions}
        scentOptions={scentOptions}
      />

      <ReturnStockCard
        technicianOptions={technicianOptions}
        modelOptions={modelOptions}
        scentOptions={scentOptions}
        onReturned={warehouse.refetch}
      />
    </div>
  );
}

const EMPTY_RETURN_FORM = { itemType: 'scent', technician_id: '', model: '', scent_name: '', quantity: '' };

/**
 * החזרת מלאי שלא נוצל בפועל מהטכנאי בחזרה למחסן — הכיוון ההפוך
 * ל"הקצאה לטכנאי" בכרטיס למעלה, בדיוק כמו שקליטת סחורה היא ההפך
 * מ"יצא מהמחסן". זה מה שסוגר את מעגל הדיווח: מה שהוקצה בבוקר,
 * פחות מה שנצרך בפועל בשטח (oil_tracking), פחות מה שחזר לכאן —
 * ר' getStockMovementsSummary במסך דוחות.
 */
function ReturnStockCard({ technicianOptions, modelOptions, scentOptions, onReturned }) {
  const [form, setForm] = useState(EMPTY_RETURN_FORM);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const set = (key) => (event) => setForm((prev) => ({ ...prev, [key]: event.target.value }));
  const setItemType = (itemType) => { setForm({ ...EMPTY_RETURN_FORM, itemType, technician_id: form.technician_id }); setError(null); };
  const isDevice = form.itemType === 'device';

  async function submit(event) {
    event.preventDefault();
    setError(null);

    const quantity = Number(form.quantity);
    if (isDevice && !Number.isInteger(quantity)) {
      setError('כמות מכשירים חייבת להיות מספר יחידות שלם — בלי שברים');
      return;
    }

    setBusy(true);
    try {
      await returnStockToWarehouse({
        technician_id: form.technician_id,
        model: isDevice ? form.model : null,
        scent_name: isDevice ? null : form.scent_name,
        quantity,
      });
      setForm({ ...EMPTY_RETURN_FORM, itemType: form.itemType, technician_id: form.technician_id });
      onReturned();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  const itemReady = isDevice ? Boolean(form.model) : Boolean(form.scent_name);

  return (
    <GlassCard>
      <CardHead
        icon={BoxIcon}
        tone="ok"
        title="החזרת מלאי מטכנאי"
        subtitle="מה שיצא ברכב ולא נוצל בשטח — חוזר לכאן, ומצטבר על מה שכבר יש במחסן"
      />

      <form onSubmit={submit} className="flex flex-col gap-3.5">
        <Field label="טכנאי" required>
          <Select value={form.technician_id} onChange={set('technician_id')} options={technicianOptions}
                  placeholder="בחר טכנאי" required />
        </Field>

        <ItemTypeToggle value={form.itemType} onChange={setItemType} />

        {isDevice ? (
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
            <Field label="דגם" required>
              <Select value={form.model} onChange={set('model')} options={modelOptions}
                      placeholder="בחר דגם" required />
            </Field>
            <Field label="כמות (יחידות)" hint="מספר שלם" required>
              <TextInput type="number" min={1} step={1} value={form.quantity} onChange={set('quantity')} required />
            </Field>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
            <Field label="ניחוח" required>
              <Select value={form.scent_name} onChange={set('scent_name')} options={scentOptions}
                      placeholder="בחר ניחוח" required />
            </Field>
            <Field label="כמות (ליטרים)" hint="עשרוני מותר, למשל 1.5" required>
              <TextInput type="number" min={0.1} step={0.1} value={form.quantity} onChange={set('quantity')} required />
            </Field>
          </div>
        )}

        {error && (
          <div className="rounded-row border border-crit/25 bg-crit/[0.07] px-3.5 py-2.5 text-[14px] text-crit-soft">
            {error}
          </div>
        )}

        <div>
          <PrimaryButton type="submit" loading={busy} disabled={!form.technician_id || !itemReady || !form.quantity}>
            רשום החזרה למחסן
          </PrimaryButton>
        </div>
      </form>
    </GlassCard>
  );
}

const EMPTY_RECEIVE_FORM = { itemType: 'device', model: '', scent_name: '', quantity: '' };

/**
 * חלק עליון: קליטת סחורה למחסן הראשי. תמיד מוסיף לכמות הקיימת
 * (receive_stock ב-RPC), לא קובע כמות מוחלטת — כדי שקליטה פעמיים
 * באותו יום תצטבר, לא תמחק. טופס אחד, קבוע על המסך, בלי מודאל.
 *
 * מכשיר ושמן הם שני סוגי פריט בלעדיים — לא "דגם וגם ניחוח יחד", אלא
 * "דגם, או ניחוח". הטוגל קובע איזה שדות מוצגים; השדות של הצד הלא
 * נבחר לא קיימים ב-DOM בכלל, כך שהם גם לא יכולים להישלח בטעות.
 */
function ReceiveStockCard({ modelOptions, scentOptions, onReceived }) {
  const [form, setForm] = useState(EMPTY_RECEIVE_FORM);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const set = (key) => (event) => setForm((prev) => ({ ...prev, [key]: event.target.value }));
  const setItemType = (itemType) => { setForm({ ...EMPTY_RECEIVE_FORM, itemType }); setError(null); };
  const isDevice = form.itemType === 'device';

  async function submit(event) {
    event.preventDefault();
    setError(null);

    const quantity = Number(form.quantity);
    if (isDevice && !Number.isInteger(quantity)) {
      setError('כמות מכשירים חייבת להיות מספר יחידות שלם — בלי שברים');
      return;
    }

    setBusy(true);
    try {
      await receiveStock({
        model: isDevice ? form.model : null,
        scent_name: isDevice ? null : form.scent_name,
        quantity,
      });
      setForm({ ...EMPTY_RECEIVE_FORM, itemType: form.itemType });
      onReceived();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  const ready = isDevice ? Boolean(form.model) : Boolean(form.scent_name);

  return (
    <GlassCard>
      <CardHead
        icon={BoxIcon}
        tone="teal"
        title="קליטת סחורה למחסן הראשי"
        subtitle="מכשירים ביחידות שלמות · שמנים בליטרים — מצטבר על מה שכבר יש במחסן"
      />

      <form onSubmit={submit} className="flex flex-col gap-3.5">
        <ItemTypeToggle value={form.itemType} onChange={setItemType} />

        {isDevice ? (
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
            <Field label="דגם" required>
              <Select value={form.model} onChange={set('model')} options={modelOptions}
                      placeholder="בחר דגם" required />
            </Field>
            <Field label="כמות (יחידות)" hint="מספר שלם" required>
              <TextInput type="number" min={1} step={1} value={form.quantity} onChange={set('quantity')} required />
            </Field>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
            <Field label="ניחוח" required>
              <Select value={form.scent_name} onChange={set('scent_name')} options={scentOptions}
                      placeholder="בחר ניחוח" required />
            </Field>
            <Field label="כמות (ליטרים)" hint="עשרוני מותר, למשל 5.5" required>
              <TextInput type="number" min={0.1} step={0.1} value={form.quantity} onChange={set('quantity')} required />
            </Field>
          </div>
        )}

        {error && (
          <div className="rounded-row border border-crit/25 bg-crit/[0.07] px-3.5 py-2.5 text-[14px] text-crit-soft">
            {error}
          </div>
        )}

        <div>
          <PrimaryButton type="submit" loading={busy} disabled={!ready || !form.quantity}>
            הוסף למחסן
          </PrimaryButton>
        </div>
      </form>
    </GlassCard>
  );
}

/**
 * כמות שורת מחסן, ניתנת לתיקון ידני בלחיצה (למשל אחרי ספירת מלאי
 * בפועל, או לניקוי כמות שגויה שהוזנה בטעות) — אותו דפוס בדיוק כמו
 * עריכת מחיר-ידני למכשיר ב-CustomerProfile.jsx: לחיצה הופכת את התא
 * לשדה קלט + שמירה/ביטול, בלי לפתוח מודאל נפרד.
 */
function QuantityCell({ row, onChanged, onError }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(row.quantity));
  const [busy, setBusy] = useState(false);
  const isDevice = isDeviceRow(row.scent_name);

  useEffect(() => { setValue(String(row.quantity)); }, [row.quantity]);

  async function save() {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) { onError('כמות לא תקינה'); return; }
    if (isDevice && !Number.isInteger(n)) { onError('כמות מכשירים חייבת להיות מספר יחידות שלם — בלי שברים'); return; }

    setBusy(true);
    try {
      await updateWarehouseStockQuantity(row.id, n);
      setEditing(false);
      onChanged();
    } catch (caught) {
      onError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        title="לחץ לתיקון כמות ידני"
        className={`tabular flex items-center gap-1.5 font-mono text-[14px] font-semibold hover:text-gold-600 ${
          row.quantity <= LOW_STOCK ? 'text-crit-soft' : ''
        }`}
      >
        {formatQty(row.quantity, row.scent_name)}
        <EditIcon className="h-3.5 w-3.5 text-text-faint" />
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <input
        type="number"
        min={0}
        step={isDevice ? 1 : 0.1}
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); save(); }
          if (e.key === 'Escape') setEditing(false);
        }}
        aria-label={`תיקון כמות עבור ${row.model || row.scent_name}`}
        className="w-[84px] rounded-pill border border-gold-500/45 bg-white px-2.5 py-1.5 text-[14px] text-text focus:outline-none"
      />
      <button
        type="button"
        onClick={save}
        disabled={busy}
        className="rounded-pill border border-gold-300/[0.35] bg-gold-500/[0.12] px-2.5 py-1.5 text-[13px] font-semibold text-gold-600 disabled:opacity-50"
      >
        שמירה
      </button>
      <button type="button" onClick={() => setEditing(false)} className="ghost-btn !px-2.5 !py-1.5 text-[13px]">
        ביטול
      </button>
    </div>
  );
}

/** מחיקת שורת מחסן (למשל פריט טסט) — אישור כפול, אותו דפוס כמו מחיקות אחרות במערכת */
function DeleteRowButton({ row, onChanged, onError }) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleDelete() {
    if (!confirm) { setConfirm(true); return; }
    setBusy(true);
    try {
      await deleteWarehouseStockRow(row.id);
      onChanged();
    } catch (caught) {
      onError(describeError(caught));
      setConfirm(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleDelete}
      disabled={busy}
      aria-label={confirm ? `לאשר מחיקת שורת מלאי ${row.model || row.scent_name}` : `מחק שורת מלאי ${row.model || row.scent_name}`}
      className={`flex items-center gap-1.5 rounded-pill border px-3 py-1.5 text-[13px] font-semibold transition-colors disabled:opacity-50 ${
        confirm ? 'border-crit/50 bg-crit/10 text-crit-soft' : 'border-black/[0.09] text-text-faint hover:border-crit/35 hover:text-crit-soft'
      }`}
    >
      <TrashIcon className={`h-3.5 w-3.5 ${confirm ? '' : 'text-crit-soft'}`} />
      {confirm ? 'לאשר מחיקה' : 'מחיקה'}
    </button>
  );
}

const EMPTY_ALLOCATE_FORM = { itemType: 'device', technician_id: '', model: '', scent_name: '', quantity: '' };

/**
 * חלק תחתון: סטטוס מלאי נוכחי במחסן + הקצאה לטכנאים, באותו כרטיס —
 * טבלה למעלה, טופס הקצאה קבוע מתחתיה (לא מודאל). allocate_stock_to_
 * technician ב-RPC אטומי: נועל את שורת המחסן, מוודא שיש מספיק, ורק
 * אז מוריד מהמחסן ומוסיף לטכנאי — אם אין מספיק, שגיאה ברורה ושום
 * צד לא זז. אותו טוגל בלעדי מכשיר/שמן כמו בטופס הקליטה למעלה.
 */
function WarehouseStatusCard({ warehouse, technicianOptions, modelOptions, scentOptions }) {
  const [form, setForm] = useState(EMPTY_ALLOCATE_FORM);
  const [error, setError] = useState(null);
  const [rowError, setRowError] = useState(null);
  const [busy, setBusy] = useState(false);

  const set = (key) => (event) => setForm((prev) => ({ ...prev, [key]: event.target.value }));
  const setItemType = (itemType) => {
    setForm({ ...EMPTY_ALLOCATE_FORM, itemType, technician_id: form.technician_id });
    setError(null);
  };
  const isDevice = form.itemType === 'device';

  const available = (warehouse.data ?? []).find((row) => (
    isDevice ? row.model === form.model && !row.scent_name : row.scent_name === form.scent_name && !row.model
  ))?.quantity ?? 0;

  async function submit(event) {
    event.preventDefault();
    setError(null);

    const quantity = Number(form.quantity);
    if (isDevice && !Number.isInteger(quantity)) {
      setError('כמות מכשירים חייבת להיות מספר יחידות שלם — בלי שברים');
      return;
    }

    setBusy(true);
    try {
      await allocateStockToTechnician({
        technician_id: form.technician_id,
        model: isDevice ? form.model : null,
        scent_name: isDevice ? null : form.scent_name,
        quantity,
      });
      setForm({ ...EMPTY_ALLOCATE_FORM, itemType: form.itemType, technician_id: form.technician_id });
      warehouse.refetch();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  const itemReady = isDevice ? Boolean(form.model) : Boolean(form.scent_name);

  const columns = [
    {
      key: 'model',
      label: 'דגם',
      width: '110px',
      render: (row) => (row.model
        ? <StatusChip tone="slate">{row.model}</StatusChip>
        : <span className="text-text-faint">— (שמן)</span>),
    },
    { key: 'scent', label: 'ניחוח', render: (row) => row.scent_name || 'ללא ניחוח (מכשירים)' },
    {
      key: 'quantity',
      label: 'כמות במחסן',
      width: '150px',
      render: (row) => <QuantityCell row={row} onChanged={warehouse.refetch} onError={setRowError} />,
    },
  ];

  return (
    <GlassCard>
      <CardHead icon={TagIcon} tone="gold" title="מלאי במחסן הראשי" subtitle="כמה יש כרגע, לפי דגם וניחוח — לחץ על הכמות לתיקון ידני" />

      {rowError && (
        <div className="mb-3.5 rounded-row border border-crit/25 bg-crit/[0.07] px-3.5 py-2.5 text-[14px] text-crit-soft">
          {rowError}
        </div>
      )}

      <Async
        loading={warehouse.loading}
        error={warehouse.error}
        onRetry={warehouse.refetch}
        isEmpty={warehouse.data?.length === 0}
        empty={<EmptyState title="המחסן ריק" hint='קלוט סחורה בטופס למעלה כדי להתחיל.' />}
      >
        <div className="overflow-x-auto">
          <DataTable
            columns={columns}
            rows={warehouse.data ?? []}
            rowKey={(row) => row.id}
            actions={(row) => <DeleteRowButton row={row} onChanged={warehouse.refetch} onError={setRowError} />}
          />
        </div>
      </Async>

      <div className="mt-5 flex flex-col gap-3.5 border-t border-black/[0.07] pt-5">
        <h3 className="text-[15px] font-semibold text-text-dim">הקצאה לטכנאי</h3>

        <form onSubmit={submit} className="flex flex-col gap-3.5">
          <Field label="טכנאי" required>
            <Select value={form.technician_id} onChange={set('technician_id')} options={technicianOptions}
                    placeholder="בחר טכנאי" required />
          </Field>

          <ItemTypeToggle value={form.itemType} onChange={setItemType} />

          {isDevice ? (
            <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
              <Field label="דגם" required>
                <Select value={form.model} onChange={set('model')} options={modelOptions}
                        placeholder="בחר דגם" required />
              </Field>
              <Field
                label="כמות (יחידות)"
                hint={form.model ? `זמין במחסן: ${formatQty(available, '')}` : 'מספר שלם'}
                required
              >
                <TextInput type="number" min={1} step={1} value={form.quantity} onChange={set('quantity')} required />
              </Field>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
              <Field label="ניחוח" required>
                <Select value={form.scent_name} onChange={set('scent_name')} options={scentOptions}
                        placeholder="בחר ניחוח" required />
              </Field>
              <Field
                label="כמות (ליטרים)"
                hint={form.scent_name ? `זמין במחסן: ${formatQty(available, form.scent_name)}` : 'עשרוני מותר, למשל 5.5'}
                required
              >
                <TextInput type="number" min={0.1} step={0.1} value={form.quantity} onChange={set('quantity')} required />
              </Field>
            </div>
          )}

          {error && (
            <div className="rounded-row border border-crit/25 bg-crit/[0.07] px-3.5 py-2.5 text-[14px] text-crit-soft">
              {error}
            </div>
          )}

          <div>
            <PrimaryButton type="submit" loading={busy} disabled={!form.technician_id || !itemReady || !form.quantity}>
              הקצה לטכנאי
            </PrimaryButton>
          </div>
        </form>
      </div>
    </GlassCard>
  );
}
