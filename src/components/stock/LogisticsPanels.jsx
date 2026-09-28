import { useEffect, useMemo, useState } from 'react';
import GlassCard, { CardHead } from '../ui/GlassCard';
import { StatusChip } from '../ui/DataTable';
import { PrimaryButton, SecondaryButton, Select, TextInput } from '../ui/Field';
import { Async, EmptyState } from '../ui/States';
import { BoxIcon, DeviceIcon, TagIcon } from '../ui/Icons';
import { useQuery } from '../../hooks/useQuery';
import { useRealtime } from '../../hooks/useRealtime';
import { describeError } from '../../lib/supabase';
import {
  createPurchaseOrder, listPurchaseOrders, setPurchaseOrderStatus, receivePurchaseOrder,
  loadTechnicianVehicle, listTechnicianOptions,
} from '../../lib/queries';

/*
 * מחזור החיים הלוגיסטי (phase49), שלושה שלבים על אותו מסך "מלאי נייד":
 *   א׳ NetRequirementPanel  — יעד הקו מול המחסן → "צור הזמנת רכש ל-ADL"
 *   ב׳ PurchaseOrdersCard   — הזמנות: הוזמנה → קליטה למחסן (גם חלקית)
 *   ג׳ VehicleLoadPanel     — העברה מהמחסן לרכב טכנאי (מלאי נייד)
 * הכתיבה כולה ב-RPC אטומיים בשרת; כאן רק תצוגה ובחירת כמויות.
 */

const SQL_URL = 'https://raw.githubusercontent.com/adlimportltd-dot/ICONAIR-SYSTEM-NEW/main/iconair_schema_phase49_purchasing_lifecycle.sql';
const fmt = (n, unit) => `${Number(n || 0).toLocaleString('he-IL', { maximumFractionDigits: 2 })} ${unit}`;
const unitOf = (kind) => (kind === 'model' ? 'יח׳' : 'ל׳');
const isSetupMissing = (e) => /purchase_order|load_technician_vehicle|PGRST20[25]|42P01|42883/i.test(String(e?.message ?? e ?? ''));

function Notice({ tone = 'crit', children }) {
  const cls = tone === 'ok'
    ? 'border-ok/25 bg-ok/[0.07] text-ok'
    : tone === 'warn' ? 'border-warn/30 bg-warn/[0.08] text-warn' : 'border-crit/25 bg-crit/[0.07] text-crit-soft';
  return <div className={`mb-3 rounded-row border px-3.5 py-2.5 text-[14px] font-semibold ${cls}`}>{children}</div>;
}

function SetupNotice() {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(await fetch(SQL_URL, { cache: 'no-store' }).then((r) => r.text()));
      setCopied(true);
    } catch { window.open(SQL_URL, '_blank', 'noopener'); }
  }
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-row border border-warn/30 bg-warn/[0.08] px-4 py-3 text-[14px] text-warn">
      <span className="min-w-0 flex-1 font-semibold">כדי להפעיל הזמנות רכש והעמסה לרכב צריך להריץ פעם אחת את קוד ה-SQL של phase49.</span>
      <button type="button" className="ghost-btn !border-warn/40 !text-warn" onClick={copy}>{copied ? 'הועתק ✓' : 'העתק קוד SQL'}</button>
    </div>
  );
}

/* ============================== שלב א׳ ============================== */

/**
 * מלאי נטו לכל ניחוח/דגם: יעד − מחסן − כבר בהזמנה פתוחה (lib/netRequirement.js),
 * וכפתור שהופך את השורות החסרות להזמנת רכש מ-ADL. השרת מחשב שוב בעצמו
 * (create_purchase_order) — כך שגם לחיצה כפולה לא תזמין פעמיים.
 */
export function NetRequirementPanel({ net, routeLabel, routeName, onOrdered }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const rows = useMemo(() => [
    ...net.scents.map((r) => ({ ...r, kind: 'scent' })),
    ...net.models.map((r) => ({ ...r, kind: 'model' })),
  ], [net]);
  // כמות משיכה חופשית (2026-09-28, בקשה מפורשת): ברירת המחדל = החישוב
  // (יעד − מחסן − בהזמנה), אבל המנהל רושם ידנית כמה בפועל מושכים מ-ADL.
  const [qty, setQty] = useState({});
  const [extras, setExtras] = useState([]);
  useEffect(() => {
    setQty(Object.fromEntries(rows.map((r) => [`${r.kind}:${r.key}`, r.net_required > 0 ? String(r.net_required) : ''])));
  }, [rows]);
  if (!rows.length) return null;

  const num = (v) => Math.max(0, Number(v) || 0);
  const lines = [
    ...rows.map((r) => ({ kind: r.kind, item: r.key, target: r.target_quantity, qty: num(qty[`${r.kind}:${r.key}`]) })),
    ...extras.map((x) => ({ kind: 'scent', item: x.item.trim(), target: 0, qty: num(x.qty) })),
  ].filter((l) => l.item && l.qty > 0);
  const totalCalc = net.totalNetLiters;
  const totalManual = Math.round(lines.filter((l) => l.kind === 'scent').reduce((s, l) => s + l.qty, 0) * 100) / 100;
  const unitsManual = lines.filter((l) => l.kind === 'model').reduce((s, l) => s + l.qty, 0);

  async function order() {
    setBusy(true);
    setMessage(null);
    try {
      const po = await createPurchaseOrder({ routeName, lines, notes: `כמויות משיכה ל${routeLabel}` });
      setMessage({ tone: 'ok', text: `נוצרה הזמנה ${po.po_number} — מופיעה ב"הזמנות רכש מ-ADL" למטה` });
      setExtras([]);
      onOrdered?.();
    } catch (e) {
      setMessage({ tone: 'crit', text: describeError(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-5">
      <CardHead icon={BoxIcon} tone="gold" title="שלב א׳ · רכש מ-ADL" subtitle="החישוב = יעד פחות מחסן פחות מה שכבר הוזמן. אפשר לשנות כל כמות ולרשום כמה מושכים בפועל" />
      <div className="mb-3.5 grid grid-cols-2 gap-3">
        <div className="rounded-row border border-black/[0.06] bg-ink-800 px-4 py-3.5 text-center">
          <div className="text-[13px] font-bold uppercase tracking-[0.8px] text-text-faint">לפי החישוב</div>
          <div className="tabular mt-1 font-display text-[26px] font-bold leading-none text-text-faint">{fmt(totalCalc, 'ל׳')}</div>
        </div>
        <div className="rounded-row border border-gold-300/[0.4] bg-gold-500/[0.08] px-4 py-3.5 text-center">
          <div className="text-[13px] font-bold uppercase tracking-[0.8px] text-text-faint">מושכים בפועל</div>
          <div className="tabular mt-1 font-display text-[26px] font-bold leading-none text-gold-600">
            {fmt(totalManual, 'ל׳')}{unitsManual > 0 && <span className="text-[15px]"> + {fmt(unitsManual, 'יח׳')}</span>}
          </div>
        </div>
      </div>

      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      {!net.purchasingReady && <div className="mb-3"><SetupNotice /></div>}

      <div className="flex flex-col gap-2">
        {rows.map((r) => {
          const k = `${r.kind}:${r.key}`;
          const changed = num(qty[k]) !== r.net_required;
          return (
            <div key={k} className="inner-row flex flex-wrap items-center gap-3 px-4 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="text-[15.5px] font-bold">{r.key}{r.kind === 'model' ? ' · מכשיר' : ''}</div>
                <div className="tabular mt-0.5 text-[13.5px] text-text-faint">
                  יעד {fmt(r.target_quantity, unitOf(r.kind))} · במחסן {fmt(r.existing_stock, unitOf(r.kind))}
                  {r.on_order > 0 && <> · בהזמנה {fmt(r.on_order, unitOf(r.kind))}</>}
                  {' · '}<span className="font-semibold">חישוב: {r.net_required > 0 ? fmt(r.net_required, unitOf(r.kind)) : 'מכוסה'}</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <TextInput type="number" min={0} step={r.kind === 'model' ? 1 : 0.1} inputMode="decimal" value={qty[k] ?? ''} placeholder="0"
                  onChange={(e) => setQty((q) => ({ ...q, [k]: e.target.value }))}
                  className={`tabular !w-24 text-center ${changed ? '!border-gold-500/60' : ''}`} aria-label={`כמות למשיכה — ${r.key}`} />
                <span className="w-7 text-[13.5px] text-text-faint">{unitOf(r.kind)}</span>
              </div>
            </div>
          );
        })}

        {extras.map((x, i) => (
          <div key={i} className="inner-row flex flex-wrap items-center gap-3 px-4 py-2.5">
            <TextInput value={x.item} placeholder="שם ניחוח" className="min-w-0 flex-1"
              onChange={(e) => setExtras((xs) => xs.map((y, j) => (j === i ? { ...y, item: e.target.value } : y)))} />
            <div className="flex items-center gap-2">
              <TextInput type="number" min={0} step={0.1} inputMode="decimal" value={x.qty} placeholder="0"
                onChange={(e) => setExtras((xs) => xs.map((y, j) => (j === i ? { ...y, qty: e.target.value } : y)))}
                className="tabular !w-24 text-center" />
              <span className="w-7 text-[13.5px] text-text-faint">ל׳</span>
              <button type="button" className="ghost-btn" onClick={() => setExtras((xs) => xs.filter((_, j) => j !== i))}>הסר</button>
            </div>
          </div>
        ))}
        <button type="button" className="ghost-btn self-start" onClick={() => setExtras((xs) => [...xs, { item: '', qty: '' }])}>+ פריט נוסף</button>
      </div>

      {net.purchasingReady && (
        <PrimaryButton className="mt-3.5 w-full" loading={busy} disabled={!lines.length} onClick={order}>
          צור הזמנת רכש ל-ADL ({lines.length} פריטים · {fmt(totalManual, 'ל׳')})
        </PrimaryButton>
      )}
    </div>
  );
}

/* ============================== שלב ג׳ ============================== */

/**
 * העברה למלאי נייד: לכל פריט — כמה צריך לקו, כמה יש במחסן, וכמה להעמיס
 * (ברירת מחדל: המינימום מבין השניים). load_technician_vehicle אטומי —
 * אם לפריט אחד אין מספיק, שום דבר לא זז.
 */
export function VehicleLoadPanel({ net, routeName, onLoaded }) {
  const technicians = useQuery(listTechnicianOptions, []);
  const options = useMemo(() => (technicians.data ?? []).map((t) => ({ value: t.id, label: t.full_name ?? 'ללא שם' })), [technicians.data]);
  const [technicianId, setTechnicianId] = useState('');
  const rows = useMemo(() => [
    ...net.scents.map((r) => ({ ...r, kind: 'scent' })),
    ...net.models.map((r) => ({ ...r, kind: 'model' })),
  ], [net]);
  const [qty, setQty] = useState({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  useEffect(() => { if (!technicianId && options.length) setTechnicianId(options[0].value); }, [options, technicianId]);
  useEffect(() => {
    setQty(Object.fromEntries(rows.map((r) => {
      const suggested = Math.min(r.target_quantity, r.existing_stock);
      return [`${r.kind}:${r.key}`, String(r.kind === 'model' ? Math.floor(suggested) : Math.round(suggested * 100) / 100)];
    })));
  }, [rows]);

  if (!rows.length) return null;
  const items = rows
    .map((r) => ({ kind: r.kind, item: r.key, qty: Number(qty[`${r.kind}:${r.key}`]) || 0, max: r.existing_stock }))
    .filter((i) => i.qty > 0);
  const over = items.find((i) => i.qty > i.max);

  async function load() {
    if (!technicianId || !items.length) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await loadTechnicianVehicle({ technicianId, routeName, items: items.map(({ kind, item, qty: q }) => ({ kind, item, qty: q })) });
      const name = options.find((o) => o.value === technicianId)?.label ?? 'הטכנאי';
      setMessage({ tone: 'ok', text: `הועברו ${res.items} פריטים לרכב של ${name} — ירדו מהמחסן ומופיעים ב"מה כבר יש ברכב"` });
      onLoaded?.();
    } catch (e) {
      setMessage({ tone: 'crit', text: describeError(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-5">
      <CardHead icon={DeviceIcon} tone="teal" title="שלב ג׳ · העברה למלאי נייד" subtitle="מהמחסן המרכזי לרכב הטכנאי — מה שיוצא לשטח לקו הזה" />
      <div className="mb-3.5">
        <Select value={technicianId} onChange={(e) => setTechnicianId(e.target.value)} options={options} placeholder="בחר טכנאי" />
      </div>
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      <div className="flex flex-col gap-2">
        {rows.map((r) => {
          const k = `${r.kind}:${r.key}`;
          const tooMuch = (Number(qty[k]) || 0) > r.existing_stock;
          return (
            <div key={k} className="inner-row flex flex-wrap items-center gap-3 px-4 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="text-[15px] font-bold">{r.key}{r.kind === 'model' ? ' · מכשיר חדש' : ''}</div>
                <div className="tabular text-[13.5px] text-text-faint">
                  לקו {fmt(r.target_quantity, unitOf(r.kind))} · במחסן {fmt(r.existing_stock, unitOf(r.kind))}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <TextInput type="number" min={0} step={r.kind === 'model' ? 1 : 0.1} inputMode="decimal" value={qty[k] ?? ''}
                  onChange={(e) => setQty((q) => ({ ...q, [k]: e.target.value }))}
                  className={`tabular !w-24 text-center ${tooMuch ? '!border-crit/50' : ''}`} aria-label={`כמות להעמסה — ${r.key}`} />
                <span className="w-7 text-[13.5px] text-text-faint">{unitOf(r.kind)}</span>
              </div>
            </div>
          );
        })}
      </div>
      {over && <div className="mt-2 text-[13.5px] font-semibold text-crit-soft">ל{over.item} אין מספיק במחסן — הזמן מ-ADL או הקטן את הכמות.</div>}
      <PrimaryButton className="mt-3.5 w-full" loading={busy} disabled={!technicianId || !items.length || Boolean(over)} onClick={load}>
        העבר לרכב ({items.length} פריטים)
      </PrimaryButton>
    </div>
  );
}

/* ============================== שלב ב׳ ============================== */

const PO_STATUS = {
  draft: { label: 'טיוטה', tone: 'neutral' },
  ordered: { label: 'הוזמן מהספק', tone: 'gold' },
  partially_received: { label: 'התקבל חלקית', tone: 'warn' },
  received: { label: 'התקבל במלואו', tone: 'ok' },
  cancelled: { label: 'בוטל', tone: 'crit' },
};

const lineLabel = (l) => (l.item_kind === 'model' ? `${l.model} (מכשיר)` : l.scent_name);

function orderText(po) {
  const lines = po.lines.map((l) => `• ${lineLabel(l)}: ${fmt(l.ordered_qty, unitOf(l.item_kind))}`);
  return [`הזמנת רכש ${po.po_number} — ICONAIR`, `ספק: ${po.supplier}`, ...lines].join('\n');
}

/** הזמנות רכש: טיוטה → הוזמן → קליטה למחסן (כל היתרה או כמויות בפועל). */
// embedded: מוצג בתוך כרטיס "מה להעמיס היום" בין שלב א׳ לשלב ג׳ (סדר העבודה).
export function PurchaseOrdersCard({ embedded = false, onChanged }) {
  const orders = useQuery(listPurchaseOrders, []);
  const refresh = () => { orders.refetch(); onChanged?.(); };
  useRealtime(['purchase_orders', 'purchase_order_lines'], orders.refetch);
  const setupMissing = orders.error && isSetupMissing(orders.error);
  const Wrap = embedded ? 'div' : GlassCard;

  return (
    <Wrap className={embedded ? 'mt-5' : 'mb-3.5'}>
      <CardHead icon={TagIcon} tone="gold" title="שלב ב׳ · הזמנות רכש מ-ADL" subtitle="מה הוזמן, מה הגיע ונקלט למחסן המרכזי" />
      {setupMissing ? <SetupNotice /> : (
        <Async loading={orders.loading} error={orders.error} onRetry={orders.refetch}
          isEmpty={!orders.data?.length}
          empty={<EmptyState title="עוד אין הזמנות רכש" hint="צור הזמנה מ״שלב א׳ · רכש נטו״ למעלה." />}>
          <div className="flex flex-col gap-3">
            {(orders.data ?? []).map((po) => <PurchaseOrderRow key={po.id} po={po} onChanged={refresh} />)}
          </div>
        </Async>
      )}
    </Wrap>
  );
}

function PurchaseOrderRow({ po, onChanged }) {
  const [open, setOpen] = useState(po.status === 'draft' || po.status === 'ordered' || po.status === 'partially_received');
  const [receiving, setReceiving] = useState(false);
  const [recv, setRecv] = useState({});
  const [busy, setBusy] = useState(null);
  const [message, setMessage] = useState(null);
  const meta = PO_STATUS[po.status] ?? PO_STATUS.draft;
  const canReceive = ['draft', 'ordered', 'partially_received'].includes(po.status);

  function startReceive() {
    setRecv(Object.fromEntries(po.lines.map((l) => [l.id, String(Math.max(0, l.ordered_qty - l.received_qty))])));
    setReceiving(true);
  }

  async function run(key, fn, ok) {
    setBusy(key);
    setMessage(null);
    try {
      await fn();
      setMessage(ok ? { tone: 'ok', text: ok } : null);
      setReceiving(false);
      onChanged();
    } catch (e) {
      setMessage({ tone: 'crit', text: describeError(e) });
    } finally {
      setBusy(null);
    }
  }

  const receive = () => run('receive', () => receivePurchaseOrder(po.id,
    po.lines.map((l) => ({ line_id: l.id, qty: Number(recv[l.id]) || 0 })).filter((x) => x.qty > 0)),
  'הסחורה נקלטה למחסן המרכזי');

  return (
    <div className="rounded-row border border-black/[0.08] bg-white">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-start">
        <span dir="ltr" className="font-mono text-[14px] font-bold">{po.po_number}</span>
        <StatusChip tone={meta.tone}>{meta.label}</StatusChip>
        <span className="text-[14px] text-text-dim">{po.supplier}{po.route_name ? ` · ${po.route_name}` : ''}</span>
        <span className="tabular ms-auto text-[13.5px] text-text-faint">{new Date(po.created_at).toLocaleDateString('he-IL')} · {po.lines.length} פריטים</span>
      </button>

      {open && (
        <div className="border-t border-black/[0.06] px-4 py-3">
          {message && <Notice tone={message.tone}>{message.text}</Notice>}
          <div className="flex flex-col gap-1.5">
            {po.lines.map((l) => (
              <div key={l.id} className="flex flex-wrap items-center gap-3 text-[14.5px]">
                <span className="min-w-0 flex-1 font-semibold">{lineLabel(l)}</span>
                <span className="tabular text-text-faint">
                  הוזמן {fmt(l.ordered_qty, unitOf(l.item_kind))} · נקלט {fmt(l.received_qty, unitOf(l.item_kind))}
                </span>
                {receiving && (
                  <TextInput type="number" min={0} step={l.item_kind === 'model' ? 1 : 0.1} value={recv[l.id] ?? ''}
                    onChange={(e) => setRecv((r) => ({ ...r, [l.id]: e.target.value }))}
                    className="tabular !w-24 text-center" aria-label={`כמות שהתקבלה — ${lineLabel(l)}`} />
                )}
              </div>
            ))}
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {receiving ? (
              <>
                <PrimaryButton loading={busy === 'receive'} onClick={receive}>קלוט למחסן</PrimaryButton>
                <SecondaryButton onClick={() => setReceiving(false)}>ביטול</SecondaryButton>
              </>
            ) : (
              <>
                {po.status === 'draft' && (
                  <PrimaryButton loading={busy === 'ordered'} onClick={() => run('ordered', () => setPurchaseOrderStatus(po.id, 'ordered'), 'סומן שההזמנה נשלחה לספק')}>
                    סמן שהוזמן מ-ADL
                  </PrimaryButton>
                )}
                {canReceive && <SecondaryButton onClick={startReceive}>קליטה למחסן</SecondaryButton>}
                <button type="button" className="ghost-btn"
                  onClick={() => navigator.clipboard?.writeText(orderText(po)).then(() => setMessage({ tone: 'ok', text: 'פרטי ההזמנה הועתקו — אפשר להדביק לספק' }))}>
                  העתק לשליחה לספק
                </button>
                {(po.status === 'draft' || po.status === 'ordered') && (
                  <button type="button" className="ghost-btn !text-crit-soft" disabled={Boolean(busy)}
                    onClick={() => window.confirm(`לבטל את ${po.po_number}?`) && run('cancel', () => setPurchaseOrderStatus(po.id, 'cancelled'), 'ההזמנה בוטלה')}>
                    בטל הזמנה
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
