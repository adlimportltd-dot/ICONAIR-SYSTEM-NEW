/**
 * רינדור רילז בדפדפן — WebCodecs (H.264) + mp4-muxer → MP4 שאינסטגרם מקבל.
 *
 * למה לא MediaRecorder: אינסטגרם דורש MP4 עם moov בתחילת הקובץ ובלי edit
 * lists; MediaRecorder מייצר קבצים שלא עומדים בזה באופן עקבי. כאן מקודדים
 * פריים-פריים (מהר מזמן אמת), ו-mp4-muxer עם fastStart:'in-memory' כותב
 * moov בהתחלה ובלי edts.
 *
 * מבנה הסרטון (1080×1920, 30fps): סצנה לכל נכס (תנועת מצלמה עדינה על תמונה,
 * או קטע מהסרטון), כתובית גדולה בכל סצנה, מעבר רך בין סצנות, ומסך סיום עם
 * ההנעה לפעולה + iconair.co.il. צבעי המותג בלבד.
 */
import { Muxer, ArrayBufferTarget } from 'mp4-muxer';

export interface RenderScene {
  url: string;              // תמונה (JPEG) או סרטון
  type: 'image' | 'video';
  seconds: number;
  onScreen: string;
}

export interface RenderInput {
  scenes: RenderScene[];
  cta: string;
  logoUrl?: string | null;
  /** פסקול (48kHz). null/חסר = ערוץ שקט. נחתך/מושלם בשקט לאורך הסרטון. */
  audio?: AudioBuffer | null;
  onProgress?: (fraction: number) => void;
  /** בדיקות בלבד: דפדפני בדיקה בלי מקודד H.264. בפרודקשן תמיד H.264 (אינסטגרם). */
  _testCodec?: 'vp9';
}

export interface RenderOutput { video: Blob; cover: Blob; seconds: number }

const W = 1080;
const H = 1920;
const FPS = 30;
const END_SECONDS = 2.2;
const FADE = 0.35;
const SR = 48000;
const INK = '#020617';
const AMBER = '#F59E0B';

export function reelSupport(): { ok: boolean; reason?: string } {
  if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') {
    return { ok: false, reason: 'הדפדפן לא תומך ביצירת וידאו (WebCodecs). פתח את המערכת בכרום או אדג׳ עדכניים במחשב.' };
  }
  return { ok: true };
}

async function pickCodec(): Promise<string> {
  for (const codec of ['avc1.640028', 'avc1.4d0028', 'avc1.42002a']) {
    const { supported } = await VideoEncoder.isConfigSupported({ codec, width: W, height: H, bitrate: 8_000_000, framerate: FPS });
    if (supported) return codec;
  }
  throw new Error('הדפדפן לא יודע לקודד H.264 ברזולוציית רילז');
}

async function audioSupported(codec: string): Promise<boolean> {
  if (typeof AudioEncoder === 'undefined') return false;
  try {
    const { supported } = await AudioEncoder.isConfigSupported({ codec, sampleRate: SR, numberOfChannels: 2, bitrate: 160000 });
    return Boolean(supported);
  } catch {
    return false;
  }
}

/* ---------------------------- טעינת מדיה ---------------------------- */

async function fetchAsObjectUrl(url: string): Promise<string> {
  // דרך blob כדי שה-canvas לא יהיה "tainted" (אחרת VideoFrame נכשל)
  const res = await fetch(url, { mode: 'cors' });
  if (!res.ok) throw new Error('לא הצלחתי להוריד מדיה לרינדור');
  return URL.createObjectURL(await res.blob());
}

const loadImage = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = () => reject(new Error('תמונה לא נטענה'));
  img.src = src;
});

async function loadVideo(src: string): Promise<HTMLVideoElement> {
  const v = document.createElement('video');
  v.muted = true;
  v.playsInline = true;
  v.preload = 'auto';
  v.src = src;
  await new Promise<void>((resolve, reject) => {
    v.onloadeddata = () => resolve();
    v.onerror = () => reject(new Error('סרטון לא נטען'));
  });
  return v;
}

const seek = (v: HTMLVideoElement, t: number) => new Promise<void>((resolve) => {
  if (Math.abs(v.currentTime - t) < 0.001) { resolve(); return; }
  v.onseeked = () => resolve();
  v.currentTime = t;
});

/* ---------------------------- ציור ---------------------------- */

type Media = { kind: 'image'; el: HTMLImageElement } | { kind: 'video'; el: HTMLVideoElement };

function drawCover(ctx: CanvasRenderingContext2D, el: CanvasImageSource, sw: number, sh: number, zoom: number, panX: number, panY: number) {
  const scale = Math.max(W / sw, H / sh) * zoom;
  const dw = sw * scale;
  const dh = sh * scale;
  const x = (W - dw) / 2 + panX * (dw - W) / 2;
  const y = (H - dh) / 2 + panY * (dh - H) / 2;
  ctx.drawImage(el, x, y, dw, dh);
}

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxWidth && line) { lines.push(line); line = w; } else line = test;
  }
  if (line) lines.push(line);
  return lines.slice(0, 3);
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawCaption(ctx: CanvasRenderingContext2D, text: string, appear: number) {
  if (!text) return;
  const eased = 1 - (1 - Math.min(1, appear)) ** 3;
  ctx.save();
  ctx.globalAlpha = eased;
  ctx.font = '800 76px "Assistant", sans-serif';
  ctx.direction = 'rtl';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const lines = wrapLines(ctx, text, W - 200);
  const lh = 92;
  const boxH = lines.length * lh + 56;
  const boxW = Math.min(W - 120, Math.max(...lines.map((l) => ctx.measureText(l).width)) + 96);
  const y0 = H * 0.66 + (1 - eased) * 40;
  ctx.fillStyle = 'rgba(2,6,23,0.72)';
  roundRect(ctx, (W - boxW) / 2, y0, boxW, boxH, 36);
  ctx.fill();
  ctx.fillStyle = AMBER;
  ctx.fillRect(W / 2 - 60, y0 - 4, 120, 8);
  ctx.fillStyle = '#FFFFFF';
  lines.forEach((l, i) => ctx.fillText(l, W / 2, y0 + 28 + lh / 2 + i * lh));
  ctx.restore();
}

function drawBrand(ctx: CanvasRenderingContext2D, logo: HTMLImageElement | null) {
  const g = ctx.createLinearGradient(0, 0, 0, 320);
  g.addColorStop(0, 'rgba(2,6,23,0.55)');
  g.addColorStop(1, 'rgba(2,6,23,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, 320);
  if (logo) {
    const h = 64;
    const w = (logo.naturalWidth / logo.naturalHeight) * h;
    ctx.drawImage(logo, W - 72 - w, 96, w, h);
  } else {
    ctx.font = '900 54px "Frank Ruhl Libre", serif';
    ctx.fillStyle = '#FFFFFF';
    ctx.textAlign = 'right';
    ctx.direction = 'ltr';
    ctx.textBaseline = 'top';
    ctx.fillText('ICONAIR', W - 72, 96);
  }
}

function drawEnd(ctx: CanvasRenderingContext2D, t: number, cta: string, logo: HTMLImageElement | null) {
  ctx.fillStyle = INK;
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W * 0.75, H * 0.2, 0, W * 0.75, H * 0.2, W);
  glow.addColorStop(0, 'rgba(245,158,11,0.30)');
  glow.addColorStop(1, 'rgba(245,158,11,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);
  const a = Math.min(1, t / 0.4);
  ctx.globalAlpha = a;
  if (logo) {
    const h = 150;
    const w = (logo.naturalWidth / logo.naturalHeight) * h;
    ctx.drawImage(logo, (W - w) / 2, H * 0.3, w, h);
  } else {
    ctx.font = '900 150px "Frank Ruhl Libre", serif';
    ctx.fillStyle = '#FFFFFF';
    ctx.textAlign = 'center';
    ctx.direction = 'ltr';
    ctx.textBaseline = 'middle';
    ctx.fillText('ICONAIR', W / 2, H * 0.36);
  }
  ctx.font = '800 80px "Assistant", sans-serif';
  ctx.direction = 'rtl';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#FFFFFF';
  wrapLines(ctx, cta || 'להזמנה באתר', W - 180).forEach((l, i) => ctx.fillText(l, W / 2, H * 0.52 + i * 96));
  ctx.fillStyle = AMBER;
  roundRect(ctx, W / 2 - 330, H * 0.66, 660, 120, 60);
  ctx.fill();
  ctx.fillStyle = INK;
  ctx.font = '800 58px "Assistant", sans-serif';
  ctx.direction = 'ltr';
  ctx.fillText('iconair.co.il', W / 2, H * 0.66 + 62);
  ctx.globalAlpha = 1;
}

/* ---------------------------- רינדור ---------------------------- */

export async function renderReel(input: RenderInput): Promise<RenderOutput> {
  const support = reelSupport();
  if (!support.ok) throw new Error(support.reason);
  if (!input.scenes.length) throw new Error('אין סצנות לרינדור');

  await Promise.all([
    document.fonts?.load('800 76px "Assistant"'),
    document.fonts?.load('900 54px "Frank Ruhl Libre"'),
  ]).catch(() => undefined);

  const objectUrls: string[] = [];
  const media: Media[] = [];
  try {
    for (const s of input.scenes) {
      const local = await fetchAsObjectUrl(s.url);
      objectUrls.push(local);
      media.push(s.type === 'video' ? { kind: 'video', el: await loadVideo(local) } : { kind: 'image', el: await loadImage(local) });
    }
    let logo: HTMLImageElement | null = null;
    if (input.logoUrl) {
      try {
        const u = await fetchAsObjectUrl(input.logoUrl);
        objectUrls.push(u);
        logo = await loadImage(u);
      } catch { logo = null; }
    }

    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d', { alpha: false })!;

    const codec = input._testCodec === 'vp9' ? 'vp09.00.40.08' : await pickCodec();
    // בפרודקשן AAC (אינסטגרם). בדיקות: Opus, כי לדפדפני בדיקה אין מקודד AAC.
    const audioCodec = input._testCodec === 'vp9' ? 'opus' : 'mp4a.40.2';
    const withAudio = await audioSupported(audioCodec);
    const target = new ArrayBufferTarget();
    if (input.audio && !withAudio) console.warn('קידוד שמע לא נתמך בדפדפן — הסרטון ייצא בלי סאונד');
    const muxer = new Muxer({
      target,
      video: { codec: input._testCodec === 'vp9' ? 'vp9' : 'avc', width: W, height: H, frameRate: FPS },
      ...(withAudio ? { audio: { codec: audioCodec === 'opus' ? 'opus' as const : 'aac' as const, sampleRate: SR, numberOfChannels: 2 } } : {}),
      fastStart: 'in-memory',
      firstTimestampBehavior: 'offset',
    });

    let encodeError: Error | null = null;
    const encoder = new VideoEncoder({
      output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
      error: (e) => { encodeError = e instanceof Error ? e : new Error(String(e)); },
    });
    encoder.configure({ codec, width: W, height: H, bitrate: 8_000_000, framerate: FPS, ...(input._testCodec ? {} : { avc: { format: 'avc' as const } }) });

    const starts: number[] = [];
    let acc = 0;
    for (const s of input.scenes) { starts.push(acc); acc += s.seconds; }
    const total = acc + END_SECONDS;
    const frames = Math.ceil(total * FPS);
    let cover: Blob | null = null;

    const drawScene = async (i: number, local: number, alpha: number) => {
      const m = media[i];
      const dir = i % 2 === 0 ? 1 : -1;
      const p = Math.min(1, local / Math.max(0.1, input.scenes[i].seconds));
      ctx.globalAlpha = alpha;
      if (m.kind === 'image') {
        drawCover(ctx, m.el, m.el.naturalWidth, m.el.naturalHeight, 1.06 + 0.1 * p, dir * (0.5 - p) * 0.6, -0.2 + 0.2 * p);
      } else {
        const dur = m.el.duration || input.scenes[i].seconds;
        await seek(m.el, Math.min(Math.max(0, dur - 0.05), local));
        drawCover(ctx, m.el, m.el.videoWidth, m.el.videoHeight, 1.02, 0, 0);
      }
      ctx.globalAlpha = 1;
    };

    for (let f = 0; f < frames; f += 1) {
      if (encodeError) throw encodeError;
      const t = f / FPS;
      ctx.fillStyle = INK;
      ctx.fillRect(0, 0, W, H);

      if (t >= acc) {
        drawEnd(ctx, t - acc, input.cta, logo);
      } else {
        let i = starts.findIndex((s, k) => t >= s && t < s + input.scenes[k].seconds);
        if (i < 0) i = input.scenes.length - 1;
        const local = t - starts[i];
        await drawScene(i, local, 1);
        // מעבר רך מהסצנה הקודמת
        if (i > 0 && local < FADE) await drawScene(i - 1, input.scenes[i - 1].seconds + local, 1 - local / FADE);
        drawBrand(ctx, logo);
        drawCaption(ctx, input.scenes[i].onScreen, local / 0.35);
        // מעבר למסך הסיום
        if (t > acc - FADE) {
          ctx.globalAlpha = (t - (acc - FADE)) / FADE;
          drawEnd(ctx, 0, input.cta, logo);
          ctx.globalAlpha = 1;
        }
      }

      if (f === Math.round(Math.min(1.2, (input.scenes[0].seconds || 2) * 0.6) * FPS)) {
        cover = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.9));
      }

      const frame = new VideoFrame(canvas, { timestamp: Math.round((f * 1_000_000) / FPS), duration: Math.round(1_000_000 / FPS) });
      encoder.encode(frame, { keyFrame: f % (FPS * 2) === 0 });
      frame.close();
      while (encoder.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 4));
      if (f % 15 === 0) input.onProgress?.(f / frames);
    }
    await encoder.flush();
    encoder.close();

    // ערוץ שמע (AAC): הפסקול אם נבחר, אחרת שקט — חלק מהנגנים/פלטפורמות מעדיפים שיהיה אחד
    if (withAudio) {
      let audioError: Error | null = null;
      const audioEncoder = new AudioEncoder({
        output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
        error: (e) => { audioError = e instanceof Error ? e : new Error(String(e)); },
      });
      audioEncoder.configure({ codec: audioCodec, sampleRate: SR, numberOfChannels: 2, bitrate: 160000 });
      const src = input.audio && input.audio.sampleRate === SR ? input.audio : null;
      const left = src?.getChannelData(0);
      const right = src ? src.getChannelData(Math.min(1, src.numberOfChannels - 1)) : undefined;
      const block = 1024;
      const totalSamples = Math.ceil(total * SR);
      for (let s = 0; s < totalSamples; s += block) {
        if (audioError) throw audioError;
        const buf = new Float32Array(block * 2);
        if (left && right) {
          const n = Math.max(0, Math.min(block, left.length - s));
          if (n > 0) {
            buf.set(left.subarray(s, s + n), 0);
            buf.set(right.subarray(s, s + n), block);
          }
        }
        const data = new AudioData({
          format: 'f32-planar', sampleRate: SR, numberOfFrames: block, numberOfChannels: 2,
          timestamp: Math.round((s / SR) * 1_000_000), data: buf,
        });
        audioEncoder.encode(data);
        data.close();
        while (audioEncoder.encodeQueueSize > 16) await new Promise((r) => setTimeout(r, 2));
      }
      await audioEncoder.flush();
      audioEncoder.close();
      if (audioError) throw audioError;
    }

    muxer.finalize();
    input.onProgress?.(1);
    if (!cover) cover = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.9));
    return { video: new Blob([target.buffer], { type: 'video/mp4' }), cover: cover!, seconds: total };
  } finally {
    objectUrls.forEach((u) => URL.revokeObjectURL(u));
  }
}
