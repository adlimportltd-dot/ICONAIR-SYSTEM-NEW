import { useEffect, useState } from 'react';
import GlassCard, { CardHead } from '../../ui/GlassCard';
import { SparkleIcon, MegaphoneIcon } from '../../ui/Icons';
import { Field, TextArea, TextInput, PrimaryButton, SecondaryButton } from '../../ui/Field';
import { EmptyState } from '../../ui/States';
import MediaDropzone from './MediaDropzone';
import ProductPicker from './ProductPicker';
import SoundtrackPicker from './SoundtrackPicker';
import ScriptEditor from './ScriptEditor';
import ReelPreview from './ReelPreview';
import { reelSupport } from '../../../lib/reelRenderer';
import {
  generateScript, renderStudioReel, launchReel, fullCaption, TONES,
  type ReelScript, type ReelTone, type StudioImage, type RenderedReel,
} from '../../../lib/reelStudio';

type Toast = (t: { message: string; tone?: 'ok' | 'crit' | 'gold' }) => void;
interface SocialSettings { connected?: boolean; ig_user_id?: string | null; ig_username?: string | null }

interface Props {
  settings: SocialSettings | null;
  onToast: Toast;
  onPublished: () => void;
  onGoConnect: () => void;
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * סטודיו רילז (phase48): תמונות + מוצר מהקטלוג → תסריט, כתוביות וקפשן (/api/reel-studio)
 * → רינדור MP4 9:16 עם סאונד בדפדפן → תצוגה מקדימה → שיגור לפייסבוק/אינסטגרם.
 */
export default function ReelStudioPanel({ settings, onToast, onPublished, onGoConnect }: Props) {
  const [images, setImages] = useState<StudioImage[]>([]);
  const [product, setProduct] = useState<{ scentIds: string[]; modelIds: string[] }>({ scentIds: [], modelIds: [] });
  const [notes, setNotes] = useState('');
  const [tone, setTone] = useState<ReelTone>('warm');
  const [soundtrack, setSoundtrack] = useState('calm');

  const [script, setScript] = useState<ReelScript | null>(null);
  const [generating, setGenerating] = useState(false);
  const [changeText, setChangeText] = useState('');

  const [reel, setReel] = useState<RenderedReel | null>(null);
  const [rendering, setRendering] = useState<number | null>(null);

  const connected = Boolean(settings?.connected);
  const hasIg = Boolean(settings?.ig_user_id);
  const [facebook, setFacebook] = useState(true);
  const [instagram, setInstagram] = useState(true);
  const [when, setWhen] = useState('');
  const [launching, setLaunching] = useState<'now' | 'schedule' | null>(null);

  const support = reelSupport();

  // כל שינוי בתסריט/תמונות/סאונד אחרי רינדור = הסרטון כבר לא תואם
  useEffect(() => { setReel(null); }, [script, images, soundtrack]);
  useEffect(() => () => { if (reel) URL.revokeObjectURL(reel.localUrl); }, [reel]);

  async function generate(revise = false) {
    if (!images.length) return;
    setGenerating(true);
    try {
      const next = await generateScript({
        images: images.map((i) => i.url),
        scentIds: product.scentIds,
        modelIds: product.modelIds,
        notes,
        tone,
        ...(revise && script ? { previous: script, instructions: changeText } : {}),
      });
      setScript(next);
      setChangeText('');
    } catch (e) {
      onToast({ tone: 'crit', message: errorText(e) });
    } finally {
      setGenerating(false);
    }
  }

  async function render() {
    if (!script) return;
    setRendering(0);
    try {
      const out = await renderStudioReel({ script, images, soundtrack, onProgress: setRendering });
      setReel(out);
    } catch (e) {
      onToast({ tone: 'crit', message: `הרינדור נכשל: ${errorText(e)}` });
    } finally {
      setRendering(null);
    }
  }

  async function launch(mode: 'now' | 'schedule') {
    if (!script || !reel) return;
    if (mode === 'now' && !window.confirm('לשגר עכשיו את הרילז לרשתות?')) return;
    const scheduledAt = mode === 'schedule' ? new Date(when).toISOString() : null;
    if (mode === 'schedule' && (!when || Date.parse(scheduledAt!) < Date.now() + 60_000)) {
      onToast({ tone: 'crit', message: 'בחר מועד עתידי' });
      return;
    }
    setLaunching(mode);
    try {
      const r = await launchReel({
        reel, caption: fullCaption(script), facebook, instagram: instagram && hasIg, scheduledAt,
      });
      onToast({
        tone: r === 'published' ? 'ok' : 'gold',
        message: r === 'published' ? 'הרילז שוגר לרשתות ✓'
          : r === 'processing' ? 'שוגר — Meta מעבדת את הסרטון, הוא יעלה תוך כמה דקות'
          : `מתוזמן ל-${new Date(scheduledAt!).toLocaleString('he-IL', { weekday: 'long', hour: '2-digit', minute: '2-digit' })}`,
      });
      setScript(null);
      setImages([]);
      setNotes('');
      onPublished();
    } catch (e) {
      onToast({ tone: 'crit', message: errorText(e) });
    } finally {
      setLaunching(null);
    }
  }

  const chip = (on: boolean) => `rounded-pill border px-3 py-1.5 text-[14px] font-bold transition-colors ${
    on ? 'border-gold-300/[0.6] bg-gold-500/[0.14] text-gold-600' : 'border-black/[0.1] bg-white text-text-dim hover:border-gold-500/35'}`;

  return (
    <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      {/* ---------- 1. חומרים ומוצר ---------- */}
      <GlassCard>
        <CardHead icon={SparkleIcon} tone="gold" title="סטודיו רילז" subtitle="תמונות + מוצר → תסריט, כתוביות וקפשן → סרטון 9:16" />
        <div className="flex flex-col gap-5">
          <MediaDropzone images={images} onChange={setImages} onToast={onToast} />
          <ProductPicker scentIds={product.scentIds} modelIds={product.modelIds} onChange={setProduct} onToast={onToast} />
          <Field label="הערות מהשטח (אופציונלי)">
            <TextInput value={notes} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNotes(e.target.value)}
              placeholder="למשל: התקנה בקניון בחיפה, הלקוח ביקש ריח ענבר" />
          </Field>
          <div>
            <div className="mb-1.5 text-[14px] font-bold text-text-dim">טון</div>
            <div className="flex flex-wrap gap-1.5">
              {TONES.map((t) => <button key={t.value} type="button" onClick={() => setTone(t.value)} className={chip(tone === t.value)}>{t.label}</button>)}
            </div>
          </div>
          <SoundtrackPicker value={soundtrack} onChange={setSoundtrack} onToast={onToast} />
          <PrimaryButton onClick={() => generate(false)} loading={generating} disabled={!images.length || generating}>
            {generating ? 'כותב תסריט…' : images.length ? (script ? 'צור תסריט חדש' : 'צור תסריט, כתוביות וקפשן') : 'העלה תמונות כדי להתחיל'}
          </PrimaryButton>
        </div>
      </GlassCard>

      {/* ---------- 2. תצוגה מקדימה ושיגור ---------- */}
      <GlassCard>
        <CardHead icon={MegaphoneIcon} tone="gold" title="תצוגה מקדימה" subtitle={script ? script.title || script.hook : 'כאן יופיע הרילז'} />
        {!script ? (
          <EmptyState title="עוד אין תסריט" hint="העלה תמונות, בחר מוצר ולחץ “צור תסריט”." />
        ) : (
          <div className="flex flex-col gap-5">
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-[260px_minmax(0,1fr)] xl:grid-cols-1 2xl:grid-cols-[260px_minmax(0,1fr)]">
              <div className="flex flex-col gap-3">
                <ReelPreview script={script} images={images} reel={reel} rendering={rendering} />
                {!support.ok ? (
                  <div className="rounded-row border border-warn/30 bg-warn/[0.08] px-3 py-2.5 text-[13.5px] font-semibold text-warn">{support.reason}</div>
                ) : (
                  <SecondaryButton onClick={render} disabled={rendering != null}>
                    {rendering != null ? 'מרנדר…' : reel ? 'רנדר מחדש' : 'רנדר סרטון'}
                  </SecondaryButton>
                )}
                {reel && <a href={reel.videoUrl} download className="ghost-btn text-center">הורדת MP4</a>}
              </div>
              <ScriptEditor script={script} images={images} onChange={setScript} />
            </div>

            <div className="flex flex-col gap-2 rounded-row border border-black/[0.08] bg-ink-800 p-3.5">
              <TextArea rows={2} value={changeText} placeholder="לשפר משהו? למשל: הוק יותר מצחיק, להזכיר שירות בצפון"
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setChangeText(e.target.value)} />
              <SecondaryButton onClick={() => generate(true)} disabled={!changeText.trim() || generating}>
                {generating ? 'משכתב…' : 'שכתב לפי ההערה'}
              </SecondaryButton>
            </div>

            <div className="flex flex-col gap-3 rounded-row border border-gold-300/[0.35] bg-gold-500/[0.05] p-4">
              {!connected ? (
                <div className="flex flex-wrap items-center gap-3 text-[14.5px]">
                  <span className="font-semibold text-text-dim">Meta לא מחובר.</span>
                  <button type="button" className="ghost-btn" onClick={onGoConnect}>לחיבור</button>
                </div>
              ) : (
                <>
                  <div className="flex flex-wrap gap-4 text-[14.5px] font-semibold">
                    <label className="flex items-center gap-2"><input type="checkbox" checked={facebook} onChange={(e) => setFacebook(e.target.checked)} /> פייסבוק</label>
                    <label className={`flex items-center gap-2 ${hasIg ? '' : 'opacity-50'}`}>
                      <input type="checkbox" disabled={!hasIg} checked={instagram && hasIg} onChange={(e) => setInstagram(e.target.checked)} />
                      אינסטגרם{settings?.ig_username ? ` (@${settings.ig_username})` : ' (לא מחובר)'}
                    </label>
                  </div>
                  <PrimaryButton className="w-full" onClick={() => launch('now')} loading={launching === 'now'}
                    disabled={!reel || Boolean(launching) || (!facebook && !(instagram && hasIg))}>
                    {reel ? 'שגר לרשתות' : 'רנדר סרטון כדי לשגר'}
                  </PrimaryButton>
                  <div className="flex flex-wrap gap-2">
                    <TextInput type="datetime-local" value={when} className="min-w-0 flex-1"
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setWhen(e.target.value)} />
                    <SecondaryButton onClick={() => launch('schedule')} disabled={!reel || !when || Boolean(launching)}>
                      {launching === 'schedule' ? '…' : 'תזמן'}
                    </SecondaryButton>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </GlassCard>
    </div>
  );
}
