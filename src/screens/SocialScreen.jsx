import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import GlassCard, { CardHead } from '../components/ui/GlassCard';
import DataTable, { StatusChip } from '../components/ui/DataTable';
import ScreenToolbar from '../components/ui/ScreenToolbar';
import Modal from '../components/ui/Modal';
import { MegaphoneIcon, ChartIcon, SettingsIcon } from '../components/ui/Icons';
import { Field, TextInput, TextArea, PrimaryButton, SecondaryButton } from '../components/ui/Field';
import { Async, EmptyState, LoadingRows } from '../components/ui/States';
import { useQuery } from '../hooks/useQuery';
import { useRealtime } from '../hooks/useRealtime';
import { describeError } from '../lib/supabase';
import { formatDateTime } from '../lib/mappers';
import {
  listSocialPosts, createSocialPost, updateSocialPost, deleteSocialPost, uploadSocialImage,
  getSocialStatus, publishSocialPost, unscheduleSocialPost, listMetaCampaigns,
  postState, isDue, toLocalInput, POST_STATE, PLATFORM_STATUS, CAMPAIGN_STATUS,
} from '../lib/social';

/**
 * ניהול סושיאל (phase45, 2026-09-27) — כתיבה, תזמון ופרסום פוסטים
 * לפייסבוק/אינסטגרם דרך Meta Graph API, וסטטוס קמפיינים ממומנים.
 *
 * הכל אמיתי, לא דקורטיבי (ר' CLAUDE.md: "לא לבנות סטטוס לאינטגרציה שלא
 * קיימת"): כרטיס "חיבור Meta" שואל את השרת בפועל ומציג "לא מחובר" עם
 * הוראות אם הטוקנים חסרים — בלי להעמיד פנים.
 */

const IG_CAPTION_LIMIT = 2200;
const FILTERS = [
  { value: 'draft', label: 'טיוטות' },
  { value: 'scheduled', label: 'מתוזמנים' },
  { value: 'published', label: 'פורסמו' },
  { value: 'failed', label: 'נכשלו' },
];

export default function SocialScreen() {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('');
  const [editing, setEditing] = useState(null); // null | 'new' | post
  const [busyId, setBusyId] = useState(null);

  const posts = useQuery(listSocialPosts, []);
  useRealtime(['social_posts'], posts.refetch);

  const status = useQuery(getSocialStatus, []);

  const filtered = useMemo(() => {
    let rows = posts.data ?? [];
    if (filter) rows = rows.filter((p) => postState(p) === filter);
    if (search.trim()) {
      const needle = search.trim().toLowerCase();
      rows = rows.filter((p) => (p.caption || '').toLowerCase().includes(needle));
    }
    return rows;
  }, [posts.data, filter, search]);

  const counts = useMemo(() => {
    const c = { draft: 0, scheduled: 0, published: 0, failed: 0 };
    for (const p of posts.data ?? []) c[postState(p)] += 1;
    return c;
  }, [posts.data]);

  const publish = useCallback(async (post, { silent = false } = {}) => {
    setBusyId(post.id);
    try {
      const saved = await publishSocialPost(post.id);
      posts.refetch();
      const failed = [saved.fb_error, saved.ig_error].filter(Boolean);
      if (!silent && failed.length) window.alert(`חלק מהפרסום נכשל:\n${failed.join('\n')}`);
    } catch (caught) {
      if (!silent) window.alert(describeError(caught));
    } finally {
      setBusyId(null);
    }
  }, [posts.refetch]);

  // פוסטים שהגיע זמנם וממתינים אצלנו (אינסטגרם, או פייסבוק שתוזמן לפחות
  // מ-10 דקות קדימה) — מתפרסמים אוטומטית כל עוד הטאב פתוח. הנעילה בשרת
  // מונעת פרסום כפול אם שני מנהלים פתוחים במקביל.
  const inFlight = useRef(new Set());
  const latest = useRef({ rows: [], refetch: posts.refetch });
  latest.current = { rows: posts.data ?? [], refetch: posts.refetch };
  useEffect(() => {
    const tick = () => {
      for (const p of latest.current.rows) {
        if (isDue(p) && !inFlight.current.has(p.id)) {
          inFlight.current.add(p.id);
          publishSocialPost(p.id)
            .catch(() => {})
            .finally(() => { inFlight.current.delete(p.id); latest.current.refetch(); });
        }
      }
    };
    tick();
    const timer = setInterval(tick, 60 * 1000);
    return () => clearInterval(timer);
  }, [posts.data]);

  async function unschedule(post) {
    if (!window.confirm('לבטל את התזמון ולהחזיר את הפוסט לטיוטה?')) return;
    setBusyId(post.id);
    try {
      await unscheduleSocialPost(post.id);
      posts.refetch();
    } catch (caught) {
      window.alert(describeError(caught));
    } finally {
      setBusyId(null);
    }
  }

  async function remove(post) {
    const note = post.fb_status === 'published' || post.ig_status === 'published'
      ? '\n\nהפוסט יימחק רק מהמערכת — מה שכבר עלה לפייסבוק/אינסטגרם נשאר שם.'
      : '';
    if (!window.confirm(`למחוק את הפוסט?${note}`)) return;
    setBusyId(post.id);
    try {
      if (post.fb_status === 'scheduled') await unscheduleSocialPost(post.id);
      await deleteSocialPost(post.id);
      posts.refetch();
    } catch (caught) {
      window.alert(describeError(caught));
    } finally {
      setBusyId(null);
    }
  }

  const columns = [
    {
      key: 'post',
      label: 'פוסט',
      width: 'minmax(200px,2fr)',
      render: (p) => (
        <div className="flex min-w-0 items-center gap-3">
          {p.image_url ? (
            <img src={p.image_url} alt="" className="h-12 w-12 flex-none rounded-lg border border-black/[0.08] object-cover" />
          ) : (
            <div className="grid h-12 w-12 flex-none place-items-center rounded-lg bg-ink-800 text-text-faint">
              <MegaphoneIcon className="h-5 w-5" />
            </div>
          )}
          <div className="min-w-0 truncate font-semibold">{p.caption || '(ללא טקסט)'}</div>
        </div>
      ),
    },
    {
      key: 'platforms',
      label: 'פלטפורמות',
      width: '190px',
      render: (p) => (
        <div className="flex flex-wrap gap-1.5">
          {p.fb_status && <PlatformChip name="FB" status={p.is_draft ? null : p.fb_status} error={p.fb_error} />}
          {p.ig_status && <PlatformChip name="IG" status={p.is_draft ? null : p.ig_status} error={p.ig_error} />}
        </div>
      ),
    },
    {
      key: 'state',
      label: 'סטטוס',
      width: '96px',
      render: (p) => {
        const s = POST_STATE[postState(p)];
        return <StatusChip tone={s.tone}>{s.label}</StatusChip>;
      },
    },
    {
      key: 'when',
      label: 'מועד',
      width: '120px',
      render: (p) => (
        <span className="tabular text-[13.5px] text-text-faint">
          {p.published_at ? formatDateTime(p.published_at) : p.scheduled_at ? formatDateTime(p.scheduled_at) : 'מיידי'}
        </span>
      ),
    },
  ];

  return (
    <>
      <ScreenToolbar
        search={search}
        onSearch={setSearch}
        searchPlaceholder="חיפוש בטקסט הפוסטים…"
        count={filtered.length}
        countLabel="פוסטים"
        actionLabel="פוסט חדש"
        onAction={() => setEditing('new')}
        filters={[{ key: 'state', value: filter, onChange: setFilter, placeholder: 'כל הפוסטים', options: FILTERS }]}
      />

      <div className="mb-5 grid grid-cols-2 gap-5 lg:grid-cols-4">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => setFilter(filter === f.value ? '' : f.value)}
            className={`glass-card p-5 text-start transition-colors ${filter === f.value ? 'border-gold-500/50' : ''}`}
          >
            <div className="text-[12.5px] font-semibold uppercase tracking-[1.1px] text-text-faint">{f.label}</div>
            <div className={`tabular mt-2 font-display text-[34px] font-bold leading-none ${f.value === 'failed' && counts.failed ? 'text-crit' : 'text-text'}`}>
              {counts[f.value].toLocaleString('he-IL')}
            </div>
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-5">
        <ConnectionCard status={status} />

        <GlassCard>
          <CardHead icon={MegaphoneIcon} tone="gold" title="פוסטים" subtitle="כתיבה, תזמון ופרסום לפייסבוק ולאינסטגרם" />
          <Async
            loading={posts.loading}
            error={posts.error}
            onRetry={posts.refetch}
            isEmpty={filtered.length === 0}
            empty={
              <EmptyState
                title={search || filter ? 'אין פוסט שתואם את הסינון' : 'עוד לא נכתבו פוסטים'}
                hint="לחץ “פוסט חדש” כדי לכתוב, להעלות תמונה ולבחור לפרסם עכשיו או לתזמן."
              />
            }
          >
            <div className="overflow-x-auto">
              <DataTable
                columns={columns}
                rows={filtered}
                rowKey={(p) => p.id}
                onRowClick={(p) => setEditing(p)}
                actions={(p) => {
                  const state = postState(p);
                  const busy = busyId === p.id;
                  const stop = (fn) => (event) => { event.stopPropagation(); fn(); };
                  return (
                    <>
                      {(state === 'draft' || state === 'failed' || isDue(p)) && (
                        <button type="button" disabled={busy} onClick={stop(() => publish(p))}
                          className="ghost-btn whitespace-nowrap px-2.5 py-2 text-[13.5px] disabled:opacity-50">
                          {busy ? 'מפרסם…' : state === 'failed' ? 'נסה שוב' : 'פרסם עכשיו'}
                        </button>
                      )}
                      {state === 'scheduled' && !isDue(p) && (
                        <button type="button" disabled={busy} onClick={stop(() => unschedule(p))}
                          className="ghost-btn whitespace-nowrap px-2.5 py-2 text-[13.5px] disabled:opacity-50">
                          בטל תזמון
                        </button>
                      )}
                      <button type="button" disabled={busy} onClick={stop(() => remove(p))}
                        className="ghost-btn whitespace-nowrap px-2.5 py-2 text-[13.5px] text-crit-soft disabled:opacity-50">
                        מחיקה
                      </button>
                    </>
                  );
                }}
              />
            </div>
          </Async>
        </GlassCard>

        <CampaignsCard enabled={Boolean(status.data?.ads?.configured)} statusLoading={status.loading} />
      </div>

      <PostModal
        post={editing}
        status={status.data}
        onClose={() => setEditing(null)}
        onSaved={() => { setEditing(null); posts.refetch(); }}
      />
    </>
  );
}

function PlatformChip({ name, status, error }) {
  const s = status ? PLATFORM_STATUS[status] : null;
  return (
    <span title={error || undefined}>
      <StatusChip tone={s?.tone ?? 'neutral'}>
        <span className="font-mono">{name}</span>
        {s && <span className="ms-1">· {s.label}</span>}
      </StatusChip>
    </span>
  );
}

/* ---------------------------- חיבור Meta ---------------------------- */

function ConnectionCard({ status }) {
  const data = status.data;
  const rows = data ? [
    { key: 'facebook', label: 'עמוד פייסבוק', env: 'META_PAGE_ID + META_PAGE_ACCESS_TOKEN', ...data.facebook },
    { key: 'instagram', label: 'אינסטגרם עסקי', env: 'META_IG_USER_ID', ...data.instagram },
    { key: 'ads', label: 'חשבון מודעות', env: 'META_AD_ACCOUNT_ID', ...data.ads },
  ] : [];
  const anyMissing = rows.some((r) => !r.configured);

  return (
    <GlassCard>
      <CardHead icon={SettingsIcon} tone="slate" title="חיבור Meta" subtitle="המצב האמיתי מול Meta Graph API, נבדק עכשיו" action="בדוק שוב" onAction={status.refetch} />
      {status.loading ? (
        <LoadingRows rows={3} height="h-[48px]" />
      ) : status.error ? (
        <div className="inner-row px-4 py-[15px] text-[14px] leading-relaxed text-text-dim">
          <div className="font-semibold text-crit-soft">לא ניתן לבדוק את החיבור</div>
          {status.error}
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {rows.map((r) => {
            const tone = !r.configured ? 'neutral' : r.ok ? 'ok' : 'crit';
            const label = !r.configured ? 'לא מוגדר' : r.ok ? 'מחובר' : 'שגיאה';
            return (
              <div key={r.key} className="inner-row flex flex-wrap items-center gap-3 px-4 py-[15px] text-[15px]">
                <span className="min-w-[120px] font-bold">{r.label}</span>
                <StatusChip tone={tone}>{label}</StatusChip>
                <span className="min-w-0 basis-full text-[14px] text-text-dim sm:flex-1 sm:basis-auto sm:truncate">
                  {!r.configured
                    ? <>חסר ב-Vercel: <span dir="ltr" className="font-mono">{r.env}</span></>
                    : r.ok
                      ? <>{r.name}{r.followers != null && <span className="tabular text-text-faint"> · {Number(r.followers).toLocaleString('he-IL')} עוקבים</span>}</>
                      : r.error}
                </span>
              </div>
            );
          })}
          {anyMissing && (
            <p className="mt-1 text-[14px] leading-relaxed text-text-faint">
              הטוקנים נשמרים רק בשרת (Vercel → Settings → Environment Variables), לעולם לא בדפדפן.
              אחרי הוספה צריך Redeploy כדי שייכנסו לתוקף.
            </p>
          )}
        </div>
      )}
    </GlassCard>
  );
}

/* ---------------------------- קמפיינים ---------------------------- */

function CampaignsCard({ enabled, statusLoading }) {
  const campaigns = useQuery(listMetaCampaigns, [enabled], { enabled });
  const money = (v) => (v == null ? '—' : `₪${Number(v).toLocaleString('he-IL', { maximumFractionDigits: 0 })}`);
  const num = (v) => Number(v || 0).toLocaleString('he-IL');

  const columns = [
    { key: 'name', label: 'קמפיין', width: 'minmax(160px,2fr)', render: (c) => <span className="font-semibold">{c.name}</span> },
    {
      key: 'status', label: 'סטטוס', width: '104px',
      render: (c) => {
        const s = CAMPAIGN_STATUS[c.status] ?? { label: c.status, tone: 'neutral' };
        return <StatusChip tone={s.tone}>{s.label}</StatusChip>;
      },
    },
    { key: 'budget', label: 'תקציב', width: '100px', render: (c) => <span className="tabular">{c.dailyBudget != null ? `${money(c.dailyBudget)}/יום` : money(c.lifetimeBudget)}</span> },
    { key: 'spend', label: 'הוצאה 30 יום', width: '104px', render: (c) => <span className="tabular font-bold text-gold-600">{money(c.spend)}</span> },
    { key: 'reach', label: 'חשיפה', width: '90px', render: (c) => <span className="tabular">{num(c.reach)}</span> },
    { key: 'clicks', label: 'קליקים', width: '80px', render: (c) => <span className="tabular">{num(c.clicks)}</span> },
    { key: 'leads', label: 'לידים', width: '70px', render: (c) => <span className="tabular font-bold">{num(c.leads)}</span> },
  ];

  return (
    <GlassCard>
      <CardHead
        icon={ChartIcon}
        tone="teal"
        title="קמפיינים ממומנים"
        subtitle="סטטוס וביצועים ב-30 הימים האחרונים, ישירות ממנהל המודעות"
        action={enabled ? 'רענון' : undefined}
        onAction={campaigns.refetch}
      />
      {!enabled ? (
        statusLoading ? <LoadingRows rows={2} /> : (
          <EmptyState
            title="חשבון המודעות לא מחובר"
            hint="הוסף META_AD_ACCOUNT_ID (וטוקן עם הרשאת ads_read) ב-Vercel כדי לראות כאן את הקמפיינים."
          />
        )
      ) : (
        <Async
          loading={campaigns.loading}
          error={campaigns.error}
          onRetry={campaigns.refetch}
          isEmpty={(campaigns.data?.campaigns ?? []).length === 0}
          empty={<EmptyState title="אין קמפיינים פעילים או מושהים" />}
        >
          <div className="overflow-x-auto">
            <DataTable columns={columns} rows={campaigns.data?.campaigns ?? []} rowKey={(c) => c.id} />
          </div>
        </Async>
      )}
    </GlassCard>
  );
}

/* ---------------------------- כתיבת פוסט ---------------------------- */

const emptyForm = () => ({
  caption: '', image_url: '', link_url: '', facebook: true, instagram: false, mode: 'now', scheduled_at: '',
});

function PostModal({ post, status, onClose, onSaved }) {
  const open = post != null;
  const isNew = post === 'new';
  const existing = isNew ? null : post;
  const locked = existing && (existing.fb_status === 'published' || existing.ig_status === 'published' || existing.fb_status === 'scheduled');

  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setBusy(null);
    if (existing) {
      setForm({
        caption: existing.caption ?? '',
        image_url: existing.image_url ?? '',
        link_url: existing.link_url ?? '',
        facebook: Boolean(existing.fb_status),
        instagram: Boolean(existing.ig_status),
        mode: existing.scheduled_at ? 'schedule' : 'now',
        scheduled_at: toLocalInput(existing.scheduled_at),
      });
    } else {
      setForm(emptyForm());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, existing?.id]);

  const set = (key) => (event) => {
    const value = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  async function onFile(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const url = await uploadSocialImage(file);
      setForm((prev) => ({ ...prev, image_url: url }));
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setUploading(false);
    }
  }

  function validate(asDraft) {
    if (!form.facebook && !form.instagram) return 'בחר לפחות פלטפורמה אחת';
    if (asDraft) return null;
    if (!form.caption.trim() && !form.image_url) return 'כתוב טקסט או הוסף תמונה';
    if (form.instagram && !form.image_url) return 'באינסטגרם חובה לצרף תמונה';
    if (form.instagram && form.caption.length > IG_CAPTION_LIMIT) return `באינסטגרם הטקסט מוגבל ל-${IG_CAPTION_LIMIT} תווים`;
    if (form.mode === 'schedule') {
      if (!form.scheduled_at) return 'בחר תאריך ושעה לתזמון';
      if (new Date(form.scheduled_at).getTime() < Date.now() + 60 * 1000) return 'זמן התזמון חייב להיות בעתיד';
    }
    return null;
  }

  async function save(asDraft) {
    const problem = validate(asDraft);
    if (problem) { setError(problem); return; }
    setError(null);
    setBusy(asDraft ? 'draft' : 'publish');

    const payload = {
      caption: form.caption.trim(),
      image_url: form.image_url.trim() || null,
      link_url: form.link_url.trim() || null,
      scheduled_at: form.mode === 'schedule' && form.scheduled_at ? new Date(form.scheduled_at).toISOString() : null,
      fb_status: form.facebook ? 'pending' : null,
      ig_status: form.instagram ? 'pending' : null,
      fb_error: null,
      ig_error: null,
      is_draft: true,
    };

    try {
      const saved = existing ? await updateSocialPost(existing.id, payload) : await createSocialPost(payload);
      if (!asDraft) {
        const result = await publishSocialPost(saved.id);
        const failed = [result.fb_error, result.ig_error].filter(Boolean);
        if (failed.length) {
          setError(`נשמר, אבל הפרסום נכשל: ${failed.join(' · ')}`);
          setBusy(null);
          return;
        }
      }
      onSaved();
    } catch (caught) {
      setError(describeError(caught));
      setBusy(null);
    }
  }

  const fbReady = status?.facebook?.ok;
  const igReady = status?.instagram?.ok;
  const publishLabel = form.mode === 'schedule' ? 'תזמן פרסום' : 'פרסם עכשיו';

  return (
    <Modal
      open={open}
      title={isNew ? 'פוסט חדש' : locked ? 'פרטי פוסט' : 'עריכת פוסט'}
      subtitle={locked ? 'הפוסט כבר נשלח ל-Meta — לשינוי יש לבטל תזמון או לערוך ישירות בפייסבוק/אינסטגרם' : 'טקסט, תמונה, פלטפורמות ומועד פרסום'}
      onClose={onClose}
      footer={locked ? (
        <SecondaryButton onClick={onClose}>סגירה</SecondaryButton>
      ) : (
        <>
          <PrimaryButton loading={busy === 'publish'} disabled={Boolean(busy) || uploading} onClick={() => save(false)}>
            {publishLabel}
          </PrimaryButton>
          <SecondaryButton disabled={Boolean(busy) || uploading} onClick={() => save(true)}>
            {busy === 'draft' ? 'שומר…' : 'שמור כטיוטה'}
          </SecondaryButton>
        </>
      )}
    >
      <fieldset disabled={Boolean(locked)} className="flex flex-col gap-3.5">
        <Field label="טקסט הפוסט" hint={`${form.caption.length.toLocaleString('he-IL')} תווים${form.instagram ? ` · עד ${IG_CAPTION_LIMIT.toLocaleString('he-IL')} באינסטגרם` : ''}`}>
          <TextArea value={form.caption} onChange={set('caption')} rows={5} placeholder="מה רוצים לספר היום?" />
        </Field>

        <Field label="תמונה" hint={form.instagram ? 'חובה לאינסטגרם · JPG מומלץ' : 'אופציונלי'}>
          <div className="flex flex-wrap items-center gap-3">
            {form.image_url && (
              <img src={form.image_url} alt="" className="h-20 w-20 rounded-xl border border-black/[0.08] object-cover" />
            )}
            <label className={`ghost-btn cursor-pointer px-4 py-3 text-[15px] ${uploading ? 'opacity-60' : ''}`}>
              {uploading ? 'מעלה…' : form.image_url ? 'החלפת תמונה' : 'העלאת תמונה'}
              <input type="file" accept="image/jpeg,image/png" className="hidden" onChange={onFile} disabled={uploading || Boolean(locked)} />
            </label>
            {form.image_url && !locked && (
              <button type="button" onClick={() => setForm((prev) => ({ ...prev, image_url: '' }))} className="text-[14px] text-text-faint hover:text-crit-soft">
                הסרה
              </button>
            )}
          </div>
        </Field>

        <Field label="קישור" hint="אופציונלי — למשל עמוד מוצר באתר">
          <TextInput dir="ltr" type="url" value={form.link_url} onChange={set('link_url')} placeholder="https://iconair.co.il/..." />
        </Field>

        <div className="flex flex-col gap-2">
          <span className="text-[15px] font-bold text-text-dim">לאן לפרסם</span>
          <div className="flex flex-wrap gap-2.5">
            <PlatformToggle checked={form.facebook} onChange={set('facebook')} label="פייסבוק" hint={status && !fbReady ? 'לא מחובר' : null} />
            <PlatformToggle checked={form.instagram} onChange={set('instagram')} label="אינסטגרם" hint={status && !igReady ? 'לא מחובר' : null} />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-[15px] font-bold text-text-dim">מתי</span>
          <div className="flex flex-wrap gap-2.5">
            {[{ v: 'now', l: 'עכשיו' }, { v: 'schedule', l: 'תזמון' }].map((o) => (
              <button
                key={o.v}
                type="button"
                onClick={() => setForm((prev) => ({ ...prev, mode: o.v }))}
                className={`rounded-pill border px-4 py-2.5 text-[15px] font-semibold transition-colors ${
                  form.mode === o.v ? 'border-gold-300/[0.5] bg-gold-500/[0.14] text-gold-600' : 'border-black/[0.09] text-text-faint'
                }`}
              >
                {o.l}
              </button>
            ))}
          </div>
          {form.mode === 'schedule' && (
            <>
              <TextInput type="datetime-local" value={form.scheduled_at} onChange={set('scheduled_at')} />
              <span className="text-[14px] leading-relaxed text-text-faint">
                פייסבוק: התזמון נשמר אצל Meta ויעלה בזמן גם אם המערכת סגורה.
                אינסטגרם: Meta לא מאפשרת תזמון — הפוסט יעלה כשיגיע הזמן והטאב הזה פתוח אצל מנהל.
              </span>
            </>
          )}
        </div>

        {error && <div className="text-[14px] text-crit-soft">{error}</div>}
      </fieldset>
    </Modal>
  );
}

function PlatformToggle({ checked, onChange, label, hint }) {
  return (
    <label
      className={`flex cursor-pointer items-center gap-2 rounded-pill border px-4 py-2.5 text-[15px] font-semibold transition-colors ${
        checked ? 'border-gold-300/[0.5] bg-gold-500/[0.14] text-gold-600' : 'border-black/[0.09] text-text-faint'
      }`}
    >
      <input type="checkbox" checked={checked} onChange={onChange} className="h-4 w-4 accent-amber-500" />
      {label}
      {hint && <span className="text-[13px] font-normal text-text-faint">({hint})</span>}
    </label>
  );
}
