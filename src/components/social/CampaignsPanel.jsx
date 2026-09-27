import { useEffect, useMemo, useState } from 'react';
import GlassCard, { CardHead } from '../ui/GlassCard';
import DataTable, { StatusChip } from '../ui/DataTable';
import Modal from '../ui/Modal';
import { ChartIcon } from '../ui/Icons';
import { Field, TextInput, PrimaryButton, SecondaryButton } from '../ui/Field';
import { Async, EmptyState } from '../ui/States';
import { useQuery } from '../../hooks/useQuery';
import { describeError } from '../../lib/supabase';
import { Stat, TrendChart, Pills } from './SocialUI';
import {
  listMetaCampaigns, updateMetaCampaign, boostSocialPost, searchMetaCities,
  CAMPAIGN_STATUS, OBJECTIVE_LABEL, money, num, compact,
} from '../../lib/social';

const PRESETS = [
  { value: 'last_7d', label: '7 ימים' },
  { value: 'last_14d', label: '14 יום' },
  { value: 'last_30d', label: '30 יום' },
  { value: 'this_month', label: 'החודש' },
  { value: 'last_month', label: 'חודש קודם' },
];

export default function CampaignsPanel({ settings, crmLeads = [], onGoConnect, onToast }) {
  const [preset, setPreset] = useState('last_30d');
  const [busyId, setBusyId] = useState(null);
  const enabled = Boolean(settings?.connected && settings?.ad_account_id);
  const data = useQuery(() => listMetaCampaigns(preset), [preset, enabled], { enabled });
  const cur = data.data?.currency || settings?.currency || 'ILS';

  const totals = useMemo(() => {
    const list = data.data?.campaigns ?? [];
    const spend = list.reduce((a, c) => a + c.spend, 0);
    const leads = list.reduce((a, c) => a + c.leads, 0);
    const clicks = list.reduce((a, c) => a + c.clicks, 0);
    const impressions = list.reduce((a, c) => a + c.impressions, 0);
    return { spend, leads, clicks, ctr: impressions ? (clicks / impressions) * 100 : null, cpl: leads ? spend / leads : null, active: list.filter((c) => c.status === 'ACTIVE').length };
  }, [data.data]);

  // לידים שנקלטו בפועל ב-CRM בתקופה — אמת מול מה ש-Meta מדווחת.
  const crmInRange = useMemo(() => {
    const days = { last_7d: 7, last_14d: 14, last_30d: 30 }[preset];
    if (!days) return null;
    const since = Date.now() - days * 86400000;
    return crmLeads.filter((l) => new Date(l.created_at).getTime() >= since).length;
  }, [crmLeads, preset]);

  async function toggle(c) {
    const next = c.configuredStatus === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';
    if (!window.confirm(next === 'PAUSED' ? `להשהות את "${c.name}"?` : `להפעיל את "${c.name}"? הקמפיין יתחיל להוציא תקציב.`)) return;
    setBusyId(c.id);
    try {
      await updateMetaCampaign(c.id, { status: next });
      onToast({ message: next === 'PAUSED' ? 'הקמפיין הושהה' : 'הקמפיין הופעל' });
      data.refetch();
    } catch (e) {
      onToast({ tone: 'crit', message: describeError(e) });
    } finally {
      setBusyId(null);
    }
  }

  async function editBudget(c) {
    const value = window.prompt(`תקציב יומי חדש ל-"${c.name}" (${cur})`, c.dailyBudget ?? '');
    if (value == null) return;
    const n = Number(String(value).replace(/[^\d.]/g, ''));
    if (!(n > 0)) return;
    setBusyId(c.id);
    try {
      await updateMetaCampaign(c.id, { dailyBudget: n });
      onToast({ message: 'התקציב עודכן' });
      data.refetch();
    } catch (e) {
      onToast({ tone: 'crit', message: describeError(e) });
    } finally {
      setBusyId(null);
    }
  }

  if (!enabled) {
    return (
      <GlassCard>
        <CardHead icon={ChartIcon} tone="teal" title="קמפיינים ממומנים" subtitle="ביצועים, תקציבים ושליטה — ישירות ממנהל המודעות" />
        <EmptyState
          title={settings?.connected ? 'לא נבחר חשבון מודעות' : 'Meta עוד לא מחובר'}
          hint={settings?.connected ? 'בחר חשבון מודעות בלשונית "חיבור" כדי לראות ולנהל כאן את הקמפיינים.' : 'חיבור אחד ל-Meta פותח כאן את כל הקמפיינים, הלידים והעלות לליד.'}
          action={<button type="button" onClick={onGoConnect} className="ghost-btn mt-2">מעבר לחיבור</button>}
        />
      </GlassCard>
    );
  }

  const columns = [
    {
      key: 'name', label: 'קמפיין', width: 'minmax(180px,2fr)',
      render: (c) => (
        <div className="min-w-0">
          <div className="truncate font-bold">{c.name}</div>
          <div className="text-[13px] text-text-faint">{OBJECTIVE_LABEL[c.objective] ?? c.objective}</div>
        </div>
      ),
    },
    { key: 'status', label: 'סטטוס', width: '112px', render: (c) => { const s = CAMPAIGN_STATUS[c.status] ?? { label: c.status, tone: 'neutral' }; return <StatusChip tone={s.tone}>{s.label}</StatusChip>; } },
    {
      key: 'budget', label: 'תקציב', width: '112px',
      render: (c) => (c.dailyBudget != null ? (
        <button type="button" onClick={(e) => { e.stopPropagation(); editBudget(c); }} className="tabular font-semibold text-gold-600 hover:underline" title="עריכת תקציב יומי">
          {money(c.dailyBudget, cur)}/יום
        </button>
      ) : <span className="tabular text-text-dim">{c.lifetimeBudget != null ? money(c.lifetimeBudget, cur) : 'ברמת סט'}</span>),
    },
    { key: 'spend', label: 'הוצאה', width: '96px', render: (c) => <span className="tabular font-bold">{money(c.spend, cur)}</span> },
    { key: 'reach', label: 'חשיפה', width: '80px', render: (c) => <span className="tabular">{compact(c.reach)}</span> },
    { key: 'clicks', label: 'קליקים', width: '76px', render: (c) => <span className="tabular">{num(c.clicks)}</span> },
    { key: 'leads', label: 'לידים', width: '64px', render: (c) => <span className="tabular font-bold text-gold-600">{num(c.leads)}</span> },
    { key: 'cpl', label: 'עלות לליד', width: '92px', render: (c) => <span className="tabular">{c.cpl != null ? money(c.cpl, cur) : '—'}</span> },
  ];

  const daily = data.data?.daily ?? [];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Pills size="sm" value={preset} onChange={setPreset} options={PRESETS} />
        <a href={`https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${settings.ad_account_id}`} target="_blank" rel="noreferrer"
          className="text-[14px] font-semibold text-gold-600 hover:underline">פתיחה במנהל המודעות ↗</a>
      </div>

      <div className="grid grid-cols-2 gap-5 lg:grid-cols-5">
        <Stat label="הוצאה" value={data.loading ? '…' : money(totals.spend, cur)} hint={`${totals.active} קמפיינים פעילים`} />
        <Stat label="לידים (Meta)" value={data.loading ? '…' : num(totals.leads)} tone="gold" hint={crmInRange != null ? `${num(crmInRange)} נקלטו ב-CRM` : undefined} />
        <Stat label="עלות לליד" value={data.loading ? '…' : totals.cpl != null ? money(totals.cpl, cur) : '—'} />
        <Stat label="קליקים" value={data.loading ? '…' : compact(totals.clicks)} />
        <Stat label="CTR" value={data.loading ? '…' : totals.ctr != null ? `${totals.ctr.toFixed(2)}%` : '—'} />
      </div>

      <GlassCard>
        <CardHead icon={ChartIcon} tone="teal" title="מגמה יומית" subtitle="הוצאה מול לידים, לפי יום" />
        <TrendChart
          labels={daily.map((d) => new Date(d.date).toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' }))}
          primary={daily.map((d) => d.spend)}
          secondary={daily.map((d) => d.leads)}
          primaryLabel="הוצאה"
          secondaryLabel="לידים"
          format={(v) => money(v, cur)}
        />
      </GlassCard>

      <GlassCard>
        <CardHead icon={ChartIcon} tone="gold" title="קמפיינים" subtitle={data.data?.accountName ? `חשבון: ${data.data.accountName}` : undefined} action="רענון" onAction={data.refetch} />
        <Async loading={data.loading} error={data.error} onRetry={data.refetch}
          isEmpty={(data.data?.campaigns ?? []).length === 0}
          empty={<EmptyState title="אין קמפיינים פעילים או מושהים" hint="פרסם פוסט ולחץ עליו → “קדם פוסט” כדי להקים קמפיין בלחיצה אחת." />}>
          <div className="overflow-x-auto">
            <DataTable
              columns={columns}
              rows={data.data?.campaigns ?? []}
              rowKey={(c) => c.id}
              actions={(c) => (['ACTIVE', 'PAUSED'].includes(c.configuredStatus) ? (
                <button type="button" disabled={busyId === c.id} onClick={() => toggle(c)}
                  className="ghost-btn whitespace-nowrap px-2.5 py-2 text-[13.5px] disabled:opacity-50">
                  {busyId === c.id ? '…' : c.configuredStatus === 'ACTIVE' ? 'השהה' : 'הפעל'}
                </button>
              ) : null)}
            />
          </div>
        </Async>
      </GlassCard>
    </div>
  );
}

/* ================================ קידום פוסט ================================ */

export function BoostModal({ post, settings, onClose, onDone }) {
  const open = post != null;
  const [form, setForm] = useState({ budget: '30', days: '7', ageMin: '24', ageMax: '65' });
  const [q, setQ] = useState('');
  const [found, setFound] = useState([]);
  const [cities, setCities] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const cur = settings?.currency || 'ILS';

  useEffect(() => {
    if (open) { setError(null); setBusy(false); setCities([]); setQ(''); setFound([]); }
  }, [open]);

  useEffect(() => {
    if (!open || q.trim().length < 2) { setFound([]); return undefined; }
    const t = setTimeout(() => searchMetaCities(q.trim()).then(setFound).catch(() => setFound([])), 350);
    return () => clearTimeout(t);
  }, [q, open]);

  const set = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }));
  const total = Number(form.budget || 0) * Number(form.days || 0);

  async function submit() {
    setError(null);
    if (!(Number(form.budget) >= 5)) { setError('תקציב יומי מינימלי: 5 ₪'); return; }
    setBusy(true);
    try {
      await boostSocialPost({
        postId: post.id, dailyBudget: Number(form.budget), days: Number(form.days),
        ageMin: Number(form.ageMin), ageMax: Number(form.ageMax), cities: cities.map((c) => c.key),
      });
      onDone();
    } catch (e) {
      setError(describeError(e));
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      title="קידום פוסט"
      subtitle="קמפיין מעורבות על הפוסט הזה — פייסבוק ואינסטגרם"
      onClose={onClose}
      footer={(
        <>
          <PrimaryButton loading={busy} onClick={submit}>{busy ? 'מקים קמפיין…' : `הפעל קידום · ${money(total, cur)}`}</PrimaryButton>
          <SecondaryButton onClick={onClose}>ביטול</SecondaryButton>
        </>
      )}
    >
      {post && (
        <div className="flex flex-col gap-4">
          <div className="inner-row flex items-center gap-3 px-4 py-3">
            {post.media_urls?.[0] && <img src={post.media_urls[0]} alt="" className="h-12 w-12 rounded-lg object-cover" />}
            <div className="line-clamp-2 text-[14px] text-text-dim">{post.caption || 'פוסט'}</div>
          </div>
          <div className="grid grid-cols-2 gap-3.5">
            <Field label={`תקציב יומי (${cur})`}><TextInput type="number" min="5" inputMode="numeric" value={form.budget} onChange={set('budget')} /></Field>
            <Field label="ימים"><TextInput type="number" min="1" max="60" inputMode="numeric" value={form.days} onChange={set('days')} /></Field>
            <Field label="גיל מ-"><TextInput type="number" min="18" max="65" value={form.ageMin} onChange={set('ageMin')} /></Field>
            <Field label="עד"><TextInput type="number" min="18" max="65" value={form.ageMax} onChange={set('ageMax')} /></Field>
          </div>
          <Field label="אזור" hint={cities.length ? 'רדיוס 15 ק"מ מכל עיר' : 'ריק = כל הארץ'}>
            <TextInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="חיפוש עיר — למשל חיפה" />
          </Field>
          {found.length > 0 && (
            <div className="-mt-2 flex flex-wrap gap-2">
              {found.filter((f) => !cities.some((c) => c.key === f.key)).map((f) => (
                <button key={f.key} type="button" className="chip hover:border-gold-500/40" onClick={() => { setCities((p) => [...p, f]); setQ(''); }}>+ {f.name}</button>
              ))}
            </div>
          )}
          {cities.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {cities.map((c) => (
                <button key={c.key} type="button" className="chip border-gold-300/[0.5] bg-gold-500/[0.14] text-gold-600" onClick={() => setCities((p) => p.filter((x) => x.key !== c.key))}>{c.name} ✕</button>
              ))}
            </div>
          )}
          <p className="text-[14px] leading-relaxed text-text-faint">
            סה״כ עד {money(total, cur)} ל-{num(form.days)} ימים. החיוב מתבצע ע״י Meta מאמצעי התשלום של חשבון המודעות, והמודעה עוברת את הבדיקה הרגילה שלהם.
          </p>
          {error && <div className="rounded-row border border-crit/25 bg-crit/[0.07] px-4 py-3 text-[14px] font-semibold text-crit-soft">{error}</div>}
        </div>
      )}
    </Modal>
  );
}
