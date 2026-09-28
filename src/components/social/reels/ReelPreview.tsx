import { useEffect, useState } from 'react';
import { reelLength, type ReelScript, type StudioImage, type RenderedReel } from '../../../lib/reelStudio';

interface Props {
  script: ReelScript;
  images: StudioImage[];
  reel: RenderedReel | null;
  rendering: number | null;
}

/**
 * תצוגה מקדימה 9:16. לפני רינדור — הדמיה חיה (תמונה + כתובית + מסך סיום, בלולאה);
 * אחרי רינדור — ה-MP4 האמיתי שיעלה לרשתות.
 */
export default function ReelPreview({ script, images, reel, rendering }: Props) {
  const [t, setT] = useState(0);
  const total = reelLength(script);

  useEffect(() => {
    if (reel) return undefined;
    const start = performance.now();
    const id = window.setInterval(() => setT(((performance.now() - start) / 1000) % total), 100);
    return () => window.clearInterval(id);
  }, [reel, total, script]);

  if (reel) {
    return (
      <video key={reel.localUrl} src={reel.localUrl} poster={reel.coverUrl} controls playsInline autoPlay muted
        className="mx-auto aspect-[9/16] w-full max-w-[280px] rounded-[22px] bg-black object-contain shadow-lift" />
    );
  }

  let acc = 0;
  let current: ReelScript['scenes'][number] | null = null;
  for (const s of script.scenes) {
    if (t < acc + s.seconds) { current = s; break; }
    acc += s.seconds;
  }
  const img = current ? images[current.image_index] : null;

  return (
    <div className="relative mx-auto aspect-[9/16] w-full max-w-[280px] overflow-hidden rounded-[22px] bg-[#020617] shadow-lift">
      {current && img ? (
        <>
          <img key={`${img.url}-${acc}`} src={img.url} alt="" className="absolute inset-0 h-full w-full animate-kenburns object-cover" />
          <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/70 to-transparent" />
          <div className="absolute inset-x-4 bottom-[22%] text-center">
            <span className="inline rounded-md bg-black/55 px-2 py-1 text-[19px] font-extrabold leading-snug text-white [box-decoration-break:clone]">
              {current.subtitle}
            </span>
          </div>
          <div className="absolute start-3 top-3 rounded-full bg-black/45 px-2.5 py-1 text-[11.5px] font-extrabold tracking-[1.5px] text-white">ICONAIR</div>
        </>
      ) : (
        <div className="absolute inset-0 grid place-items-center p-6 text-center">
          <div>
            <div className="font-display text-[26px] font-bold text-white">ICONAIR</div>
            <div className="mt-3 text-[18px] font-extrabold text-[#F59E0B]">{script.cta}</div>
            <div className="mt-2 text-[13px] text-white/70">iconair.co.il</div>
          </div>
        </div>
      )}
      <div className="absolute inset-x-0 top-0 h-1 bg-white/15">
        <div className="h-full bg-[#F59E0B]" style={{ width: `${(t / total) * 100}%` }} />
      </div>
      {rendering != null && (
        <div className="absolute inset-0 grid place-items-center bg-black/60">
          <div className="w-3/4 text-center">
            <div className="mb-2 text-[14px] font-bold text-white">מרנדר סרטון…</div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-white/20">
              <div className="h-full rounded-full bg-[#F59E0B] transition-all" style={{ width: `${Math.round(rendering * 100)}%` }} />
            </div>
            <div className="tabular mt-1.5 text-[13px] text-white/80">{Math.round(rendering * 100)}%</div>
          </div>
        </div>
      )}
    </div>
  );
}
