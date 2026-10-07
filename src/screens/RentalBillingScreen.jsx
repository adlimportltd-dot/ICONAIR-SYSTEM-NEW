import { useMemo, useState } from 'react';
import GlassCard, { CardHead } from '../components/ui/GlassCard';
import DataTable, { StatusChip } from '../components/ui/DataTable';
import { Field, TextInput, Select, PrimaryButton, SecondaryButton } from '../components/ui/Field';
import { Async, EmptyState } from '../components/ui/States';
import { TagIcon, ChartIcon, PlusIcon, TrashIcon } from '../components/ui/Icons';
import { useQuery } from '../hooks/useQuery';
import { useAuth } from '../context/AuthContext';
import { supabase, describeError } from '../lib/supabase';

/*
 * חשבוניות שכירות (phase55, 2026-10-06 — בקשה מפורשת של ליאור):
 * חשבונית חודשית ללקוחות שכירות (אוורסט) מתוך מצבת המכשירים במערכת,
 * עם השוואה לחודש הקודם והפקה בריווחית בלחיצה.
 *
 * זרימה: הכן טיוטה → בדיקה מול ריווחית (check_only) → אשר → הפק בריווחית.
 * כללי החיוב (ב-SQL, compute_rental_billing):
 *   הותקן עד ה-15 = חודש מלא · מה-16 = חצי חודש · הוסר באמצע החודש = חודש מלא.
 * חשבונית שהופקה ננעלת. בלי מספר הקצאה — אזהרה אדומה, לא שולחים לאוורסט.
 */

const RUN_STATUS = {
  draft: { label: 'טיוטה', tone: 'warn' },
  approved: { label: 'מאושרת להפקה', tone: 'gold' },
  issued: { label: 'הופקה בריווחית', tone: 'ok' },
  failed: { label: 'נכשלה', tone: 'crit' },
};

const CHANGE_TONE = { 'נוסף': 'ok', 'הוסר': 'crit', 'השתנה': 'warn' };

const CHARGE_KINDS = [
  { value: 'theft', label: 'גניבת מכשיר' },
  { value: 'purchase', label: 'רכישה' },
  { value: 'repair', label: 'תיקון בתשלום' },
  { value: 'other', label: 'אחר' },
];

const WARNING_TEXT = {
  no_price: 'מכשיר בלי מחיר — לא נכנס לחשבונית',
  offline_not_billed: 'מכשיר "לא מחובר" — לא מחויב',
  no_site: 'מכשיר בלי בניין',
  no_install_date: 'מכשיר בלי תאריך התקנה — מחויב חודש מלא',
};

const money = (value) =>
  `₪${Number(value ?? 0).toLocaleString('he-IL', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

const qty = (value) => Number(value ?? 0).toLocaleString('he-IL', { maximumFractionDigits: 2 });

const MONTH_NAMES = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];

/** החודש הנוכחי + 12 החודשים האחרונים, ברירת מחדל = החודש הקודם (החשבונית יוצאת ב-1 לחודש על החודש שעבר) */
function monthOptions() {
  const now = new Date();
  return Array.from({ length: 13 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
    return { value, label: `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}` };
  });
}

async function listBillingCustomers() {
  const { data, error } = await supabase
    .from('customers')
    .select('id, name, rivhit_customer_id')
    .eq('monthly_billing', true)
    .order('name');
  if (error) throw error;
  return data ?? [];
}

async function loadMonth(customerId, month) {
  const { data: run, error } = await supabase
    .from('billing_runs')
    .select('*')
    .eq('customer_id', customerId)
    .eq('period_month', month)
    .maybeSingle();
  if (error) throw error;

  const { data: charges, error: chargesError } = await supabase
    .from('rental_charges')
    .select('id, kind, description, quantity, unit_price')
    .eq('customer_id', customerId)
    .eq('billing_month', month)
    .order('created_at');
  if (chargesError) throw chargesError;

  if (!run) return { run: null, lines: [], compare: [], charges: charges ?? [] };

  const [{ data: lines, error: linesError }, { data: compare, error: compareError }] = await Promise.all([
    supabase.from('billing_lines').select('*').eq('run_id', run.id).order('line_no'),
    supabase.rpc('billing_compare', { p_run: run.id }),
  ]);
  if (linesError) throw linesError;
  if (compareError) throw compareError;

  return { run, lines: lines ?? [], compare: compare ?? [], charges: charges ?? [] };
}

async function invokeRivhit(action, runId) {
  // פונקציית ההפקה בריווחית נפרסה ב-Supabase בשם bright-action
  const { data, error } = await supabase.functions.invoke('bright-action', { body: { action, run_id: runId } });
  if (error) {
    // השגיאה האמיתית מהפונקציה נמצאת בגוף התשובה
    let message = error.message;
    try {
      const body = await error.context?.json?.();
      message = body?.error || body?.message || message;
    } catch { /* נשאר עם ההודעה הכללית */ }
    throw new Error(message);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

export default function RentalBillingScreen() {
  const { profile } = useAuth();
  const months = useMemo(monthOptions, []);
  const [month, setMonth] = useState(months[1].value);
  const [customerId, setCustomerId] = useState('');
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState(null);
  const [showUnchanged, setShowUnchanged] = useState(false);

  const customers = useQuery(listBillingCustomers, []);
  const activeCustomerId = customerId || customers.data?.[0]?.id || '';
  const activeCustomer = (customers.data ?? []).find((c) => c.id === activeCustomerId);

  const monthData = useQuery(
    () => (activeCustomerId ? loadMonth(activeCustomerId, month) : Promise.resolve(null)),
    [activeCustomerId, month]
  );

  const run = monthData.data?.run ?? null;
  const lines = monthData.data?.lines ?? [];
  const compare = monthData.data?.compare ?? [];
  const charges = monthData.data?.charges ?? [];
  const status = run ? RUN_STATUS[run.status] ?? RUN_STATUS.draft : null;
  const locked = run?.status === 'issued';
  const monthLabel = months.find((m) => m.value === month)?.label ?? month;

  const stats = useMemo(() => {
    const units = lines.filter((l) => l.kind !== 'charge').reduce((s, l) => s + Number(l.quantity), 0);
    const changes = compare.filter((c) => c.change !== 'ללא שינוי');
    const diffTotal = compare.reduce((s, c) => s + Number(c.diff_total ?? 0), 0);
    const hasPrev = compare.some((c) => Number(c.prev_qty) > 0);
    // סיכום לפי דגם — עובד גם מול חשבונית ידנית ישנה עם שמות שורות אחרים
    const byModel = new Map();
    compare.forEach((c) => {
      const key = c.model || 'חיובים חד-פעמיים';
      const m = byModel.get(key) ?? { model: key, prev_qty: 0, curr_qty: 0, prev_total: 0, curr_total: 0 };
      m.prev_qty += Number(c.prev_qty ?? 0);
      m.curr_qty += Number(c.curr_qty ?? 0);
      m.prev_total += Number(c.prev_total ?? 0);
      m.curr_total += Number(c.curr_total ?? 0);
      byModel.set(key, m);
    });
    const models = [...byModel.values()]
      .map((m) => ({ ...m, diff_qty: m.curr_qty - m.prev_qty, diff_total: m.curr_total - m.prev_total }))
      .sort((a, b) => a.model.localeCompare(b.model, 'he', { numeric: true }));
    return { units, changes, diffTotal, hasPrev, models };
  }, [lines, compare]);


  async function act(key, fn, successText) {
    setBusy(key);
    setNotice(null);
    try {
      const result = await fn();
      if (successText) setNotice({ tone: 'ok', text: typeof successText === 'function' ? successText(result) : successText });
      monthData.refetch();
    } catch (caught) {
      setNotice({ tone: 'crit', text: describeError(caught) });
      monthData.refetch();
    } finally {
      setBusy('');
    }
  }

  const buildDraft = () =>
    act('build', async () => {
      const { error } = await supabase.rpc('build_billing_draft', { p_customer: activeCustomerId, p_month: month });
      if (error) throw error;
    }, 'הטיוטה הוכנה מהנתונים העדכניים במערכת');

  const checkRivhit = () =>
    act('check', () => invokeRivhit('check', run.id), (r) => r?.message || 'ריווחית אישרה שהחשבונית תקינה');

  const approve = () =>
    act('approve', async () => {
      const { error } = await supabase
        .from('billing_runs')
        .update({ status: 'approved', approved_by: profile?.id ?? null, approved_at: new Date().toISOString() })
        .eq('id', run.id);
      if (error) throw error;
    }, 'החשבונית אושרה. אפשר להפיק בריווחית');

  const unapprove = () =>
    act('unapprove', async () => {
      const { error } = await supabase.from('billing_runs').update({ status: 'draft' }).eq('id', run.id);
      if (error) throw error;
    }, 'האישור בוטל — החשבונית חזרה לטיוטה');

  const issue = () => {
    // הגנה: לא מפיקים חשבונית על החודש הנוכחי שעוד לא נגמר
    if (month >= months[0].value) {
      window.alert('החודש עוד לא הסתיים — את החשבונית מפיקים רק מה-1 לחודש הבא.');
      return;
    }
    const ok = window.confirm(
      `להפיק חשבונית מס אמיתית בריווחית?\n\n${activeCustomer?.name ?? ''}\n${monthLabel}\nסה"כ לתשלום: ${money(run.total)}\n\nאחרי ההפקה אי אפשר לשנות את החשבונית.`
    );
    if (!ok) return;
    act('issue', () => invokeRivhit('issue', run.id), (r) =>
      r?.allocation_number
        ? `חשבונית ${r.document_number} הופקה בהצלחה, מספר הקצאה ${r.allocation_number}`
        : `חשבונית ${r?.document_number} הופקה — אבל חסר מספר הקצאה! לא לשלוח לפני בירור`
    );
  };

  async function addCharge(charge) {
    await act('charge', async () => {
      const { error } = await supabase.from('rental_charges').insert({
        customer_id: activeCustomerId,
        billing_month: month,
        kind: charge.kind,
        description: charge.description,
        quantity: Number(charge.quantity),
        unit_price: Number(charge.unit_price),
      });
      if (error) throw error;
      if (run && !locked) {
        const { error: rebuildError } = await supabase.rpc('build_billing_draft', { p_customer: activeCustomerId, p_month: month });
        if (rebuildError) throw rebuildError;
      }
    }, run && !locked ? 'החיוב נוסף והטיוטה עודכנה' : 'החיוב נוסף — הוא ייכנס כשתכין טיוטה');
  }

  async function removeCharge(id) {
    if (!window.confirm('למחוק את החיוב הזה?')) return;
    await act('charge', async () => {
      const { error } = await supabase.from('rental_charges').delete().eq('id', id);
      if (error) throw error;
      if (run && !locked) {
        const { error: rebuildError } = await supabase.rpc('build_billing_draft', { p_customer: activeCustomerId, p_month: month });
        if (rebuildError) throw rebuildError;
      }
    }, 'החיוב נמחק');
  }

  const lineColumns = [
    {
      key: 'description',
      label: 'פריט',
      width: 'minmax(180px,2fr)',
      render: (l) => (
        <div className="min-w-0">
          <div className="truncate font-semibold">{l.description}</div>
          {l.kind === 'partial' && <div className="text-[13px] text-warn">חצי חודש (הותקן אחרי ה-15)</div>}
          {l.kind === 'charge' && <div className="text-[13px] text-gold-600">חיוב חד-פעמי</div>}
        </div>
      ),
    },
    { key: 'quantity', label: 'כמות', width: '72px', render: (l) => <span className="tabular font-bold">{qty(l.quantity)}</span> },
    { key: 'unit', label: 'מחיר ליחידה', width: '104px', render: (l) => <span className="tabular text-text-dim">{money(l.unit_price)}</span> },
    { key: 'total', label: 'סה"כ', width: '104px', render: (l) => <span className="tabular font-bold text-gold-600">{money(l.line_total)}</span> },
  ];

  const compareColumns = [
    {
      key: 'site',
      label: 'בניין / דגם',
      width: 'minmax(160px,2fr)',
      render: (c) => (
        <div className="min-w-0">
          <div className="truncate font-semibold">{c.site_label}</div>
          {c.model && <div className="text-[13px] text-text-faint">{c.model}</div>}
        </div>
      ),
    },
    { key: 'prev', label: 'חודש קודם', width: '88px', render: (c) => <span className="tabular text-text-dim">{qty(c.prev_qty)}</span> },
    { key: 'curr', label: 'החודש', width: '76px', render: (c) => <span className="tabular font-bold">{qty(c.curr_qty)}</span> },
    {
      key: 'diff',
      label: 'הפרש ₪',
      width: '96px',
      render: (c) => {
        const d = Number(c.diff_total ?? 0);
        return <span className={`tabular font-bold ${d > 0 ? 'text-ok' : d < 0 ? 'text-crit' : 'text-text-faint'}`}>{d > 0 ? '+' : ''}{money(d)}</span>;
      },
    },
    { key: 'change', label: 'מצב', width: '96px', render: (c) => <StatusChip tone={CHANGE_TONE[c.change] ?? 'neutral'}>{c.change}</StatusChip> },
  ];

  const modelColumns = [
    { key: 'model', label: 'דגם', width: 'minmax(120px,1.4fr)', render: (m) => <span className="font-semibold">{m.model}</span> },
    { key: 'prev', label: 'חודש קודם', width: '88px', render: (m) => <span className="tabular text-text-dim">{qty(m.prev_qty)}</span> },
    { key: 'curr', label: 'החודש', width: '76px', render: (m) => <span className="tabular font-bold">{qty(m.curr_qty)}</span> },
    {
      key: 'dq',
      label: 'הפרש יח׳',
      width: '84px',
      render: (m) => (
        <span className={`tabular font-bold ${m.diff_qty > 0 ? 'text-ok' : m.diff_qty < 0 ? 'text-crit' : 'text-text-faint'}`}>
          {m.diff_qty > 0 ? '+' : ''}{qty(m.diff_qty)}
        </span>
      ),
    },
    {
      key: 'dt',
      label: 'הפרש ₪',
      width: '104px',
      render: (m) => (
        <span className={`tabular font-bold ${m.diff_total > 0 ? 'text-ok' : m.diff_total < 0 ? 'text-crit' : 'text-text-faint'}`}>
          {m.diff_total > 0 ? '+' : ''}{money(m.diff_total)}
        </span>
      ),
    },
  ];

  const warnings = Array.isArray(run?.warnings) ? run.warnings : [];

  return (
    <>
      {/* בחירת לקוח וחודש */}
      <div className="mb-3.5 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
        <Select
          value={activeCustomerId}
          onChange={(event) => { setCustomerId(event.target.value); setNotice(null); }}
          options={(customers.data ?? []).map((c) => ({ value: c.id, label: c.name }))}
          aria-label="לקוח"
        />
        <Select
          value={month}
          onChange={(event) => { setMonth(event.target.value); setNotice(null); }}
          options={months}
          aria-label="חודש חיוב"
        />
        <div className="flex items-center gap-2">
          {status && <StatusChip tone={status.tone}>{status.label}</StatusChip>}
          {activeCustomer?.rivhit_customer_id && (
            <span className="text-[13.5px] text-text-faint">לקוח בריווחית: {activeCustomer.rivhit_customer_id}</span>
          )}
        </div>
      </div>

      {notice && (
        <div className={`mb-3.5 rounded-panel border px-4 py-3 text-[15px] font-semibold ${
          notice.tone === 'ok' ? 'border-ok/25 bg-ok/10 text-ok' : 'border-crit/30 bg-crit/10 text-crit'
        }`}>
          {notice.text}
        </div>
      )}

      <Async
        loading={customers.loading || monthData.loading}
        error={customers.error || monthData.error}
        onRetry={() => { customers.refetch(); monthData.refetch(); }}
        isEmpty={!customers.loading && (customers.data ?? []).length === 0}
        empty={<EmptyState title="אין לקוחות עם חיוב חודשי" hint="מסמנים לקוח לחיוב חודשי בעמודה monthly_billing בטבלת customers." />}
      >
        {/* מספרים עיקריים */}
        <div className="mb-3.5 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <StatTile label="יחידות מחויבות" value={qty(stats.units)} />
          <StatTile label='סה"כ לפני מע"מ' value={money(run?.subtotal)} tone="gold" />
          <StatTile label='לתשלום כולל מע"מ' value={money(run?.total)} tone="gold" />
          <StatTile
            label="שינוי מול חודש קודם"
            value={stats.hasPrev ? `${stats.diffTotal > 0 ? '+' : ''}${money(stats.diffTotal)}` : '—'}
            tone={stats.diffTotal < 0 ? 'crit' : 'dim'}
          />
        </div>

        {/* פעולות */}
        <GlassCard className="mb-3.5">
          <CardHead
            icon={TagIcon}
            tone="gold"
            title={`חשבונית ${monthLabel}`}
            subtitle="הכן טיוטה ← בדיקה מול ריווחית ← אשר ← הפק. שום דבר לא יוצא לריווחית בלי האישור שלך."
          />

          {locked ? (
            <IssuedPanel run={run} />
          ) : (
            <div className="flex flex-wrap gap-2.5">
              {run?.status !== 'approved' && (
                <SecondaryButton onClick={buildDraft} disabled={!!busy}>
                  {busy === 'build' ? 'מכין…' : run ? 'רענן טיוטה מהנתונים' : 'הכן טיוטה'}
                </SecondaryButton>
              )}
              {run && (
                <SecondaryButton onClick={checkRivhit} disabled={!!busy}>
                  {busy === 'check' ? 'בודק…' : 'בדיקה מול ריווחית'}
                </SecondaryButton>
              )}
              {run?.status === 'draft' && (
                <PrimaryButton onClick={approve} loading={busy === 'approve'} disabled={!!busy}>
                  אשר חשבונית
                </PrimaryButton>
              )}
              {run?.status === 'approved' && (
                <>
                  <SecondaryButton onClick={unapprove} disabled={!!busy}>בטל אישור</SecondaryButton>
                  <PrimaryButton onClick={issue} disabled={!!busy}>
                    {busy === 'issue' ? 'מפיק בריווחית…' : 'הפק חשבונית בריווחית'}
                  </PrimaryButton>
                </>
              )}
            </div>
          )}

          {run?.error_message && !locked && (
            <div className="mt-3 rounded-panel border border-crit/30 bg-crit/10 px-4 py-2.5 text-[14.5px] font-semibold text-crit">
              {run.error_message}
            </div>
          )}

          {warnings.length > 0 && (
            <div className="mt-4 flex flex-col gap-1.5">
              <div className="text-[14px] font-bold text-warn">אזהרות לבדיקה ({warnings.length})</div>
              {warnings.map((w, i) => (
                <div key={`${w.device_id}-${i}`} className="inner-row px-3.5 py-2 text-[14px]">
                  <span className="font-semibold text-text">{WARNING_TEXT[w.type] ?? w.type}</span>
                  <span className="text-text-faint"> · {[w.site, w.model].filter(Boolean).join(' · ')}</span>
                </div>
              ))}
            </div>
          )}
        </GlassCard>

        {/* השוואה לחודש קודם */}
        {run && (
          <GlassCard className="mb-3.5">
            <CardHead
              icon={ChartIcon}
              tone="teal"
              title="השוואה לחודש הקודם"
              subtitle={stats.hasPrev
                ? 'לפי דגם, מול החשבונית האחרונה שהופקה'
                : 'אין עדיין חשבונית קודמת במערכת — ההשוואה תתחיל מהחודש הבא'}
              action={stats.hasPrev ? (showUnchanged ? 'הסתר פירוט לפי בניין' : 'פירוט לפי בניין') : undefined}
              onAction={() => setShowUnchanged((v) => !v)}
            />
            {stats.hasPrev ? (
              <>
                <DataTable columns={modelColumns} rows={stats.models} rowKey={(m) => m.model} />
                {showUnchanged && (
                  <div className="mt-5">
                    <div className="mb-2 text-[14px] font-bold text-text-dim">
                      פירוט לפי בניין ({stats.changes.length} שורות השתנו)
                    </div>
                    {stats.changes.length ? (
                      <DataTable columns={compareColumns} rows={stats.changes} rowKey={(c) => `${c.site_label}|${c.model}`} />
                    ) : (
                      <EmptyState title="אין שינויים ברמת הבניין" hint="אותם מכשירים, אותם מחירים." />
                    )}
                  </div>
                )}
              </>
            ) : (
              <EmptyState title="אין חשבונית קודמת להשוואה" hint="אחרי ההפקה הראשונה מהמערכת, כל חודש יושווה לקודם אוטומטית." />
            )}
          </GlassCard>
        )}

        {/* חיובים חד-פעמיים */}
        <GlassCard className="mb-3.5">
          <CardHead
            icon={PlusIcon}
            tone="gold"
            title="חיובים חד-פעמיים לחודש הזה"
            subtitle="גניבת מכשיר, רכישה, תיקון בתשלום — נכנסים לחשבונית של החודש בלבד"
          />
          {charges.length > 0 && (
            <div className="mb-3 flex flex-col gap-2">
              {charges.map((c) => (
                <div key={c.id} className="inner-row flex items-center gap-3 px-4 py-2.5 text-[15px]">
                  <span className="min-w-0 flex-1 truncate font-semibold">{c.description}</span>
                  <span className="tabular text-text-dim">{qty(c.quantity)} × {money(c.unit_price)}</span>
                  {!locked && (
                    <button type="button" onClick={() => removeCharge(c.id)} className="ghost-btn px-2.5 py-2" aria-label="מחק חיוב">
                      <TrashIcon className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
          {!locked && <ChargeForm onAdd={addCharge} busy={busy === 'charge'} />}
        </GlassCard>

        {/* שורות החשבונית */}
        {run && (
          <GlassCard>
            <CardHead
              icon={TagIcon}
              tone="gold"
              title={`שורות החשבונית (${lines.length})`}
              subtitle="כך החשבונית תיראה בריווחית"
            />
            <DataTable columns={lineColumns} rows={lines} rowKey={(l) => l.id} />
          </GlassCard>
        )}

        {!run && activeCustomerId && (
          <GlassCard>
            <EmptyState
              title={`עוד לא הוכנה חשבונית ל${monthLabel}`}
              hint='לחץ "הכן טיוטה" — המערכת תחשב את החיוב מתוך מצבת המכשירים.'
            />
          </GlassCard>
        )}
      </Async>
    </>
  );
}

function IssuedPanel({ run }) {
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[15px]">
        <span>מספר חשבונית: <b className="tabular text-text">{run.rivhit_document_number}</b></span>
        <span>
          מספר הקצאה:{' '}
          {run.allocation_number
            ? <b className="tabular text-ok">{run.allocation_number}</b>
            : <b className="text-crit">חסר!</b>}
        </span>
        {run.issued_at && <span className="text-text-faint">הופקה {new Date(run.issued_at).toLocaleString('he-IL')}</span>}
      </div>
      {!run.allocation_number && (
        <div className="rounded-panel border border-crit/30 bg-crit/10 px-4 py-2.5 text-[14.5px] font-semibold text-crit">
          לא לשלוח את החשבונית לאוורסט לפני שמספר ההקצאה מופיע בריווחית — בלעדיו הם לא יוכלו לקזז מע"מ.
        </div>
      )}
      {run.rivhit_document_link && (
        <a
          href={run.rivhit_document_link}
          target="_blank"
          rel="noreferrer"
          className="ghost-btn inline-flex w-fit px-4 py-2.5 text-[15px] font-semibold text-gold-600"
        >
          פתח את החשבונית בריווחית
        </a>
      )}
    </div>
  );
}

function ChargeForm({ onAdd, busy }) {
  const [form, setForm] = useState({ kind: 'theft', description: '', quantity: '1', unit_price: '' });
  const set = (key) => (event) => setForm((f) => ({ ...f, [key]: event.target.value }));
  const valid = form.description.trim() && Number(form.quantity) > 0 && Number(form.unit_price) > 0;

  async function submit(event) {
    event.preventDefault();
    if (!valid) return;
    await onAdd(form);
    setForm({ kind: 'theft', description: '', quantity: '1', unit_price: '' });
  }

  return (
    <form onSubmit={submit} className="grid grid-cols-1 gap-2.5 sm:grid-cols-[150px_minmax(0,1fr)_90px_120px_auto] sm:items-end">
      <Field label="סוג">
        <Select value={form.kind} onChange={set('kind')} options={CHARGE_KINDS} />
      </Field>
      <Field label="תיאור (כך יופיע בחשבונית)">
        <TextInput value={form.description} onChange={set('description')} placeholder="חביבה רייך 57 – חיוב עבור מכשיר גנוב Icon 400" />
      </Field>
      <Field label="כמות">
        <TextInput type="number" min="1" step="1" value={form.quantity} onChange={set('quantity')} />
      </Field>
      <Field label='מחיר לפני מע"מ'>
        <TextInput type="number" min="0" step="0.01" value={form.unit_price} onChange={set('unit_price')} placeholder="350" />
      </Field>
      <PrimaryButton type="submit" disabled={!valid || busy} className="sm:mb-0">
        {busy ? 'שומר…' : 'הוסף חיוב'}
      </PrimaryButton>
    </form>
  );
}

function StatTile({ label, value, tone = 'dim' }) {
  const color = { crit: 'text-crit', gold: 'text-gold-600', dim: 'text-text' }[tone] ?? 'text-text';
  return (
    <div className="glass rounded-panel px-4 py-3.5">
      <div className="text-[12.5px] font-semibold uppercase tracking-[1.1px] text-text-faint">{label}</div>
      <div className={`tabular mt-1 font-display text-[22px] font-bold leading-none ${color}`}>{value}</div>
    </div>
  );
}
