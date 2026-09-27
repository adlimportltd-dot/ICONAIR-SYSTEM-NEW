import { useState } from 'react';
import { StatusChip } from '../ui/DataTable';
import { TextArea, TextInput, PrimaryButton, SecondaryButton } from '../ui/Field';
import {
  approveContent, reviseContent, rejectContent, unscheduleContent, retryContent, clearRenderError,
  STATUS_META, KIND_LABEL, reelSeconds, toLocalDateTime,
  type ClaraContent, type ClaraAsset, type ApproveWhen,
} from '../../lib/clara';

interface Props {
  item: ClaraContent;
  assets: Map<string, ClaraAsset>;
  rendering?: { progress: number } | null;
  onToast: (t: { message: string; tone?: 'ok' | 'crit' | 'gold' }) => void;
  onRetryRender: (id: string) => void;
}

const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString('he-IL', { weekday: 'long', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });

export default function ContentCard({ item, assets, rendering, onToast, onRetryRender }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [mode, setMode] = useState<'idle' | 'revise' | 'custom'>('idle');
  const [text, setText] = useState('');
  const [when, setWhen] = useState('');
  const [open, setOpen] = useState(false);
  const meta = STATUS_META[item.status];
  const isReel = item.kind === 'reel';
  const lockRendering = item.render_error?.startsWith('rendering@');
  const renderFailed = item.render_error && !lockRendering;

  async function run(key: string, fn: () => Promise<unknown>, ok?: string) {
    setBusy(key);
    try {
      await fn();
      if (ok) onToast({ message: ok });
      setMode('idle');
      setText('');
    } catch (e) {
      onToast({ tone: 'crit', message: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  }

  const approve = (w: ApproveWhen, at?: string) => run(`approve:${w}`, () => approveContent(item.id, w, at));

  const images = isReel ? [] : (item.media_urls.length ? item.media_urls : item.asset_ids.map((id) => assets.get(id)?.public_url).filter(Boolean) as string[]);

  return (
    <article className="glass-card flex flex-col overflow-hidden">
      <div className="relative bg-ink-800">
        {isReel ? (
          item.video_url ? (
            <video src={item.video_url} poster={item.cover_url ?? undefined} controls playsInline preload="metadata" className="mx-auto aspect-[9/16] max-h-[520px] w-full bg-black object-contain" />
          ) : (
            <div className="grid aspect-[9/16] max-h-[520px] w-full place-items-center p-6 text-center">
              {rendering ? (
                <div className="w-full max-w-[220px]">
                  <div className="mb-2 text-[14px] font-bold text-text-dim">קלרה מרנדרת את הסרטון…</div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-ink-700">
                    <div className="h-full rounded-full bg-gold-500 transition-all" style={{ width: `${Math.round(rendering.progress * 100)}%` }} />
                  </div>
                  <div className="tabular mt-1.5 text-[13px] text-text-faint">{Math.round(rendering.progress * 100)}%</div>
                </div>
              ) : renderFailed ? (
                <div className="flex flex-col items-center gap-3">
                  <span className="text-[14px] font-semibold text-crit-soft">{item.render_error}</span>
                  <button type="button" className="ghost-btn" onClick={() => run('rerender', async () => {
                    await clearRenderError(item.id);
                    onRetryRender(item.id);
                  })}>לרנדר שוב</button>
                </div>
              ) : (
                <span className="text-[14px] text-text-faint">{lockRendering ? 'מרונדר בחלון אחר…' : 'ממתין לרינדור'}</span>
              )}
            </div>
          )
        ) : (
          <div className={`grid gap-0.5 ${images.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
            {images.slice(0, 4).map((src) => <img key={src} src={src} alt="" className="aspect-square w-full object-cover" />)}
            {!images.length && <div className="grid aspect-square place-items-center text-[14px] text-text-faint">מכינה תמונות…</div>}
          </div>
        )}
        <div className="absolute start-3 top-3 flex gap-1.5 [&>span]:bg-white [&>span]:shadow-lift">
          <span className="rounded-[8px]"><StatusChip tone={meta.tone}>{meta.label}</StatusChip></span>
          <span className="chip">{KIND_LABEL[item.kind]}{isReel ? ` · ${reelSeconds(item)}ש׳` : ''}</span>
          {item.revision > 1 && <span className="chip tabular">גרסה {item.revision}</span>}
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-3 p-5">
        <div>
          <h3 className="font-display text-[18px] font-extrabold leading-snug">{item.title}</h3>
          {item.hook && <p className="mt-1 text-[15px] font-semibold text-gold-600">״{item.hook}״</p>}
        </div>

        {item.status === 'scheduled' && item.scheduled_at && (
          <div className="inner-row px-4 py-3 text-[14.5px] font-semibold">מתוזמן ל{fmtWhen(item.scheduled_at)}</div>
        )}
        {item.status === 'published' && item.published_at && (
          <div className="inner-row px-4 py-3 text-[14.5px] font-semibold text-ok">פורסם {fmtWhen(item.published_at)}</div>
        )}

        <p className="line-clamp-4 whitespace-pre-wrap text-[14.5px] leading-relaxed text-text-dim">{item.caption}</p>
        <div className="flex flex-wrap gap-1.5">
          {item.hashtags.map((h) => <span key={h} className="text-[13.5px] font-semibold text-teal-500" dir="auto">{h}</span>)}
        </div>

        {isReel && item.scenes.length > 0 && (
          <button type="button" onClick={() => setOpen((v) => !v)} className="self-start text-[14px] font-semibold text-gold-600 hover:underline">
            {open ? 'הסתר תסריט' : `תסריט, כתוביות וקריינות (${item.scenes.length} סצנות)`}
          </button>
        )}
        {open && (
          <div className="flex flex-col gap-2">
            {item.scenes.map((s, i) => (
              <div key={`${s.asset_id}-${i}`} className="inner-row flex gap-3 px-3 py-2.5">
                {assets.get(s.asset_id) && (
                  <img src={assets.get(s.asset_id)!.thumb_url || assets.get(s.asset_id)!.public_url} alt="" className="h-14 w-10 flex-none rounded-md object-cover" />
                )}
                <div className="min-w-0 text-[13.5px]">
                  <div className="font-bold">{i + 1}. {s.on_screen} <span className="tabular font-normal text-text-faint">· {s.seconds}ש׳</span></div>
                  <div className="text-text-dim"><span className="font-semibold">קריינות:</span> {s.voiceover}</div>
                </div>
              </div>
            ))}
            <div className="text-[13.5px] text-text-faint"><b>הנעה לפעולה:</b> {item.cta}</div>
            <button type="button" className="self-start text-[13.5px] font-semibold text-gold-600 hover:underline"
              onClick={() => { navigator.clipboard?.writeText(item.voiceover); onToast({ message: 'טקסט הקריינות הועתק' }); }}>
              העתקת טקסט הקריינות המלא
            </button>
          </div>
        )}

        {mode === 'revise' && (
          <div className="flex flex-col gap-2">
            <TextArea rows={3} value={text} onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setText(e.target.value)}
              placeholder="מה לשנות? למשל: הוק יותר מצחיק, להזכיר שיש התקנה בצפון, בלי אימוג'ים" />
            <div className="flex gap-2">
              <PrimaryButton loading={busy === 'revise'} disabled={!text.trim()} onClick={() => run('revise', () => reviseContent(item.id, text))}>שלח לקלרה</PrimaryButton>
              <SecondaryButton onClick={() => setMode('idle')}>ביטול</SecondaryButton>
            </div>
          </div>
        )}
        {mode === 'custom' && (
          <div className="flex flex-col gap-2">
            <TextInput type="datetime-local" value={when} min={toLocalDateTime(new Date(Date.now() + 5 * 60000))}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setWhen(e.target.value)} />
            <div className="flex gap-2">
              <PrimaryButton loading={busy === 'approve:custom'} disabled={!when} onClick={() => approve('custom', new Date(when).toISOString())}>תזמן</PrimaryButton>
              <SecondaryButton onClick={() => setMode('idle')}>ביטול</SecondaryButton>
            </div>
          </div>
        )}

        <div className="mt-auto flex flex-wrap gap-2 pt-1">
          {item.status === 'pending_approval' && mode === 'idle' && (
            <>
              <PrimaryButton loading={busy === 'approve:today'} disabled={Boolean(busy)} onClick={() => approve('today')}>לפרסם היום</PrimaryButton>
              <SecondaryButton disabled={Boolean(busy)} onClick={() => approve('best')}>{busy === 'approve:best' ? '…' : 'בזמן הכי טוב'}</SecondaryButton>
              <SecondaryButton disabled={Boolean(busy)} onClick={() => approve('now')}>{busy === 'approve:now' ? '…' : 'עכשיו'}</SecondaryButton>
              <button type="button" className="ghost-btn" onClick={() => setMode('custom')}>מועד אחר</button>
              <button type="button" className="ghost-btn" onClick={() => setMode('revise')}>בקש שינוי</button>
              <button type="button" className="ghost-btn text-crit-soft" disabled={Boolean(busy)}
                onClick={() => window.confirm('לדחות את התוכן הזה?') && run('reject', () => rejectContent(item.id))}>דחה</button>
            </>
          )}
          {item.status === 'draft' && !isReel && mode === 'idle' && (
            <button type="button" className="ghost-btn" onClick={() => setMode('revise')}>בקש שינוי</button>
          )}
          {item.status === 'scheduled' && (
            <button type="button" className="ghost-btn" disabled={Boolean(busy)} onClick={() => run('unschedule', () => unscheduleContent(item.id))}>
              {busy === 'unschedule' ? '…' : 'בטל תזמון'}
            </button>
          )}
          {item.status === 'failed' && (
            <PrimaryButton loading={busy === 'retry'} onClick={() => run('retry', () => retryContent(item.id))}>נסה לפרסם שוב</PrimaryButton>
          )}
          {item.video_url && (
            <a href={item.video_url} download className="ghost-btn">הורדת MP4</a>
          )}
        </div>
      </div>
    </article>
  );
}
