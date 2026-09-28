import { useEffect, useRef, useState } from 'react';
import { SOUND_PRESETS, buildSoundtrack, isPreset } from '../../../lib/soundtrack';
import { uploadMusic } from '../../../lib/reelStudio';

interface Props {
  value: string;
  onChange: (v: string) => void;
  onToast: (t: { message: string; tone?: 'ok' | 'crit' | 'gold' }) => void;
}

const PREVIEW_SECONDS = 8;

/** פסקול לרילז: מוזיקה מקורית מסונתזת (בלי בעיות זכויות) או קובץ שהעליתם. */
export default function SoundtrackPicker({ value, onChange, onToast }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const playing = useRef<{ ctx: AudioContext; src: AudioBufferSourceNode } | null>(null);
  const [busy, setBusy] = useState<'upload' | 'preview' | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const custom = !isPreset(value);

  const stop = () => {
    const p = playing.current;
    playing.current = null;
    setIsPlaying(false);
    if (p) { try { p.src.stop(); } catch { /* כבר נעצר */ } p.ctx.close().catch(() => undefined); }
  };
  useEffect(() => stop, []);

  async function preview() {
    if (isPlaying) return stop();
    setBusy('preview');
    try {
      const buf = await buildSoundtrack(value, PREVIEW_SECONDS);
      if (!buf) return;
      const ctx = new AudioContext();
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      src.onended = () => { if (playing.current?.src === src) stop(); };
      src.start();
      playing.current = { ctx, src };
      setIsPlaying(true);
    } catch (e) {
      onToast({ tone: 'crit', message: e instanceof Error ? e.message : 'לא הצלחתי לנגן' });
    } finally {
      setBusy(null);
    }
  }

  async function upload(file: File) {
    stop();
    setBusy('upload');
    try {
      onChange(await uploadMusic(file));
      onToast({ message: 'המוזיקה הועלתה — היא תתנגן ברילז' });
    } catch (e) {
      onToast({ tone: 'crit', message: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  }

  const pick = (v: string) => { stop(); onChange(v); };
  const chip = (on: boolean) => `rounded-pill border px-3 py-1.5 text-[14px] font-bold transition-colors ${
    on ? 'border-gold-300/[0.6] bg-gold-500/[0.14] text-gold-600' : 'border-black/[0.1] bg-white text-text-dim hover:border-gold-500/35'}`;

  return (
    <div>
      <div className="mb-1.5 text-[14px] font-bold text-text-dim">סאונד לרילז</div>
      <div className="flex flex-wrap items-center gap-1.5">
        {SOUND_PRESETS.map((p) => (
          <button key={p.value} type="button" title={p.hint} onClick={() => pick(p.value)} className={chip(value === p.value)}>{p.label}</button>
        ))}
        <button type="button" onClick={() => fileRef.current?.click()} disabled={busy === 'upload'} className={chip(custom)}>
          {busy === 'upload' ? 'מעלה…' : custom ? '✓ מוזיקה משלי' : 'מוזיקה משלי…'}
        </button>
        {value !== 'none' && (
          <button type="button" onClick={preview} disabled={busy === 'preview'} className="ghost-btn !py-1.5">
            {busy === 'preview' ? '…' : isPlaying ? '■ עצור' : '▶ השמע'}
          </button>
        )}
        <input ref={fileRef} type="file" accept="audio/*,.mp3,.m4a,.wav" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ''; }} />
      </div>
      {custom && <p className="mt-1.5 text-[13px] text-text-faint">ודאו שיש לכם זכות להשתמש במוזיקה — Meta משתיקה סרטונים עם שירים מוגנים.</p>}
    </div>
  );
}
