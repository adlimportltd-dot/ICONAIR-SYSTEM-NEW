import { useMemo, useState } from 'react';
import GlassCard, { CardHead } from '../components/ui/GlassCard';
import DataTable, { StatusChip } from '../components/ui/DataTable';
import Modal from '../components/ui/Modal';
import { Field, TextInput, Select, PrimaryButton, SecondaryButton } from '../components/ui/Field';
import { Async, EmptyState } from '../components/ui/States';
import { useAuth } from '../context/AuthContext';
import { useQuery } from '../hooks/useQuery';
import { useRealtime } from '../hooks/useRealtime';
import { listTechnicianStock, listTechnicianOptions, setTechnicianStock, listScents, listDeviceModels } from '../lib/queries';
import { describeError } from '../lib/supabase';

const LOW_STOCK = 2;

/** שורה בלי ניחוח = מכשירים ביחידות שלמות; שורה עם ניחוח = שמן בליטרים. */
const isDeviceRow = (scentName) => !scentName;

function formatQty(quantity, scentName) {
  const n = Number(quantity ?? 0);
  return isDeviceRow(scentName) ? `${n} יח׳` : `${n.toLocaleString('he-IL', { maximumFractionDigits: 2 })} ל׳`;
}

/**
 * מלאי נייד — "מה יש ברכב עכשיו" לכל טכנאי. complete_visit (סיום ביקור
 * ב-OilScreen) צורך מכאן אוטומטית יחידה אחת בכל ביקור; המסך הזה הוא
 * המקום שמנהל טוען/מעדכן את הכמות מולה מתחילים כל בוקר.
 *
 * טכנאי רואה רק את השורות שלו, לקריאה בלבד — RLS כבר מגביל את זה,
 * וגם ה-UI לא מציג לו כפתור עריכה, כדי לא להציע פעולה שתיכשל.
 */
export default function StockScreen() {
  const { isAdmin } = useAuth();
  const [formOpen, setFormOpen] = useState(false);
  const [editRow, setEditRow] = useState(null);

  const stock = useQuery(listTechnicianStock, []);
  const technicians = useQuery(listTechnicianOptions, [], { enabled: isAdmin });

  // כשטכנאי לוחץ "סיום ביקור" ב-OilScreen, complete_visit מוריד יחידה
  // מהמלאי שלו — המסך הזה צריך לרענן את עצמו בלי רענון ידני של הדף,
  // גם אם המנהל פתוח כאן במקביל.
  useRealtime(['technician_stock'], stock.refetch);

  const scents = useQuery(listScents, [], { enabled: isAdmin });
  const models = useQuery(listDeviceModels, [], { enabled: isAdmin });

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

  const columns = [
    {
      key: 'technician',
      label: 'טכנאי',
      render: (row) => row.technician?.full_name ?? '—',
    },
    {
      key: 'model',
      label: 'דגם',
      width: '110px',
      render: (row) => (row.model
        ? <StatusChip tone="slate">{row.model}</StatusChip>
        : <span className="text-text-faint">— (שמן)</span>),
    },
    { key: 'scent', label: 'ניחוח', render: (row) => row.scent_name || 'ללא ניחוח ספציפי' },
    {
      key: 'quantity',
      label: 'כמות ברכב',
      width: '110px',
      render: (row) => (
        <span className={`tabular font-mono text-[13px] font-semibold ${row.quantity <= LOW_STOCK ? 'text-crit-soft' : ''}`}>
          {formatQty(row.quantity, row.scent_name)}
        </span>
      ),
    },
  ];

  return (
    <>
      <GlassCard>
        <CardHead
          title="מלאי נייד"
          subtitle={isAdmin ? 'מה יש ברכב של כל טכנאי כרגע' : 'מה יש ברכב שלך כרגע'}
          action={isAdmin ? 'עדכון ידני' : undefined}
          onAction={isAdmin ? () => { setEditRow(null); setFormOpen(true); } : undefined}
        />

        <Async
          loading={stock.loading}
          error={stock.error}
          onRetry={stock.refetch}
          isEmpty={stock.data?.length === 0}
          empty={
            <EmptyState
              title="אין עדיין מלאי רשום"
              hint={isAdmin
                ? 'הקצה מלאי מ"ניהול מלאי וקטלוג" בתפריט, או לחץ "עדכון ידני" לקביעת כמות ישירה.'
                : 'המנהל עוד לא טען עבורך מלאי.'}
            />
          }
        >
          <DataTable
            columns={columns}
            rows={stock.data ?? []}
            rowKey={(row) => row.id}
            onRowClick={isAdmin ? (row) => { setEditRow(row); setFormOpen(true); } : undefined}
          />
        </Async>
      </GlassCard>

      {isAdmin && (
        <StockFormModal
          open={formOpen}
          editRow={editRow}
          technicianOptions={technicianOptions}
          scentOptions={scentOptions}
          modelOptions={modelOptions}
          onClose={() => setFormOpen(false)}
          onSaved={() => {
            setFormOpen(false);
            stock.refetch();
          }}
        />
      )}
    </>
  );
}

function StockFormModal({ open, editRow, technicianOptions, scentOptions, modelOptions, onClose, onSaved }) {
  const [form, setForm] = useState(() => ({
    technician_id: editRow?.technician_id ?? '',
    model: editRow?.model ?? modelOptions[0]?.value ?? '',
    scent_name: editRow?.scent_name ?? '',
    quantity: editRow ? String(editRow.quantity) : '',
  }));
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const set = (key) => (event) => setForm((prev) => ({ ...prev, [key]: event.target.value }));
  const isDevice = isDeviceRow(form.scent_name);

  // כפתורי קיצור: מוסיפים (או מורידים) על גבי הערך הנוכחי בשדה, כדי
  // שהמנהל לא יצטרך לחשב "יש 5, טוענים עוד 3, אז אכתוב 8" בעצמו —
  // השדה עדיין שולח כמות סופית ל-setTechnicianStock, רק המספר עצמו
  // מחושב כאן. רלוונטי רק למכשירים (יחידות שלמות) — לשמנים בליטרים
  // אין קפיצות עגולות שהגיוני להציע כברירת מחדל.
  const quickAdd = (delta) => setForm((prev) => ({
    ...prev,
    quantity: String(Math.max(0, Number(prev.quantity || 0) + delta)),
  }));

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
      await setTechnicianStock({
        technician_id: form.technician_id,
        model: form.model,
        scent_name: form.scent_name || null,
        quantity,
      });
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
      title={editRow ? 'עדכון מלאי' : 'טעינת מלאי'}
      subtitle={
        editRow
          ? `כרגע ברכב: ${formatQty(editRow.quantity, editRow.scent_name)} — הכמות שתזין מחליפה את זה`
          : 'הכמות שתזין היא הכמות הסופית ברכב'
      }
      onClose={onClose}
    >
      <form onSubmit={submit} className="flex flex-col gap-3.5">
        <Field label="טכנאי" required>
          <Select value={form.technician_id} onChange={set('technician_id')} options={technicianOptions}
                  placeholder="בחר טכנאי" required disabled={Boolean(editRow)} />
        </Field>

        <div className="grid grid-cols-1 gap-3.5 xs:grid-cols-2">
          <Field label="דגם" required>
            <Select value={form.model} onChange={set('model')}
                    options={modelOptions}
                    disabled={Boolean(editRow)} />
          </Field>
          <Field label="ניחוח" hint="השאר ריק אם לא ספציפי">
            <Select value={form.scent_name} onChange={set('scent_name')} options={scentOptions}
                    placeholder="ללא ניחוח ספציפי" disabled={Boolean(editRow)} />
          </Field>
        </div>

        <Field
          label={isDevice ? 'כמות ברכב (יחידות)' : 'כמות ברכב (ליטרים)'}
          hint={isDevice ? undefined : 'ליטרים, אפשר עם נקודה עשרונית — למשל 5.5'}
          required
        >
          <div className="flex items-center gap-2">
            <TextInput
              type="number"
              min={0}
              step={isDevice ? 1 : 0.1}
              value={form.quantity}
              onChange={set('quantity')}
              required
              className="flex-1"
            />
            {isDevice && (
              <div className="flex flex-none gap-1.5">
                {[1, 5, 10].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => quickAdd(n)}
                    className="ghost-btn !px-2.5 !py-2 tabular font-mono text-[12px]"
                  >
                    +{n}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => quickAdd(-1)}
                  className="ghost-btn !px-2.5 !py-2 tabular font-mono text-[12px]"
                  aria-label="הפחת יחידה אחת"
                >
                  −1
                </button>
              </div>
            )}
          </div>
        </Field>

        {error && (
          <div className="rounded-row border border-crit/25 bg-crit/[0.07] px-3.5 py-2.5 text-[12.5px] text-crit-soft">
            {error}
          </div>
        )}

        <div className="mt-1 flex gap-2.5">
          <PrimaryButton type="submit" loading={busy}>שמור</PrimaryButton>
          <SecondaryButton onClick={onClose}>ביטול</SecondaryButton>
        </div>
      </form>
    </Modal>
  );
}
