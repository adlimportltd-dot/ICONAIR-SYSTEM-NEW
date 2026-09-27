import { useEffect, useRef, useState } from 'react';
import Modal from '../ui/Modal';
import { Field, TextInput, TextArea, PrimaryButton, SecondaryButton } from '../ui/Field';
import { StatusChip } from '../ui/DataTable';
import { PlusIcon, TrashIcon, ChevronRightIcon } from '../ui/Icons';
import PostPreview from './PostPreview';
import { Pills } from './SocialUI';
import { describeError } from '../../lib/supabase';
import {
  createSocialPost, updateSocialPost, uploadSocialImage, publishSocialPost,
  toLocalInput, postState, POST_STATE, PLATFORM_STATUS, IG_CAPTION_LIMIT, HASHTAG_SETS, SUGGESTED_TIMES, num,
} from '../../lib/social';

const blank = (preset = {}) => ({
  caption: '', media_urls: [], link_url: '', facebook: true, instagram: true,
  mode: preset.scheduled_at ? 'schedule' : 'now', scheduled_at: preset.scheduled_at ? toLocalInput(preset.scheduled_at) : '',
  ...preset.form,
});

/**
 * עורך פוסט: טקסט + מדיה (עד 10 = קרוסלה) + פלטפורמות + מועד, עם תצוגה
 * מקדימה חיה. פוסט שכבר פורסם נפתח לקריאה בלבד עם ביצועים וקישורים.
 *
 * post: null (סגור) | { preset } (חדש) | שורת social_posts (קיים)
 */
export default function PostComposer({ post, settings, onClose, onSaved, onOpenStudio, onBoost, studioResult }) {
  const open = post != null;
  const existing = post?.id ? post : null;
  const state = existing ? postState(existing) : null;
  const readOnly = state === 'published' || (existing && (existing.fb_status === 'published' || existing.ig_status === 'published'));

  const [form, setForm] = useState(blank);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);
  const [uploading, setUploading] = useState(0);
  const fileRef = useRef(null);
  const connected = settings?.connected;
  const hasIg = Boolean(settings?.ig_user_id);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setBusy(null);
    if (existing) {
      setForm({
        caption: existing.caption ?? '',
        media_urls: existing.media_urls ?? [],
        link_url: existing.link_url ?? '',
        facebook: Boolean(existing.fb_status),
        instagram: Boolean(existing.ig_status),
        mode: existing.is_draft ? (existing.scheduled_at ? 'schedule' : 'now') : existing.scheduled_at ? 'schedule' : 'now',
        scheduled_at: toLocalInput(existing.scheduled_at),
      });
    } else {
      setForm({ ...blank(post?.preset), instagram: hasIg && (post?.preset?.form?.instagram ?? true) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, existing?.id]);

  // קריאייטיב שנוצר בסטודיו מתווסף אוטומטית למדיה של הפוסט הפתוח.
  useEffect(() => {
    if (open && studioResult?.url) {
      setForm((prev) => (prev.media_urls.includes(studioResult.url) ? prev : { ...prev, media_urls: [...prev.media_urls, studioResult.url].slice(0, 10) }));
    }
  }, [open, studioResult]);

  const set = (key) => (event) => setForm((prev) => ({ ...prev, [key]: event.target.value }));
  const toggle = (key) => setForm((prev) => ({ ...prev, [key]: !prev[key] }));

  async function onFiles(event) {
    const files = Array.from(event.target.files || []).slice(0, 10 - form.media_urls.length);
    event.target.value = '';
    if (!files.length) return;
    setError(null);
    setUploading(files.length);
    try {
      for (const file of files) {
        const url = await uploadSocialImage(file);
        setForm((prev) => ({ ...prev, media_urls: [...prev.media_urls, url].slice(0, 10) }));
        setUploading((n) => n - 1);
      }
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setUploading(0);
    }
  }

  const move = (i, dir) => setForm((prev) => {
    const next = [...prev.media_urls];
    const j = i + dir;
    if (j < 0 || j >= next.length) return prev;
    [next[i], next[j]] = [next[j], next[i]];
    return { ...prev, media_urls: next };
  });
  const removeMedia = (i) => setForm((prev) => ({ ...prev, media_urls: prev.media_urls.filter((_, k) => k !== i) }));

  function addTags(tags) {
    setForm((prev) => ({ ...prev, caption: prev.caption.includes(tags) ? prev.caption : `${prev.caption.trimEnd()}${prev.caption.trim() ? '\n\n' : ''}${tags}` }));
  }

  function pickTime(time) {
    const base = form.scheduled_at ? new Date(form.scheduled_at) : new Date();
    const [h, m] = time.split(':').map(Number);
    const d = new Date(base);
    d.setHours(h, m, 0, 0);
    if (d.getTime() < Date.now() + 5 * 60 * 1000) d.setDate(d.getDate() + 1);
    setForm((prev) => ({ ...prev, mode: 'schedule', scheduled_at: toLocalInput(d) }));
  }

  function validate(asDraft) {
    if (!form.facebook && !form.instagram) return 'בחר לפחות פלטפורמה אחת';
    if (asDraft) return null;
    if (!connected) return 'כדי לפרסם צריך קודם לחבר את Meta (לשונית "חיבור")';
    if (!form.caption.trim() && !form.media_urls.length) return 'כתוב טקסט או הוסף תמונה';
    if (form.instagram && !hasIg) return 'לעמוד המחובר אין חשבון אינסטגרם עסקי — בטל את אינסטגרם או קשר חשבון';
    if (form.instagram && !form.media_urls.length) return 'באינסטגרם חובה לפחות תמונה אחת';
    if (form.instagram && form.caption.length > IG_CAPTION_LIMIT) return `באינסטגרם הטקסט מוגבל ל-${IG_CAPTION_LIMIT.toLocaleString('he-IL')} תווים`;
    if (form.mode === 'schedule') {
      if (!form.scheduled_at) return 'בחר תאריך ושעה';
      if (new Date(form.scheduled_at).getTime() < Date.now() + 60 * 1000) return 'מועד התזמון חייב להיות בעתיד';
    }
    return null;
  }

  async function save(kind) {
    const asDraft = kind === 'draft';
    const problem = validate(asDraft);
    if (problem) { setError(problem); return; }
    setError(null);
    setBusy(kind);

    const scheduled = form.mode === 'schedule' && form.scheduled_at ? new Date(form.scheduled_at).toISOString() : null;
    const payload = {
      caption: form.caption.trim(),
      media_urls: form.media_urls,
      link_url: form.link_url.trim() || null,
      scheduled_at: scheduled,
      fb_status: form.facebook ? 'pending' : null,
      ig_status: form.instagram ? 'pending' : null,
      fb_error: null,
      ig_error: null,
      attempts: 0,
      is_draft: asDraft || kind === 'now',
    };

    try {
      const saved = existing ? await updateSocialPost(existing.id, payload) : await createSocialPost(payload);
      if (kind === 'now') {
        const result = await publishSocialPost(saved.id);
        const problems = [result.fb_error, result.ig_error].filter(Boolean);
        onSaved(problems.length ? { tone: 'crit', message: `חלק מהפרסום לא הצליח: ${problems.join(' · ')}` } : { message: 'הפוסט פורסם בהצלחה' });
        return;
      }
      onSaved({ message: asDraft ? 'נשמר כטיוטה' : `מתוזמן ל-${new Date(scheduled).toLocaleString('he-IL', { weekday: 'long', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' })} — יעלה אוטומטית`, tone: asDraft ? 'ok' : 'gold' });
    } catch (caught) {
      setError(describeError(caught));
      setBusy(null);
    }
  }

  const title = !existing ? 'פוסט חדש' : readOnly ? 'פוסט שפורסם' : 'עריכת פוסט';
  const s = state && POST_STATE[state];

  return (
    <Modal
      open={open}
      wide
      title={title}
      subtitle={readOnly ? 'ביצועים מתעדכנים אוטומטית כל חצי שעה' : 'כתיבה, מדיה, פלטפורמות ומועד — עם תצוגה מקדימה חיה'}
      onClose={onClose}
      footer={readOnly ? (
        <>
          {existing?.fb_post_id && settings?.ad_account_id && (
            <PrimaryButton onClick={() => onBoost(existing)}>{existing.boosted_campaign_id ? 'קדם שוב' : 'קדם פוסט'}</PrimaryButton>
          )}
          <SecondaryButton onClick={onClose}>סגירה</SecondaryButton>
        </>
      ) : (
        <>
          <PrimaryButton loading={busy === 'now' || busy === 'schedule'} disabled={Boolean(busy) || uploading > 0}
            onClick={() => save(form.mode === 'schedule' ? 'schedule' : 'now')}>
            {form.mode === 'schedule' ? 'תזמן פרסום' : 'פרסם עכשיו'}
          </PrimaryButton>
          <SecondaryButton disabled={Boolean(busy) || uploading > 0} onClick={() => save('draft')}>
            {busy === 'draft' ? 'שומר…' : 'שמור כטיוטה'}
          </SecondaryButton>
          {s && <span className="ms-auto self-center"><StatusChip tone={s.tone}>{s.label}</StatusChip></span>}
        </>
      )}
    >
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex min-w-0 flex-col gap-4">
          {readOnly && existing && <PublishedSummary post={existing} />}

          <fieldset disabled={Boolean(readOnly)} className="flex flex-col gap-4">
            <Field
              label="טקסט"
              hint={`${form.caption.length.toLocaleString('he-IL')} תווים${form.instagram ? ` · מקסימום ${IG_CAPTION_LIMIT.toLocaleString('he-IL')} באינסטגרם` : ''}`}
            >
              <TextArea value={form.caption} onChange={set('caption')} rows={6} placeholder="מה מספרים היום ללקוחות?" />
            </Field>
            {!readOnly && (
              <div className="-mt-2 flex flex-wrap items-center gap-2">
                <span className="text-[13.5px] text-text-faint">האשטגים:</span>
                {HASHTAG_SETS.map((h) => (
                  <button key={h.label} type="button" onClick={() => addTags(h.tags)} className="chip hover:border-gold-500/40 hover:text-gold-600">
                    + {h.label}
                  </button>
                ))}
              </div>
            )}

            <div className="flex flex-col gap-2">
              <span className="text-[15px] font-bold text-text-dim">
                מדיה <span className="font-normal text-text-faint">({form.media_urls.length}/10{form.media_urls.length > 1 ? ' · קרוסלה' : ''})</span>
              </span>
              <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-5">
                {form.media_urls.map((src, i) => (
                  <div key={src} className="group relative overflow-hidden rounded-row border border-black/[0.08] bg-ink-800">
                    <img src={src} alt="" className="aspect-square w-full object-cover" />
                    {i === 0 && form.media_urls.length > 1 && (
                      <span className="absolute start-1.5 top-1.5 rounded-md bg-black/60 px-1.5 py-0.5 text-[11.5px] font-semibold text-white">ראשית</span>
                    )}
                    {!readOnly && (
                      <div className="absolute inset-x-0 bottom-0 flex justify-between bg-black/55 p-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100">
                        <button type="button" onClick={() => move(i, -1)} className="grid h-7 w-7 place-items-center rounded-md text-white hover:bg-white/15" aria-label="הזז קדימה">
                          <ChevronRightIcon className="h-4 w-4" />
                        </button>
                        <button type="button" onClick={() => removeMedia(i)} className="grid h-7 w-7 place-items-center rounded-md text-white hover:bg-white/15" aria-label="הסר">
                          <TrashIcon className="h-4 w-4" />
                        </button>
                        <button type="button" onClick={() => move(i, 1)} className="grid h-7 w-7 place-items-center rounded-md text-white hover:bg-white/15" aria-label="הזז אחורה">
                          <ChevronRightIcon className="h-4 w-4 rotate-180" />
                        </button>
                      </div>
                    )}
                  </div>
                ))}
                {!readOnly && form.media_urls.length < 10 && (
                  <>
                    <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading > 0}
                      className="grid aspect-square place-items-center rounded-row border border-dashed border-black/[0.15] text-center text-[13.5px] font-semibold text-text-dim transition-colors hover:border-gold-500/50 hover:text-gold-600">
                      <span className="flex flex-col items-center gap-1">
                        <PlusIcon className="h-5 w-5" />
                        {uploading > 0 ? `מעלה… (${uploading})` : 'העלאה'}
                      </span>
                    </button>
                    <button type="button" onClick={onOpenStudio}
                      className="grid aspect-square place-items-center rounded-row border border-gold-300/[0.4] bg-gold-500/[0.08] text-center text-[13.5px] font-bold text-gold-600 transition-colors hover:bg-gold-500/[0.14]">
                      <span className="px-1.5">עיצוב בסטודיו</span>
                    </button>
                  </>
                )}
              </div>
              <input ref={fileRef} type="file" multiple accept="image/*" className="hidden" onChange={onFiles} />
              {!readOnly && <span className="text-[13.5px] text-text-faint">כל תמונה מומרת אוטומטית ל-JPEG ומותאמת ליחס שאינסטגרם מקבל — בלי שגיאות פורמט.</span>}
            </div>

            <Field label="קישור" hint="אופציונלי — עמוד מוצר, מבצע או טופס">
              <TextInput dir="ltr" type="url" value={form.link_url} onChange={set('link_url')} placeholder="https://iconair.co.il/..." />
            </Field>

            <div className="flex flex-col gap-2">
              <span className="text-[15px] font-bold text-text-dim">לאן</span>
              <div className="flex flex-wrap gap-2.5">
                <Toggle on={form.facebook} onClick={() => toggle('facebook')} label="פייסבוק" hint={settings?.page_name} />
                <Toggle on={form.instagram} onClick={() => toggle('instagram')} label="אינסטגרם" hint={hasIg ? `@${settings.ig_username}` : 'לא מקושר'} disabled={!hasIg && !form.instagram} />
              </div>
            </div>

            {!readOnly && (
              <div className="flex flex-col gap-2.5">
                <span className="text-[15px] font-bold text-text-dim">מתי</span>
                <Pills value={form.mode} onChange={(v) => setForm((prev) => ({ ...prev, mode: v }))}
                  options={[{ value: 'now', label: 'עכשיו' }, { value: 'schedule', label: 'תזמון' }]} />
                {form.mode === 'schedule' && (
                  <>
                    <TextInput type="datetime-local" value={form.scheduled_at} onChange={set('scheduled_at')} />
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[13.5px] text-text-faint">שעות מומלצות:</span>
                      {SUGGESTED_TIMES.map((t) => (
                        <button key={t} type="button" onClick={() => pickTime(t)} className="chip tabular hover:border-gold-500/40 hover:text-gold-600">{t}</button>
                      ))}
                    </div>
                    <span className="text-[13.5px] leading-relaxed text-text-faint">
                      Autopilot מפרסם בדיוק בזמן — לפייסבוק ולאינסטגרם — גם כשהמערכת סגורה.
                    </span>
                  </>
                )}
              </div>
            )}
          </fieldset>

          {error && <div className="rounded-row border border-crit/25 bg-crit/[0.07] px-4 py-3 text-[14px] font-semibold text-crit-soft">{error}</div>}
        </div>

        <div className="lg:sticky lg:top-0 lg:self-start">
          <PostPreview
            caption={form.caption}
            media={form.media_urls}
            link={form.link_url}
            pageName={settings?.page_name}
            pagePicture={settings?.page_picture}
            igUsername={settings?.ig_username}
            platforms={{ facebook: form.facebook, instagram: form.instagram }}
          />
        </div>
      </div>
    </Modal>
  );
}

function Toggle({ on, onClick, label, hint, disabled }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className={`flex items-center gap-2.5 rounded-pill border px-4 py-2.5 text-[15px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        on ? 'border-gold-300/[0.5] bg-gold-500/[0.14] text-gold-600' : 'border-black/[0.09] text-text-dim'
      }`}>
      <span className={`grid h-5 w-5 place-items-center rounded-md border ${on ? 'border-gold-600 bg-gold-500 text-slate-950' : 'border-black/[0.2] bg-white'}`}>
        {on && <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="3"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>}
      </span>
      {label}
      {hint && <span className="max-w-[140px] truncate text-[13px] font-normal text-text-faint" dir="auto">{hint}</span>}
    </button>
  );
}

function PublishedSummary({ post }) {
  const fb = post.fb_metrics || {};
  const ig = post.ig_metrics || {};
  const rows = [
    post.fb_status && { name: 'פייסבוק', status: post.fb_status, error: post.fb_error, link: post.fb_permalink,
      stats: [['חשיפה', fb.reach], ['תגובות רגש', fb.reactions], ['תגובות', fb.comments], ['שיתופים', fb.shares], ['קליקים', fb.clicks]] },
    post.ig_status && { name: 'אינסטגרם', status: post.ig_status, error: post.ig_error, link: post.ig_permalink,
      stats: [['חשיפה', ig.reach], ['לייקים', ig.likes], ['תגובות', ig.comments], ['שמירות', ig.saved], ['צפיות', ig.views]] },
  ].filter(Boolean);

  return (
    <div className="flex flex-col gap-2.5">
      {rows.map((r) => (
        <div key={r.name} className="inner-row px-4 py-[15px]">
          <div className="mb-2.5 flex flex-wrap items-center gap-2.5">
            <span className="font-bold">{r.name}</span>
            <StatusChip tone={PLATFORM_STATUS[r.status]?.tone}>{PLATFORM_STATUS[r.status]?.label}</StatusChip>
            {r.link && <a href={r.link} target="_blank" rel="noreferrer" className="ms-auto text-[14px] font-semibold text-gold-600 hover:underline">לצפייה בפוסט ↗</a>}
          </div>
          {r.error && <div className="mb-2 text-[14px] text-crit-soft">{r.error}</div>}
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-5">
            {r.stats.map(([label, v]) => (
              <div key={label}>
                <div className="text-[12.5px] font-semibold text-text-faint">{label}</div>
                <div className="tabular text-[18px] font-bold">{v == null ? '—' : num(v)}</div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
