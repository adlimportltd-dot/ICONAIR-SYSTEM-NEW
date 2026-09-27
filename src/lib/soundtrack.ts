/**
 * פסקול לרילז — נבנה בדפדפן, בלי ספריות ובלי בעיות זכויות יוצרים:
 *  - preset: מוזיקת רקע מסונתזת (OfflineAudioContext) — מקורית, שייכת לכם.
 *  - קובץ שהעליתם (URL): מפוענח, נחתך/נכפל לאורך הסרטון, עם fade-in/out.
 * הפלט: AudioBuffer ב-48kHz סטריאו, שהרנדרר מקודד ל-AAC בתוך ה-MP4.
 */

export type SoundPreset = 'none' | 'calm' | 'upbeat' | 'luxury';

export const SOUND_PRESETS: { value: SoundPreset; label: string; hint: string }[] = [
  { value: 'calm', label: 'רגוע', hint: 'פד רך — מתאים לריח ולאווירה' },
  { value: 'upbeat', label: 'אנרגטי', hint: 'קצב קליל — התקנות ולפני/אחרי' },
  { value: 'luxury', label: 'יוקרה', hint: 'אקורדים עמוקים — מלונות ובוטיק' },
  { value: 'none', label: 'בלי סאונד', hint: '' },
];

export const isPreset = (v: string): v is SoundPreset => ['none', 'calm', 'upbeat', 'luxury'].includes(v);

const SR = 48000;

const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

const PROGRESSIONS: Record<Exclude<SoundPreset, 'none'>, { chords: number[][]; bpm: number }> = {
  // Cmaj7 · Am7 · Fmaj7 · G6
  calm: { chords: [[48, 55, 59, 64], [45, 52, 55, 60], [41, 48, 52, 57], [43, 50, 55, 59]], bpm: 72 },
  // Am · F · C · G — קליל ומתקדם
  upbeat: { chords: [[45, 52, 57, 60], [41, 48, 53, 57], [48, 55, 60, 64], [43, 50, 55, 59]], bpm: 112 },
  // Dm9 · Bbmaj7 · Gm9 · Asus
  luxury: { chords: [[38, 50, 53, 57, 64], [34, 50, 53, 57, 62], [31, 50, 53, 58, 62], [33, 52, 57, 59, 64]], bpm: 64 },
};

function pad(ctx: OfflineAudioContext, out: AudioNode, notes: number[], start: number, dur: number, level: number) {
  for (const n of notes) {
    for (const [type, detune, gainMul] of [['sine', 0, 1], ['triangle', 7, 0.35]] as const) {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = hz(n);
      osc.detune.value = detune;
      const g = ctx.createGain();
      const peak = (level * gainMul) / notes.length;
      g.gain.setValueAtTime(0, start);
      g.gain.linearRampToValueAtTime(peak, start + Math.min(0.8, dur * 0.3));
      g.gain.setValueAtTime(peak, start + dur * 0.75);
      g.gain.linearRampToValueAtTime(0, start + dur + 0.25);
      osc.connect(g).connect(out);
      osc.start(start);
      osc.stop(start + dur + 0.3);
    }
  }
}

function kick(ctx: OfflineAudioContext, out: AudioNode, t: number) {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.frequency.setValueAtTime(120, t);
  osc.frequency.exponentialRampToValueAtTime(45, t + 0.18);
  g.gain.setValueAtTime(0.55, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
  osc.connect(g).connect(out);
  osc.start(t);
  osc.stop(t + 0.3);
}

function hat(ctx: OfflineAudioContext, out: AudioNode, noise: AudioBuffer, t: number) {
  const src = ctx.createBufferSource();
  src.buffer = noise;
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 7000;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.12, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
  src.connect(hp).connect(g).connect(out);
  src.start(t);
  src.stop(t + 0.06);
}

async function synthesize(preset: Exclude<SoundPreset, 'none'>, seconds: number): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(2, Math.ceil(seconds * SR), SR);
  const master = ctx.createGain();
  master.gain.value = 0.9;
  const lowpass = ctx.createBiquadFilter();
  lowpass.type = 'lowpass';
  lowpass.frequency.value = preset === 'upbeat' ? 5200 : 2600;
  // "חלל" עדין: דיליי עם משוב
  const delay = ctx.createDelay(1);
  delay.delayTime.value = 0.28;
  const feedback = ctx.createGain();
  feedback.gain.value = 0.28;
  delay.connect(feedback).connect(delay);
  lowpass.connect(master);
  lowpass.connect(delay);
  delay.connect(master);
  master.connect(ctx.destination);

  const { chords, bpm } = PROGRESSIONS[preset];
  const beat = 60 / bpm;
  const bar = beat * 4;
  for (let t = 0, i = 0; t < seconds; t += bar, i += 1) {
    pad(ctx, lowpass, chords[i % chords.length], t, bar, preset === 'luxury' ? 0.5 : 0.42);
  }
  if (preset === 'upbeat') {
    const noise = ctx.createBuffer(1, SR / 10, SR);
    const data = noise.getChannelData(0);
    for (let k = 0; k < data.length; k += 1) data[k] = Math.random() * 2 - 1;
    for (let t = 0; t < seconds; t += beat) {
      kick(ctx, master, t);
      hat(ctx, master, noise, t + beat / 2);
    }
  }
  const rendered = await ctx.startRendering();
  return fades(rendered, 0.6, 1.4);
}

async function fromFile(url: string, seconds: number): Promise<AudioBuffer> {
  const res = await fetch(url, { mode: 'cors' });
  if (!res.ok) throw new Error('קובץ המוזיקה לא נטען');
  const bytes = await res.arrayBuffer();
  const decoded = await new OfflineAudioContext(2, SR, SR).decodeAudioData(bytes);
  const ctx = new OfflineAudioContext(2, Math.ceil(seconds * SR), SR);
  const gain = ctx.createGain();
  gain.gain.value = 0.85;
  gain.connect(ctx.destination);
  for (let t = 0; t < seconds; t += decoded.duration) {
    const src = ctx.createBufferSource();
    src.buffer = decoded;
    src.connect(gain);
    src.start(t);
  }
  return fades(await ctx.startRendering(), 0.4, 1.4);
}

function fades(buf: AudioBuffer, inSec: number, outSec: number): AudioBuffer {
  const fi = Math.floor(inSec * buf.sampleRate);
  const fo = Math.floor(outSec * buf.sampleRate);
  for (let ch = 0; ch < buf.numberOfChannels; ch += 1) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < fi && i < d.length; i += 1) d[i] *= i / fi;
    for (let i = 0; i < fo && i < d.length; i += 1) d[d.length - 1 - i] *= i / fo;
  }
  return buf;
}

/** null = בלי סאונד */
export async function buildSoundtrack(source: string | null | undefined, seconds: number): Promise<AudioBuffer | null> {
  if (!source || source === 'none') return null;
  if (isPreset(source)) return source === 'none' ? null : synthesize(source, seconds);
  if (/^https?:\/\//.test(source)) return fromFile(source, seconds);
  return null;
}
