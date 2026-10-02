import { useEffect, useMemo, useState } from 'react';
import GlassCard, { CardHead } from '../components/ui/GlassCard';
import DataTable, { StatusChip } from '../components/ui/DataTable';
import ScreenToolbar from '../components/ui/ScreenToolbar';
import Modal from '../components/ui/Modal';
import { CartIcon, PhoneIcon, BellIcon } from '../components/ui/Icons';
import { Field, TextArea, Select, PrimaryButton, SecondaryButton } from '../components/ui/Field';
import { Async, EmptyState } from '../components/ui/States';
import { useQuery } from '../hooks/useQuery';
import { useRealtime } from '../hooks/useRealtime';
import { useAuth } from '../context/AuthContext';
import { listWebOrders, listUnpaidWebOrders, updateWebOrder, deleteWebOrder } from '../lib/queries';
import { describeError } from '../lib/supabase';
import { formatDateTime } from '../lib/mappers';
import { wazeLink } from '../lib/navLinks';
import { isOrderSoundEnabled, setOrderSoundEnabled, playOrderChime } from '../lib/orderAlert';

/*
 * הזמנות אתר (phase51, 2026-10-02 — בקשה מפורשת): כל הזמנה מ-iconair.co.il
 * נקלטת אוטומטית (WooCommerce Webhook → /api/woo-order → web_orders) ומוצגת
 * כאן בזמן אמת. שני סטטוסים נפרדים בכוונה:
 *   - woo_status  = מה קורה באתר (שולם / ממתין להעברה / בוטל) — לקריאה בלבד.
 *   - handling_status = מה הצוות עשה עם ההזמנה (חדשה → בטיפול → נשלחה → הושלמה).
 */

export const HANDLING_STATUS = {
  new: { label: 'חדשה', tone: 'crit' },
  in_progress: { label: 'בטיפול', tone: 'gold' },
  shipped: { label: 'נשלחה', tone: 'teal' },
  done: { label: 'הושלמה', tone: 'ok' },
  cancelled: { label: 'בוטלה', tone: 'neutral' },
};

const HANDLING_OPTIONS = Object.entries(HANDLING_STATUS).map(([value, s]) => ({ value, label: s.label }));

const WOO_STATUS = {
  processing: { label: 'שולם', tone: 'ok' },
  'on-hold': { label: 'ממתין לאישור', tone: 'warn' },
  completed: { label: 'הושלם באתר', tone: 'ok' },
  pending: { label: 'לא שולם', tone: 'neutral' },
  cancelled: { label: 'בוטל באתר', tone: 'crit' },
  refunded: { label: 'הוחזר', tone: 'crit' },
  failed: { label: 'תשלום נכשל', tone: 'crit' },
  'checkout-draft': { label: 'טיוטה', tone: 'neutral' },
};

const wooStatus = (status) => WOO_STATUS[status] ?? { label: status, tone: 'neutral' };

const money = (value) =>
  `₪${Number(value ?? 0).toLocaleString('he-IL', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

const telHref = (phone) => `tel:${String(phone).replace(/[^\d+]/g, '')}`;

/** 050-1234567 → 972501234567 (פורמט wa.me) */
function whatsappHref(phone) {
  let digits = String(phone ?? '').replace(/\D/g, '');
  if (!digits) return null;
  if (digits.startsWith('00')) digits = digits.slice(2);
  else if (digits.startsWith('0')) digits = `972${digits.slice(1)}`;
  return `https://wa.me/${digits}`;
}

/**
 * הודעת וואטסאפ להשלמת תשלום (phase53) — עם קישור "השלמת תשלום" של
 * WooCommerce, שמחזיר את הלקוח ישר לעמוד התשלום של אותה הזמנה בדיוק.
 */
function payReminderText(order) {
  const first = (order.customer_name ?? '').split(' ')[0] || '';
  return [
    `שלום${first ? ` ${first}` : ''}, כאן ICONAIR.`,
    `ראינו שההזמנה שלך #${order.order_number} באתר לא הושלמה בשלב התשלום.`,
    order.pay_url ? `אפשר להשלים אותה כאן בלחיצה: ${order.pay_url}` : null,
    'אם הייתה תקלה בתשלום — נשמח לעזור גם בטלפון 055-915-8248.',
  ].filter(Boolean).join('\n');
}

function whatsappPayHref(order) {
  const base = whatsappHref(order.phone);
  return base ? `${base}?text=${encodeURIComponent(payReminderText(order))}` : null;
}

function minutesSince(value) {
  return Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60000));
}

function agoLabel(value) {
  const m = minutesSince(value);
  if (m < 60) return `לפני ${m} דק׳`;
  const h = Math.floor(m / 60);
  return h < 24 ? `לפני ${h} שע׳` : `לפני ${Math.floor(h / 24)} ימים`;
}

const wooAdminLink = (wooOrderId) =>
  `https://iconair.co.il/wp-admin/admin.php?page=wc-orders&action=edit&id=${wooOrderId}`;

function itemsSummary(items = []) {
  if (!items.length) return '—';
  const [first, ...rest] = items;
  const head = `${first.name}${Number(first.quantity) > 1 ? ` ×${first.quantity}` : ''}`;
  return rest.length ? `${head} ועוד ${rest.length}` : head;
}

function isToday(value) {
  if (!value) return false;
  const d = new Date(value);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

export default function WebOrdersScreen() {
  const { profile, isAdmin } = useAuth();
  const [search, setSearch] = useState('');
  const [handling, setHandling] = useState('');
  const [includeUnpaid, setIncludeUnpaid] = useState(false);
  const [soundOn, setSoundOn] = useState(isOrderSoundEnabled);
  const [openOrderId, setOpenOrderId] = useState(null);

  const orders = useQuery(() => listWebOrders({ includeUnpaid }), [includeUnpaid]);
  useRealtime(['web_orders'], orders.refetch);

  // phase53: הזמנות שלא שולמו — פאנל הצלה נפרד, תמיד גלוי (גם בלי "כולל לא שולמו")
  const unpaid = useQuery(listUnpaidWebOrders, []);
  useRealtime(['web_orders'], unpaid.refetch);

  const rows = orders.data ?? [];

  const stats = useMemo(() => {
    const real = rows.filter((o) => o.notified_at);
    const today = real.filter((o) => isToday(o.order_date ?? o.created_at) && o.handling_status !== 'cancelled');
    return {
      fresh: real.filter((o) => o.handling_status === 'new').length,
      inProgress: real.filter((o) => o.handling_status === 'in_progress').length,
      todayCount: today.length,
      todayTotal: today.reduce((sum, o) => sum + Number(o.total ?? 0), 0),
    };
  }, [rows]);

  const filtered = useMemo(() => {
    let list = rows;
    if (handling) list = list.filter((o) => o.handling_status === handling);
    if (search.trim()) {
      const needle = search.trim().toLowerCase();
      list = list.filter((o) =>
        [o.order_number, o.customer_name, o.phone, o.city, o.email]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(needle))
      );
    }
    return list;
  }, [rows, handling, search]);

  // תמיד מציגים את הגרסה העדכנית מהרשימה (רילטיים), לא עותק שנשמר בפתיחה
  const openOrder = useMemo(
    () => rows.find((o) => o.id === openOrderId) ?? (unpaid.data ?? []).find((o) => o.id === openOrderId) ?? null,
    [rows, unpaid.data, openOrderId]
  );

  async function changeHandling(order, next) {
    try {
      await updateWebOrder(order.id, { handling_status: next, handled_by: profile?.id ?? null });
      orders.refetch();
      unpaid.refetch();
    } catch (caught) {
      window.alert(describeError(caught));
    }
  }

  function toggleSound() {
    const next = !soundOn;
    setSoundOn(next);
    setOrderSoundEnabled(next);
    if (next) playOrderChime({ force: true });
  }

  const columns = [
    {
      key: 'order',
      label: 'הזמנה',
      width: '112px',
      render: (o) => (
        <div className="min-w-0">
          <div className="tabular font-mono text-[14.5px] font-bold text-text">#{o.order_number ?? o.woo_order_id}</div>
          <div className="tabular text-[13px] text-text-faint">{formatDateTime(o.order_date ?? o.created_at)}</div>
        </div>
      ),
    },
    {
      key: 'customer',
      label: 'לקוח',
      width: 'minmax(120px,1.1fr)',
      render: (o) => (
        <div className="min-w-0">
          <div className="truncate font-semibold">{o.customer_name ?? '—'}</div>
          {o.city && <div className="truncate text-[13px] text-text-faint">{o.city}</div>}
        </div>
      ),
    },
    {
      key: 'phone',
      label: 'טלפון',
      width: '132px',
      render: (o) => (o.phone ? (
        <a
          href={telHref(o.phone)}
          onClick={(event) => event.stopPropagation()}
          dir="ltr"
          className="tabular inline-flex items-center gap-1.5 font-mono text-[14px] text-gold-600 hover:underline"
        >
          <PhoneIcon className="h-3.5 w-3.5 flex-none" />
          {o.phone}
        </a>
      ) : '—'),
    },
    {
      key: 'items',
      label: 'מוצרים',
      width: 'minmax(140px,1.4fr)',
      render: (o) => <span className="text-[14px] text-text-dim">{itemsSummary(o.items)}</span>,
    },
    {
      key: 'total',
      label: 'סכום',
      width: '92px',
      render: (o) => <span className="tabular font-display text-[16px] font-bold text-gold-600">{money(o.total)}</span>,
    },
    {
      key: 'payment',
      label: 'באתר',
      width: '150px',
      render: (o) => {
        const s = wooStatus(o.woo_status);
        return <StatusChip tone={s.tone}>{s.label}</StatusChip>;
      },
    },
    {
      key: 'handling',
      label: 'טיפול',
      width: '128px',
      render: (o) => (
        <Select
          value={o.handling_status}
          onChange={(event) => changeHandling(o, event.target.value)}
          options={HANDLING_OPTIONS}
          className="!w-auto min-w-[112px] !py-1.5 text-[13.5px]"
          onClick={(event) => event.stopPropagation()}
          aria-label="סטטוס טיפול"
        />
      ),
    },
  ];

  return (
    <>
      <ScreenToolbar
        search={search}
        onSearch={setSearch}
        searchPlaceholder="חיפוש לפי מספר הזמנה, שם, טלפון או עיר…"
        count={filtered.length}
        countLabel="הזמנות"
        filters={[
          { key: 'handling', value: handling, onChange: setHandling, placeholder: 'כל סטטוסי הטיפול', options: HANDLING_OPTIONS },
        ]}
        extra={
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setIncludeUnpaid((v) => !v)}
              className={`rounded-pill border px-3 py-2.5 text-[13.5px] font-semibold transition-colors ${
                includeUnpaid
                  ? 'border-gold-300/[0.4] bg-gold-500/[0.14] text-gold-600'
                  : 'border-black/[0.09] text-text-faint hover:border-gold-500/35 hover:text-gold-600'
              }`}
              title="הצג גם הזמנות שלא הושלם בהן תשלום (נטישה בעמוד האשראי)"
            >
              כולל לא שולמו
            </button>
            <button
              type="button"
              onClick={toggleSound}
              className={`inline-flex items-center gap-1.5 rounded-pill border px-3 py-2.5 text-[13.5px] font-semibold transition-colors ${
                soundOn
                  ? 'border-gold-300/[0.4] bg-gold-500/[0.14] text-gold-600'
                  : 'border-black/[0.09] text-text-faint hover:border-gold-500/35 hover:text-gold-600'
              }`}
              title="צליל התראה כשנכנסת הזמנה חדשה (במכשיר הזה)"
            >
              <BellIcon className="h-3.5 w-3.5" />
              {soundOn ? 'צליל פעיל' : 'צליל כבוי'}
            </button>
          </div>
        }
      />

      <UnpaidPanel
        orders={unpaid.data ?? []}
        onOpen={(o) => setOpenOrderId(o.id)}
        onMark={changeHandling}
      />

      <div className="mb-3.5 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <StatTile label="חדשות לטיפול" value={stats.fresh} tone={stats.fresh > 0 ? 'crit' : 'dim'} />
        <StatTile label="בטיפול" value={stats.inProgress} tone="gold" />
        <StatTile label="הזמנות היום" value={stats.todayCount} tone="dim" />
        <StatTile label="מכירות היום" value={money(stats.todayTotal)} tone="gold" />
      </div>

      <GlassCard>
        <CardHead
          icon={CartIcon}
          tone="gold"
          title="הזמנות אתר"
          subtitle="נקלטות אוטומטית מ-iconair.co.il ברגע התשלום — עם התראה לצוות"
        />
        <Async
          loading={orders.loading}
          error={orders.error}
          onRetry={orders.refetch}
          isEmpty={filtered.length === 0}
          empty={
            <EmptyState
              title={search || handling ? 'אין הזמנה שתואמת את הסינון' : 'עוד לא נכנסו הזמנות מהאתר'}
              hint="כל הזמנה ששולמה באתר (או ממתינה להעברה בנקאית/ביט) מופיעה כאן תוך שניות, עם צליל והתראה."
            />
          }
        >
          <div className="overflow-x-auto">
            <DataTable
              columns={columns}
              rows={filtered}
              rowKey={(o) => o.id}
              onRowClick={(o) => setOpenOrderId(o.id)}
              actions={(o) => (
                <button
                  type="button"
                  onClick={(event) => { event.stopPropagation(); setOpenOrderId(o.id); }}
                  className="ghost-btn whitespace-nowrap px-2.5 py-2 text-[13.5px]"
                >
                  פרטים
                </button>
              )}
            />
          </div>
        </Async>
      </GlassCard>

      <OrderModal
        order={openOrder}
        isAdmin={isAdmin}
        onClose={() => setOpenOrderId(null)}
        onChangeHandling={changeHandling}
        onSaved={orders.refetch}
        onDeleted={() => { setOpenOrderId(null); orders.refetch(); }}
      />
    </>
  );
}

function StatTile({ label, value, tone = 'dim' }) {
  const color = { crit: 'text-crit', gold: 'text-gold-600', dim: 'text-text' }[tone] ?? 'text-text';
  return (
    <div className="glass rounded-panel px-4 py-3.5">
      <div className="text-[12.5px] font-semibold uppercase tracking-[1.1px] text-text-faint">{label}</div>
      <div className={`tabular mt-1 font-display text-[26px] font-bold leading-none ${color}`}>{value}</div>
    </div>
  );
}

function InfoRow({ label, children }) {
  if (children == null || children === '' || children === false) return null;
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5 text-[15px]">
      <span className="flex-none text-text-faint">{label}</span>
      <span className="min-w-0 text-end font-medium text-text">{children}</span>
    </div>
  );
}

function OrderModal({ order, isAdmin, onClose, onChangeHandling, onSaved, onDeleted }) {
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (order) {
      setNotes(order.internal_notes ?? '');
      setError(null);
    }
    // רק כשנפתחת הזמנה אחרת — לא בכל עדכון רילטיים, כדי לא לדרוס הקלדה
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order?.id]);

  if (!order) return null;

  const s = wooStatus(order.woo_status);
  const fullAddress = [order.address, order.city].filter(Boolean).join(', ');
  const waze = wazeLink(fullAddress);
  const whatsapp = whatsappHref(order.phone);

  async function saveNotes() {
    setBusy(true);
    setError(null);
    try {
      await updateWebOrder(order.id, { internal_notes: notes.trim() || null });
      onSaved();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm(`למחוק את הזמנה #${order.order_number} מהמערכת? (ההזמנה באתר עצמו לא תימחק)`)) return;
    try {
      await deleteWebOrder(order.id);
      onDeleted();
    } catch (caught) {
      setError(describeError(caught));
    }
  }

  return (
    <Modal
      open={Boolean(order)}
      title={`הזמנה #${order.order_number ?? order.woo_order_id}`}
      subtitle={`${formatDateTime(order.order_date ?? order.created_at)} · ${order.customer_name ?? 'לקוח'}`}
      onClose={onClose}
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <StatusChip tone={s.tone}>{s.label}</StatusChip>
          {order.payment_method && <StatusChip tone="slate">{order.payment_method}</StatusChip>}
          {order.shipping_method && <StatusChip tone="teal">{order.shipping_method}</StatusChip>}
        </div>

        {/* ראשון בכוונה: Modal ממקד את השדה הראשון — כך החלון נפתח מלמעלה */}
        <Field label="סטטוס טיפול">
          <Select
            value={order.handling_status}
            onChange={(event) => onChangeHandling(order, event.target.value)}
            options={HANDLING_OPTIONS}
          />
        </Field>

        {order.woo_status === 'pending' && order.pay_url && (
          <div className="rounded-row border border-crit/25 bg-crit/[0.06] px-4 py-3">
            <div className="text-[14.5px] font-bold text-crit-soft">ההזמנה לא שולמה</div>
            <div className="mt-1 text-[13.5px] text-text-dim">שלח ללקוח קישור להשלמת התשלום של ההזמנה הזו בדיוק.</div>
            <div className="mt-2.5 flex flex-wrap gap-2">
              {whatsappPayHref(order) && (
                <a href={whatsappPayHref(order)} target="_blank" rel="noreferrer"
                   className="rounded-pill bg-gold-500 px-3.5 py-2 text-[14px] font-extrabold text-slate-950 hover:bg-amber-600">
                  וואטסאפ עם קישור תשלום
                </a>
              )}
              <CopyLinkButton url={order.pay_url} />
            </div>
          </div>
        )}

        {/* פעולות מהירות — חיוג / וואטסאפ / ניווט */}
        <div className="grid grid-cols-3 gap-2">
          {order.phone ? (
            <a href={telHref(order.phone)} className="ghost-btn flex items-center justify-center gap-1.5 py-2.5 text-[14px]">
              <PhoneIcon className="h-4 w-4" /> חיוג
            </a>
          ) : <span />}
          {whatsapp ? (
            <a href={whatsapp} target="_blank" rel="noreferrer" className="ghost-btn flex items-center justify-center py-2.5 text-[14px]">
              וואטסאפ
            </a>
          ) : <span />}
          {waze ? (
            <a href={waze} target="_blank" rel="noreferrer" className="ghost-btn flex items-center justify-center py-2.5 text-[14px]">
              Waze
            </a>
          ) : <span />}
        </div>

        <div className="inner-row px-4 py-2">
          <InfoRow label="לקוח">{order.customer_name}</InfoRow>
          <InfoRow label="טלפון">{order.phone && <span dir="ltr" className="tabular font-mono">{order.phone}</span>}</InfoRow>
          <InfoRow label="אימייל">{order.email && <span dir="ltr" className="break-all text-[14px]">{order.email}</span>}</InfoRow>
          <InfoRow label="כתובת">{fullAddress}</InfoRow>
          <InfoRow label="מיקוד">{order.postcode}</InfoRow>
        </div>

        <div>
          <div className="mb-2 text-[13px] font-semibold uppercase tracking-[0.8px] text-text-faint">מוצרים</div>
          <div className="flex flex-col gap-2">
            {(order.items ?? []).map((item, index) => (
              <div key={`${item.product_id}-${item.variation_id ?? 0}-${index}`} className="inner-row flex items-start gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">{item.name}</div>
                  {(item.options ?? []).length > 0 && (
                    <div className="mt-0.5 text-[13.5px] text-text-faint">
                      {item.options.map((opt) => `${opt.key}: ${opt.value}`).join(' · ')}
                    </div>
                  )}
                  {item.sku && <div className="mt-0.5 font-mono text-[12.5px] text-text-faint">{item.sku}</div>}
                </div>
                <div className="tabular flex-none text-end">
                  <div className="text-[13.5px] text-text-faint">×{item.quantity}</div>
                  <div className="font-bold">{money(item.total)}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="inner-row px-4 py-2">
          <InfoRow label="סכום ביניים">{order.subtotal != null && money(order.subtotal)}</InfoRow>
          <InfoRow label="הנחה">
            {Number(order.discount_total) > 0 && `−${money(order.discount_total)}${order.coupons?.length ? ` (${order.coupons.join(', ')})` : ''}`}
          </InfoRow>
          <InfoRow label="משלוח">{order.shipping_total != null && (Number(order.shipping_total) > 0 ? money(order.shipping_total) : 'חינם')}</InfoRow>
          <div className="flex items-baseline justify-between gap-3 border-t border-black/[0.075] pt-2.5 pb-1">
            <span className="font-bold text-text-dim">סה״כ</span>
            <span className="tabular font-display text-[22px] font-bold text-gold-600">{money(order.total)}</span>
          </div>
        </div>

        {order.customer_note && (
          <div className="rounded-row border border-gold-300/[0.3] bg-gold-500/[0.08] px-4 py-3 text-[14.5px]">
            <span className="font-bold text-gold-600">הערת לקוח: </span>
            {order.customer_note}
          </div>
        )}

        <Field label="הערות פנימיות לצוות" hint="לא נשלח ללקוח — למשל מי מטפל, מספר משלוח, תיאום התקנה">
          <TextArea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} />
        </Field>

        {error && <div className="text-[14px] text-crit-soft">{error}</div>}

        <div className="flex flex-wrap gap-2.5">
          <PrimaryButton onClick={saveNotes} loading={busy} disabled={(order.internal_notes ?? '') === notes}>
            שמירת הערות
          </PrimaryButton>
          <a href={wooAdminLink(order.woo_order_id)} target="_blank" rel="noreferrer" className="ghost-btn px-4 py-3 text-[15px]">
            פתיחה בווקומרס
          </a>
          <SecondaryButton onClick={onClose}>סגירה</SecondaryButton>
          {isAdmin && (
            <button
              type="button"
              onClick={remove}
              className="ms-auto rounded-pill px-3 py-3 text-[14px] font-semibold text-crit-soft hover:bg-crit/[0.07]"
            >
              מחיקה מהמערכת
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}

function CopyLinkButton({ url }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt('העתק את קישור התשלום:', url);
    }
  }
  return (
    <button type="button" onClick={copy} className="ghost-btn px-3 py-2 text-[13.5px]">
      {copied ? 'הועתק ✓' : 'העתקת קישור תשלום'}
    </button>
  );
}

/**
 * phase53 — "להתקשר עכשיו": הזמנות שהלקוח התחיל ולא שילם (נתקע בעמוד
 * iCredit). לפי האבחון, 42% מההזמנות נפלו כאן; שיחה או וואטסאפ עם קישור
 * תשלום בשעה הראשונה הם הדרך הכי מהירה להחזיר את הכסף.
 */
function UnpaidPanel({ orders, onOpen, onMark }) {
  if (!orders.length) return null;
  const total = orders.reduce((sum, o) => sum + Number(o.total ?? 0), 0);

  return (
    <GlassCard className="mb-3.5 border-crit/30">
      <CardHead
        icon={PhoneIcon}
        tone="crit"
        title={`ממתינות לתשלום — להתקשר עכשיו (${orders.length})`}
        subtitle={`לקוחות שהתחילו הזמנה ולא השלימו תשלום · ${money(total)} על השולחן`}
      />
      <div className="flex flex-col gap-2.5">
        {orders.map((o) => (
          <div key={o.id} className="inner-row flex flex-wrap items-center gap-x-4 gap-y-2.5 px-4 py-3.5">
            <button type="button" onClick={() => onOpen(o)} className="min-w-0 flex-1 text-start">
              <div className="flex flex-wrap items-baseline gap-x-2.5">
                <span className="tabular font-mono text-[14px] font-bold">#{o.order_number}</span>
                <span className="font-semibold">{o.customer_name ?? 'לקוח'}</span>
                <span className="tabular font-display text-[16px] font-bold text-gold-600">{money(o.total)}</span>
                <span className={`text-[13px] font-semibold ${minutesSince(o.order_date ?? o.created_at) >= 10 ? 'text-crit' : 'text-text-faint'}`}>
                  {agoLabel(o.order_date ?? o.created_at)}
                </span>
              </div>
              <div className="mt-0.5 truncate text-[13.5px] text-text-faint">{itemsSummary(o.items)}{o.city ? ` · ${o.city}` : ''}</div>
            </button>
            <div className="flex flex-wrap gap-2">
              {o.phone && (
                <a href={telHref(o.phone)} className="ghost-btn flex items-center gap-1.5 px-3 py-2 text-[13.5px]">
                  <PhoneIcon className="h-3.5 w-3.5" /> חיוג
                </a>
              )}
              {whatsappPayHref(o) && (
                <a href={whatsappPayHref(o)} target="_blank" rel="noreferrer"
                   className="rounded-pill bg-gold-500 px-3 py-2 text-[13.5px] font-extrabold text-slate-950 hover:bg-amber-600">
                  וואטסאפ + קישור תשלום
                </a>
              )}
              <button type="button" onClick={() => onMark(o, 'in_progress')} className="ghost-btn px-3 py-2 text-[13.5px]">
                בטיפול
              </button>
              <button type="button" onClick={() => onMark(o, 'cancelled')}
                      className="rounded-pill px-2.5 py-2 text-[13px] font-semibold text-text-faint hover:text-crit-soft">
                לא רלוונטי
              </button>
            </div>
          </div>
        ))}
      </div>
    </GlassCard>
  );
}
