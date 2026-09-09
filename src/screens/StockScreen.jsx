import { useEffect, useMemo, useState } from 'react';
import GlassCard, { CardHead } from '../components/ui/GlassCard';
import DataTable, { StatusChip } from '../components/ui/DataTable';
import Modal from '../components/ui/Modal';
import { Field, TextInput, Select, PrimaryButton, SecondaryButton } from '../components/ui/Field';
import { Async, EmptyState } from '../components/ui/States';
import { BoxIcon, RouteIcon, DeviceIcon } from '../components/ui/Icons';
import { useAuth } from '../context/AuthContext';
import { useQuery } from '../hooks/useQuery';
import { useRealtime } from '../hooks/useRealtime';
import {
  listTechnicianStock, listTechnicianOptions, setTechnicianStock, listScents, listDeviceModels,
  returnStockToWarehouse, listRoutes, getRouteLoadPlan,
} from '../lib/queries';
import { describeError } from '../lib/supabase';
import { getCycleInfo } from '../lib/mappers';

const LOW_STOCK = 2;
const PREP_ROUTE_KEY = 'iconair:prepRoute';
// תקרה קבועה על "מכשירים חדשים" — המסך צריך להישאר "במבט אחד" גם אם
// אירעה קליטה מרוכזת (עשרות/מאות מכשירים בבת אחת), לא רק ביום רגיל
// עם אחד-שניים חדשים.
const NEW_DEVICES_SHOWN = 8;

// 5 ל'/0.5 ל' — גדלי האריזה הפיזיים שבפועל נטענים לרכב (גלון גדול +
// בקבוק קטן). ממיר ליטרים גולמיים לרשימת-לקיחה שהטכנאי יכול לבצע
// ליד המדף בלי לחשב בעצמו — ומכוון-מעלה בכוונה (אף פעם לא מעגל למטה),
// כדי שלעולם לא "יחסר" ליום העבודה.
const JUG_L = 5;
const BOTTLE_L = 0.5;
function toContainers(liters) {
  const jugs = Math.floor(liters / JUG_L);
  const remainder = Math.round((liters - jugs * JUG_L) * 100) / 100;
  const bottles = remainder > 0 ? Math.ceil(remainder / BOTTLE_L) : 0;
  return { jugs, bottles };
}
function containersLabel(liters) {
  const { jugs, bottles } = toContainers(liters);
  const parts = [];
  if (jugs > 0) parts.push(`${jugs} גלון${jugs > 1 ? 'ים' : ''} (5 ל')`);
  if (bottles > 0) parts.push(`${bottles} בקבוק${bottles > 1 ? 'ים' : ''} (0.5 ל')`);
  return parts.join(' + ') || 'אין צורך';
}

/** שורה בלי ניחוח = מכשירים ביחידות שלמות; שורה עם ניחוח = שמן בליטרים. */
const isDeviceRow = (scentName) => !scentName;

function formatQty(quantity, scentName) {
  const n = Number(quantity ?? 0);
  return isDeviceRow(scentName) ? `${n} יח׳` : `${n.toLocaleString('he-IL', { maximumFractionDigits: 2 })} ל׳`;
}

/**
 * "מה להעמיס היום" — הדבר הראשון שהטכנאי אמור לראות ב"הכנה לקו", לפני
 * הכל: כמה מכל ניחוח לטעון (בגלונים ובבקבוקים, לא רק ליטרים גולמיים —
 * ר' toContainers למעלה), ואילו מכשירים חדשים (שאף פעם לא קיבלו שירות
 * בשטח) צריך לקחת פיזית מהמדף. מבוסס על getRouteLoadPlan — לפי הקו
 * שהטכנאי בוחר (נשמר בדפדפן שלו, לא צריך לבחור כל בוקר מחדש).
 * 2026-09-09 — תגובה לדרישה מפורשת: "בלי לחפור במספרים או לגלול מיותר".
 */
function TodayLoadCard() {
  const routes = useQuery(listRoutes, []);
  const [activeRoute, setActiveRoute] = useState(() => {
    try { return localStorage.getItem(PREP_ROUTE_KEY) || undefined; } catch { return undefined; }
  });
  const [viewingCycle, setViewingCycle] = useState('current'); // 'current' | 'next'

  useEffect(() => {
    if (!activeRoute && routes.data?.length) setActiveRoute(routes.data.find((r) => r.name)?.name);
  }, [activeRoute, routes.data]);

  useEffect(() => {
    if (!activeRoute) return;
    try { localStorage.setItem(PREP_ROUTE_KEY, activeRoute); } catch { /* לא קריטי אם החיסון חסום */ }
  }, [activeRoute]);

  const plan = useQuery(() => getRouteLoadPlan(activeRoute), [activeRoute], { enabled: Boolean(activeRoute) });
  useRealtime(['devices', 'oil_tracking'], plan.refetch, { enabled: Boolean(activeRoute) });

  const routeOptions = (routes.data ?? []).filter((r) => r.name);
  const activeRouteObj = routeOptions.find((r) => r.name === activeRoute);
  const cycleInfo = useMemo(() => getCycleInfo(activeRouteObj), [activeRouteObj]);
  const cycle = cycleInfo[viewingCycle];

  return (
    <GlassCard className="mb-3.5">
      <CardHead
        icon={RouteIcon}
        tone="ok"
        title="מה להעמיס היום"
        subtitle={
          viewingCycle === 'next'
            ? `הכנה מוקדמת למחזור הבא — ${cycle.label} (${cycle.start.getDate()}–${cycle.end.getDate()} לחודש)`
            : `המחזור הפעיל — ${cycle.label} (עד ${cycle.end.getDate()} לחודש) — לפי מצב השמן הנוכחי בכל מכשיר`
        }
      />

      {/*
        2026-09-09 (דרישה מפורשת: "התראה אוטומטית סביב ה-25 לחודש"):
        לא job ברקע — מחושב בכל טעינה (getCycleInfo.alertDue, ר' mappers.js).
        זה בכוונה: לא תלוי בהרצת-שרת שאפשר לפספס, ומדויק בכל פתיחה של המסך.
      */}
      {cycleInfo.alertDue && viewingCycle === 'current' && (
        <div className="mb-5 flex flex-wrap items-center gap-3 rounded-row border border-warn/30 bg-warn/[0.08] px-4 py-3.5">
          <div className="min-w-0 flex-1 text-[14.5px] text-warn">
            <b className="font-bold">המחזור הבא ({cycleInfo.next.label}) נפתח בעוד {cycleInfo.daysUntilNextCycle} ימים</b>
            {' '}— זמן להתחיל להכין ולהעמיס ציוד לכל הקווים.
          </div>
          <button
            type="button"
            onClick={() => setViewingCycle('next')}
            className="ghost-btn flex-none !border-warn/40 !text-warn"
          >
            הצג הכנה למחזור הבא
          </button>
        </div>
      )}

      {routeOptions.length > 1 && (
        <div className="mb-3.5 flex flex-wrap gap-2">
          {routeOptions.map((r) => (
            <button
              key={r.name}
              type="button"
              onClick={() => setActiveRoute(r.name)}
              className={`rounded-pill border px-4 py-2.5 text-[15px] font-bold transition-colors ${
                r.name === activeRoute
                  ? 'border-gold-500/45 bg-gold-500/[0.14] text-gold-600'
                  : 'border-black/[0.09] text-text-dim hover:border-black/[0.18] hover:text-text'
              }`}
            >
              {r.name}
            </button>
          ))}
        </div>
      )}

      <div className="mb-5 flex gap-2">
        <button
          type="button"
          onClick={() => setViewingCycle('current')}
          className={`flex-1 rounded-pill border px-3.5 py-2 text-[14px] font-semibold transition-colors ${
            viewingCycle === 'current' ? 'border-black/[0.18] bg-ink-800 text-text' : 'border-black/[0.09] text-text-faint'
          }`}
        >
          מחזור נוכחי · {cycleInfo.current.label}
        </button>
        <button
          type="button"
          onClick={() => setViewingCycle('next')}
          className={`flex-1 rounded-pill border px-3.5 py-2 text-[14px] font-semibold transition-colors ${
            viewingCycle === 'next' ? 'border-black/[0.18] bg-ink-800 text-text' : 'border-black/[0.09] text-text-faint'
          }`}
        >
          מחזור הבא · {cycleInfo.next.label}
        </button>
      </div>

      <Async
        loading={plan.loading || routes.loading}
        error={plan.error}
        onRetry={plan.refetch}
        isEmpty={!activeRoute}
        empty={<EmptyState title="עדיין אין קווים במערכת" hint="קו נוצר אוטומטית כשמשייכים לקוח ראשון אליו." />}
      >
        {plan.data && (
          <>
            <div className="mb-5 grid grid-cols-2 gap-3">
              <div className="rounded-row border border-black/[0.06] bg-ink-800 px-4 py-3.5 text-center">
                <div className="text-[13px] font-bold uppercase tracking-[0.8px] text-text-faint">מכשירים בקו</div>
                <div className="tabular mt-1 font-display text-[30px] font-bold leading-none">{plan.data.deviceCount}</div>
              </div>
              <div className="rounded-row border border-black/[0.06] bg-ink-800 px-4 py-3.5 text-center">
                <div className="text-[13px] font-bold uppercase tracking-[0.8px] text-text-faint">סה״כ שמן להעמיס</div>
                <div className="tabular mt-1 font-display text-[30px] font-bold leading-none text-gold-600">
                  {plan.data.items.reduce((sum, i) => sum + i.liters, 0).toLocaleString('he-IL', { maximumFractionDigits: 1 })} ל׳
                </div>
              </div>
            </div>

            {plan.data.items.length === 0 ? (
              <div className="rounded-row border border-dashed border-black/[0.1] px-4 py-6 text-center text-[15px] text-text-faint">
                כל המכשירים בקו הזה מלאים — אין צורך להעמיס שמן היום.
              </div>
            ) : (
              <div className="flex flex-col gap-2.5">
                {plan.data.items.map((item) => (
                  <div key={item.scent_name} className="inner-row flex flex-wrap items-center justify-between gap-2 px-4 py-3.5">
                    <div className="min-w-0">
                      <div className="text-[17px] font-bold">{item.scent_name}</div>
                      <div className="tabular mt-0.5 text-[13.5px] text-text-faint">סה״כ {item.liters.toLocaleString('he-IL')} ל׳</div>
                    </div>
                    <div className="tabular rounded-pill border border-gold-300/[0.4] bg-gold-500/[0.1] px-3.5 py-2 text-[15px] font-bold text-gold-600">
                      {containersLabel(item.liters)}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {plan.data.missing.length > 0 && (
              <div className="mt-4 rounded-row border border-warn/25 bg-warn/[0.07] px-4 py-3 text-[14px] text-warn">
                {plan.data.missing.length} מכשירים בקו בלי ניחוח משויך או בלי נפח-מכל מוגדר לדגם — לא נכנסו לחישוב.
                תעדכן אותם בכרטיס הלקוח כדי שהתכנון יהיה מדויק.
              </div>
            )}

            {plan.data.newDevices.length > 0 && (
              <div className="mt-5">
                <CardHead
                  icon={DeviceIcon}
                  tone="crit"
                  title="מכשירים חדשים להתקנה היום"
                  subtitle={
                    plan.data.newDevices.length > NEW_DEVICES_SHOWN
                      ? `${plan.data.newDevices.length} מכשירים עדיין לא קיבלו טיפול בשטח — מוצגים ${NEW_DEVICES_SHOWN} הראשונים`
                      : 'עדיין לא קיבלו שום טיפול בשטח — לקחת פיזית מהמדף לפני שיוצאים'
                  }
                />
                <div className="flex flex-col gap-2.5">
                  {plan.data.newDevices.slice(0, NEW_DEVICES_SHOWN).map((d) => (
                    <div key={d.id} className="inner-row flex flex-wrap items-center justify-between gap-2 px-4 py-3.5">
                      <div className="min-w-0">
                        <div className="text-[15px] font-bold">{d.customer_name}</div>
                        <div className="mt-0.5 text-[13.5px] text-text-faint">{d.address || 'ללא כתובת ספציפית'}</div>
                      </div>
                      <div className="flex flex-none items-center gap-2">
                        <StatusChip tone="slate">{d.model}</StatusChip>
                        <span dir="ltr" className="font-mono text-[13px] font-semibold text-text-dim">{d.serial}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </Async>
    </GlassCard>
  );
}

/**
 * מלאי נייד — "מה יש ברכב עכשיו" לכל טכנאי. complete_visit (סיום ביקור
 * ב-OilScreen) צורך מכאן אוטומטית את הליטרים/יחידות המדויקים בכל ביקור
 * (ר' phase19); המסך הזה הוא המקום שמנהל טוען/מעדכן את הכמות מולה
 * מתחילים כל בוקר ("הכנה לקו").
 *
 * טכנאי רואה רק את השורות שלו, בעיקר לקריאה — אין לו כפתור עריכה חופשי
 * (RLS גם חוסמת את זה), אבל יש לו פעולה מוגבלת אחת על השורות שלו: "החזרה
 * למחסן" בסוף היום (2026-09-09, phase19) — לא עריכה חופשית, רק הפחתה
 * מבוקרת דרך return_stock_to_warehouse (שנשאר אטומי ובודק שיש מספיק
 * להחזיר), שגם מזכה את המחסן הראשי בו-זמנית.
 */
export default function StockScreen() {
  const { isAdmin, profile } = useAuth();
  const [formOpen, setFormOpen] = useState(false);
  const [editRow, setEditRow] = useState(null);
  const [returnRow, setReturnRow] = useState(null);

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
        <span className={`tabular font-mono text-[14px] font-semibold ${row.quantity <= LOW_STOCK ? 'text-crit-soft' : ''}`}>
          {formatQty(row.quantity, row.scent_name)}
        </span>
      ),
    },
  ];

  return (
    <>
      <TodayLoadCard />

      <GlassCard>
        <CardHead
          icon={BoxIcon}
          tone="slate"
          title="מה כבר יש ברכב"
          subtitle={isAdmin ? 'המלאי הנייד הנוכחי של כל טכנאי' : 'המלאי הנייד שלך כרגע'}
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
            actions={(row) => (row.technician_id === profile?.id && row.quantity > 0
              ? (
                <button
                  type="button"
                  onClick={(event) => { event.stopPropagation(); setReturnRow(row); }}
                  className="ghost-btn !px-3.5 !py-2 text-[13.5px]"
                >
                  החזרה למחסן
                </button>
              )
              : null)}
          />
        </Async>
      </GlassCard>

      <ReturnStockModal
        row={returnRow}
        onClose={() => setReturnRow(null)}
        onSaved={() => {
          setReturnRow(null);
          stock.refetch();
        }}
      />

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
                    className="ghost-btn !px-2.5 !py-2 tabular font-mono text-[13.5px]"
                  >
                    +{n}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => quickAdd(-1)}
                  className="ghost-btn !px-2.5 !py-2 tabular font-mono text-[13.5px]"
                  aria-label="הפחת יחידה אחת"
                >
                  −1
                </button>
              </div>
            )}
          </div>
        </Field>

        {error && (
          <div className="rounded-row border border-crit/25 bg-crit/[0.07] px-3.5 py-2.5 text-[14px] text-crit-soft">
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

/**
 * "החזרה למחסן" — דיווח עצמי של טכנאי בסוף יום: כמה חזר איתו פיזית
 * לרכב (גלונים שלא נפתחו, נפח שנשאר בבקבוק וכו'). לא עריכה חופשית —
 * רק הפחתה מבוקרת מהשורה שלו, דרך return_stock_to_warehouse (בודקת
 * שיש מספיק להחזיר ומזכה את המחסן הראשי באותה טרנזקציה, ר' phase19).
 * ברירת המחדל היא הכמות המלאה שנשארה — ברוב הימים הטכנאי פשוט מאשר.
 */
function ReturnStockModal({ row, onClose, onSaved }) {
  const [quantity, setQuantity] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (row) { setQuantity(String(row.quantity)); setError(null); } }, [row]);

  if (!row) return null;

  const isDevice = isDeviceRow(row.scent_name);
  const max = Number(row.quantity);

  async function submit(event) {
    event.preventDefault();
    setError(null);

    const n = Number(quantity);
    if (!n || n <= 0) { setError('כמות להחזרה חייבת להיות גדולה מ-0'); return; }
    if (n > max) { setError(`אי אפשר להחזיר יותר ממה שיש ברכב (${formatQty(max, row.scent_name)})`); return; }
    if (isDevice && !Number.isInteger(n)) { setError('כמות מכשירים חייבת להיות מספר יחידות שלם'); return; }

    setBusy(true);
    try {
      await returnStockToWarehouse({
        technician_id: row.technician_id,
        model: row.model,
        scent_name: row.scent_name || null,
        quantity: n,
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
      open
      title="החזרה למחסן — סוף יום"
      subtitle={`${row.model || row.scent_name} · יש לך ברכב ${formatQty(row.quantity, row.scent_name)}`}
      onClose={onClose}
    >
      <form onSubmit={submit} className="flex flex-col gap-3.5">
        <Field
          label={isDevice ? 'כמות להחזרה (יחידות)' : 'כמות להחזרה (ליטרים)'}
          hint="מה שחוזר איתך פיזית לרכב — גלונים שלא נפתחו, או הנפח שנשאר בבקבוק"
          required
        >
          <TextInput
            type="number"
            min={0}
            max={max}
            step={isDevice ? 1 : 0.1}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            required
            autoFocus
          />
        </Field>

        {error && (
          <div className="rounded-row border border-crit/25 bg-crit/[0.07] px-3.5 py-2.5 text-[14px] text-crit-soft">
            {error}
          </div>
        )}

        <div className="mt-1 flex gap-2.5">
          <PrimaryButton type="submit" loading={busy}>אישור החזרה</PrimaryButton>
          <SecondaryButton onClick={onClose}>ביטול</SecondaryButton>
        </div>
      </form>
    </Modal>
  );
}
