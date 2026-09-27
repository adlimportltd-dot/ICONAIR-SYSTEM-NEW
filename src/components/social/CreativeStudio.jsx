import { useCallback, useEffect, useRef, useState } from 'react';
import Modal from '../ui/Modal';
import { Field, TextInput, PrimaryButton, SecondaryButton } from '../ui/Field';
import { Pills } from './SocialUI';
import { describeError } from '../../lib/supabase';
import { uploadSocialImage } from '../../lib/social';
import { brandLogoUrl, BRAND_LOGO_EXT_FALLBACK } from '../../lib/queries';

/**
 * סטודיו קריאייטיב — מעצב תמונות ממותגות ICONAIR ישירות במערכת (Canvas),
 * ומייצא JPEG מוכן לאינסטגרם/פייסבוק. בלי Canva, בלי הורדות והעלאות.
 * צבעי המותג בלבד: נייבי-שחור #020617, ענבר #F59E0B, לבן, slate #F1F5F9.
 */

const FORMATS = [
  { value: 'portrait', label: 'פיד 4:5', w: 1080, h: 1350 },
  { value: 'square', label: 'ריבוע 1:1', w: 1080, h: 1080 },
  { value: 'landscape', label: 'רחב 1.91:1', w: 1200, h: 628 },
];

const TEMPLATES = [
  { value: 'hero', label: 'תמונה מלאה' },
  { value: 'offer', label: 'מבצע' },
  { value: 'frame', label: 'מסגרת נקייה' },
  { value: 'statement', label: 'משפט מותג' },
];

const INK = '#020617';
const AMBER = '#F59E0B';
const MIST = '#F1F5F9';

const defaults = {
  format: 'portrait', template: 'hero',
  headline: 'ריח שמשאיר רושם', sub: 'מפיצי ריח חכמים לעסקים ולבית — התקנה ושירות בכל הארץ',
  cta: 'להזמנה באתר', badge: '10%', badgeLabel: 'הנחה', logo: true,
};

async function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

async function loadLogo() {
  for (const ext of BRAND_LOGO_EXT_FALLBACK) {
    try {
      const res = await fetch(brandLogoUrl(ext), { mode: 'cors' });
      if (!res.ok) continue;
      const blob = await res.blob();
      return await loadImage(URL.createObjectURL(blob));
    } catch { /* ננסה סיומת אחרת */ }
  }
  return null;
}

function wrap(ctx, text, maxWidth) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = w;
    } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

function drawText(ctx, text, { x, y, size, weight = 700, family = 'Assistant', color = '#fff', maxWidth, lineHeight = 1.18, align = 'right', maxLines = 4 }) {
  ctx.font = `${weight} ${size}px "${family}", sans-serif`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.direction = 'rtl';
  ctx.textBaseline = 'top';
  const lines = wrap(ctx, text, maxWidth).slice(0, maxLines);
  lines.forEach((l, i) => ctx.fillText(l, x, y + i * size * lineHeight));
  return y + lines.length * size * lineHeight;
}

function cover(ctx, img, x, y, w, h) {
  const r = Math.max(w / img.naturalWidth, h / img.naturalHeight);
  const iw = img.naturalWidth * r;
  const ih = img.naturalHeight * r;
  ctx.drawImage(img, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function pill(ctx, text, { x, y, size, bg = AMBER, color = INK, align = 'right' }) {
  ctx.font = `800 ${size}px "Assistant", sans-serif`;
  ctx.direction = 'rtl';
  const tw = ctx.measureText(text).width;
  const pw = tw + size * 1.6;
  const ph = size * 1.9;
  const px = align === 'right' ? x - pw : x;
  ctx.fillStyle = bg;
  roundRect(ctx, px, y, pw, ph, ph / 2);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, px + pw / 2, y + ph / 2 + size * 0.04);
  ctx.textBaseline = 'top';
  return ph;
}

function render(canvas, s, photo, logo) {
  const f = FORMATS.find((x) => x.value === s.format) ?? FORMATS[0];
  canvas.width = f.w;
  canvas.height = f.h;
  const ctx = canvas.getContext('2d');
  const W = f.w;
  const H = f.h;
  const P = Math.round(W * 0.075);
  const scale = Math.min(W, H) / 1080;
  const right = W - P;
  const textW = W - P * 2;

  ctx.clearRect(0, 0, W, H);

  const drawLogo = (x, y, maxH, onDark) => {
    if (!s.logo) return;
    if (logo) {
      const h = maxH;
      const w = (logo.naturalWidth / logo.naturalHeight) * h;
      ctx.drawImage(logo, x - w, y, w, h);
    } else {
      ctx.font = `900 ${Math.round(maxH * 0.72)}px "Frank Ruhl Libre", serif`;
      ctx.fillStyle = onDark ? '#fff' : INK;
      ctx.textAlign = 'right';
      ctx.direction = 'ltr';
      ctx.textBaseline = 'top';
      ctx.fillText('ICONAIR', x, y);
    }
  };

  if (s.template === 'hero') {
    ctx.fillStyle = INK;
    ctx.fillRect(0, 0, W, H);
    if (photo) cover(ctx, photo, 0, 0, W, H);
    const g = ctx.createLinearGradient(0, H * 0.35, 0, H);
    g.addColorStop(0, 'rgba(2,6,23,0)');
    g.addColorStop(1, 'rgba(2,6,23,0.92)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    drawLogo(right, P, 58 * scale, true);

    const hs = Math.round(88 * scale);
    ctx.font = `900 ${hs}px "Frank Ruhl Libre"`;
    const hLines = wrap(ctx, s.headline, textW).slice(0, 3).length;
    ctx.font = `600 ${Math.round(36 * scale)}px "Assistant"`;
    const sLines = s.sub ? wrap(ctx, s.sub, textW).slice(0, 3).length : 0;
    let y = H - P - (s.cta ? 72 * scale + 26 * scale : 0) - sLines * 36 * scale * 1.3 - 18 * scale - hLines * hs * 1.1;
    y = drawText(ctx, s.headline, { x: right, y, size: hs, weight: 900, family: 'Frank Ruhl Libre', maxWidth: textW, lineHeight: 1.1, maxLines: 3 });
    y += 18 * scale;
    if (s.sub) y = drawText(ctx, s.sub, { x: right, y, size: Math.round(36 * scale), weight: 600, color: 'rgba(255,255,255,0.88)', maxWidth: textW, lineHeight: 1.3, maxLines: 3 });
    if (s.cta) pill(ctx, s.cta, { x: right, y: y + 26 * scale, size: Math.round(36 * scale) });
  }

  if (s.template === 'offer') {
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, W, H);
    const photoH = f.value === 'landscape' ? H : Math.round(H * 0.52);
    const photoW = f.value === 'landscape' ? Math.round(W * 0.46) : W;
    ctx.save();
    ctx.fillStyle = MIST;
    ctx.fillRect(0, 0, photoW, photoH);
    if (photo) cover(ctx, photo, 0, 0, photoW, photoH);
    ctx.restore();

    const r = Math.round(150 * scale);
    // הבועה בצד שמאל (סוף שורת הקריאה ב-RTL) — הכותרת מימין לא מתנגשת בה.
    const cx = f.value === 'landscape' ? photoW : P + r;
    const cy = f.value === 'landscape' ? H / 2 : photoH;
    ctx.fillStyle = AMBER;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = INK;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.direction = 'ltr';
    ctx.font = `900 ${Math.round(r * 0.72)}px "Frank Ruhl Libre"`;
    ctx.fillText(s.badge || '', cx, cy - r * 0.12);
    ctx.direction = 'rtl';
    ctx.font = `800 ${Math.round(r * 0.26)}px "Assistant"`;
    ctx.fillText(s.badgeLabel || '', cx, cy + r * 0.42);
    ctx.textBaseline = 'top';

    const tx = right;
    const tw = f.value === 'landscape' ? W - photoW - P * 2 - r * 0.6 : textW - r * 2 - 36 * scale;
    let y = f.value === 'landscape' ? P * 1.2 : photoH + 64 * scale;
    drawLogo(right, H - P - 50 * scale, 50 * scale, false);
    y = drawText(ctx, s.headline, { x: tx, y, size: Math.round(72 * scale), weight: 900, family: 'Frank Ruhl Libre', color: INK, maxWidth: tw, lineHeight: 1.1, maxLines: 2 });
    y += 14 * scale;
    if (s.sub) y = drawText(ctx, s.sub, { x: tx, y, size: Math.round(32 * scale), weight: 600, color: '#334155', maxWidth: f.value === 'landscape' ? tw : textW, lineHeight: 1.3, maxLines: 2 });
    if (s.cta) pill(ctx, s.cta, { x: tx, y: y + 22 * scale, size: Math.round(34 * scale) });
  }

  if (s.template === 'frame') {
    ctx.fillStyle = MIST;
    ctx.fillRect(0, 0, W, H);
    const fx = P;
    const fy = P;
    const fw = W - P * 2;
    const fh = f.value === 'landscape' ? H - P * 2 : Math.round(H * 0.62);
    ctx.save();
    roundRect(ctx, fx, fy, f.value === 'landscape' ? fw * 0.5 : fw, fh, 36 * scale);
    ctx.clip();
    ctx.fillStyle = '#E2E8F0';
    ctx.fillRect(fx, fy, fw, fh);
    if (photo) cover(ctx, photo, fx, fy, f.value === 'landscape' ? fw * 0.5 : fw, fh);
    ctx.restore();
    const tx = right;
    const tw = f.value === 'landscape' ? fw * 0.45 : textW;
    let y = f.value === 'landscape' ? P * 1.3 : fy + fh + 44 * scale;
    y = drawText(ctx, s.headline, { x: tx, y, size: Math.round(70 * scale), weight: 900, family: 'Frank Ruhl Libre', color: INK, maxWidth: tw, lineHeight: 1.12, maxLines: 2 });
    y += 12 * scale;
    if (s.sub) y = drawText(ctx, s.sub, { x: tx, y, size: Math.round(32 * scale), weight: 600, color: '#334155', maxWidth: tw, lineHeight: 1.3, maxLines: 3 });
    ctx.fillStyle = AMBER;
    ctx.fillRect(tx - 90 * scale, y + 22 * scale, 90 * scale, 8 * scale);
    if (s.cta) {
      ctx.font = `800 ${Math.round(32 * scale)}px "Assistant"`;
      ctx.fillStyle = '#B45309';
      ctx.textAlign = 'right';
      ctx.direction = 'rtl';
      ctx.textBaseline = 'top';
      ctx.fillText(`${s.cta} ←`, tx, y + 50 * scale);
    }
    drawLogo(f.value === 'landscape' ? right : P + 220 * scale, H - P - 46 * scale, 46 * scale, false);
  }

  if (s.template === 'statement') {
    ctx.fillStyle = INK;
    ctx.fillRect(0, 0, W, H);
    if (photo) {
      ctx.globalAlpha = 0.22;
      cover(ctx, photo, 0, 0, W, H);
      ctx.globalAlpha = 1;
    }
    const glow = ctx.createRadialGradient(W * 0.8, H * 0.15, 0, W * 0.8, H * 0.15, W * 0.8);
    glow.addColorStop(0, 'rgba(245,158,11,0.28)');
    glow.addColorStop(1, 'rgba(245,158,11,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = AMBER;
    ctx.fillRect(right - 110 * scale, H * 0.3 - 40 * scale, 110 * scale, 10 * scale);
    let y = H * 0.3;
    y = drawText(ctx, s.headline, { x: right, y, size: Math.round(96 * scale), weight: 900, family: 'Frank Ruhl Libre', maxWidth: textW, lineHeight: 1.1, maxLines: 4 });
    y += 26 * scale;
    if (s.sub) drawText(ctx, s.sub, { x: right, y, size: Math.round(38 * scale), weight: 600, color: 'rgba(255,255,255,0.8)', maxWidth: textW, lineHeight: 1.3, maxLines: 3 });
    drawLogo(right, H - P - 56 * scale, 56 * scale, true);
    if (s.cta) pill(ctx, s.cta, { x: P, y: H - P - 70 * scale, size: Math.round(32 * scale), align: 'left' });
  }
}

export default function CreativeStudio({ open, onClose, onDone }) {
  const canvasRef = useRef(null);
  const [s, setS] = useState(defaults);
  const [photo, setPhoto] = useState(null);
  const [logo, setLogo] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    let alive = true;
    Promise.all([
      document.fonts?.load('900 40px "Frank Ruhl Libre"'),
      document.fonts?.load('700 40px "Assistant"'),
      document.fonts?.load('800 40px "Assistant"'),
    ]).catch(() => {}).finally(() => alive && setReady(true));
    loadLogo().then((img) => alive && setLogo(img));
    return () => { alive = false; };
  }, [open]);

  const draw = useCallback(() => {
    if (canvasRef.current) render(canvasRef.current, s, photo, logo);
  }, [s, photo, logo]);

  useEffect(() => { if (open && ready) draw(); }, [open, ready, draw]);

  const set = (key) => (e) => setS((prev) => ({ ...prev, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  async function onPhoto(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      setPhoto(await loadImage(URL.createObjectURL(file)));
    } catch {
      setError('לא הצלחתי לקרוא את התמונה');
    }
  }

  const toBlob = () => new Promise((resolve) => canvasRef.current.toBlob(resolve, 'image/jpeg', 0.92));

  async function save() {
    setBusy(true);
    setError(null);
    try {
      draw();
      const url = await uploadSocialImage(await toBlob());
      onDone(url);
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  async function download() {
    draw();
    const blob = await toBlob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `iconair-${s.template}-${Date.now()}.jpg`;
    a.click();
  }

  const fmt = FORMATS.find((f) => f.value === s.format);

  return (
    <Modal
      open={open}
      wide
      title="סטודיו קריאייטיב"
      subtitle="עיצוב ממותג ICONAIR, מוכן לפיד — נשמר ישר לפוסט"
      onClose={onClose}
      footer={(
        <>
          <PrimaryButton loading={busy} onClick={save}>{busy ? 'שומר…' : 'שמור והוסף לפוסט'}</PrimaryButton>
          <SecondaryButton onClick={download}>הורדה למחשב</SecondaryButton>
        </>
      )}
    >
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-col gap-2">
            <span className="text-[15px] font-bold text-text-dim">תבנית</span>
            <Pills value={s.template} onChange={(v) => setS((p) => ({ ...p, template: v }))} options={TEMPLATES} />
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-[15px] font-bold text-text-dim">פורמט</span>
            <Pills value={s.format} onChange={(v) => setS((p) => ({ ...p, format: v }))} options={FORMATS} />
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-[15px] font-bold text-text-dim">תמונת רקע / מוצר</span>
            <div className="flex flex-wrap items-center gap-3">
              <label className="ghost-btn cursor-pointer px-4 py-3 text-[15px]">
                {photo ? 'החלפת תמונה' : 'בחירת תמונה'}
                <input type="file" accept="image/*" className="hidden" onChange={onPhoto} />
              </label>
              {photo && <button type="button" className="text-[14px] text-text-faint hover:text-crit-soft" onClick={() => setPhoto(null)}>הסרה</button>}
            </div>
          </div>
          <Field label="כותרת"><TextInput value={s.headline} onChange={set('headline')} maxLength={80} /></Field>
          <Field label="שורת משנה"><TextInput value={s.sub} onChange={set('sub')} maxLength={140} /></Field>
          <div className={`grid grid-cols-1 gap-3.5 ${s.template === 'offer' ? 'sm:grid-cols-3' : ''}`}>
            <Field label="כפתור / קריאה לפעולה"><TextInput value={s.cta} onChange={set('cta')} maxLength={28} /></Field>
            {s.template === 'offer' && (
              <>
                <Field label="בועת מבצע"><TextInput value={s.badge} onChange={set('badge')} maxLength={6} dir="ltr" /></Field>
                <Field label="מתחת לבועה"><TextInput value={s.badgeLabel} onChange={set('badgeLabel')} maxLength={12} /></Field>
              </>
            )}
          </div>
          <label className="flex items-center gap-2.5 text-[15px] font-semibold text-text-dim">
            <input type="checkbox" checked={s.logo} onChange={set('logo')} className="h-4 w-4 accent-amber-500" />
            הצג לוגו {logo ? '' : <span className="font-normal text-text-faint">(לא הועלה לוגו בהגדרות — יוצג ICONAIR בטקסט)</span>}
          </label>
          {error && <div className="text-[14px] font-semibold text-crit-soft">{error}</div>}
        </div>

        <div className="flex flex-col items-center gap-2 lg:sticky lg:top-0 lg:self-start">
          <div className="w-full overflow-hidden rounded-row border border-[#E2E8F0] bg-ink-800 p-3">
            <canvas ref={canvasRef} className="mx-auto block h-auto max-h-[62vh] w-auto max-w-full rounded-lg shadow-lift" />
          </div>
          <span className="tabular text-[13.5px] text-text-faint">{fmt.w}×{fmt.h} · JPEG</span>
        </div>
      </div>
    </Modal>
  );
}
