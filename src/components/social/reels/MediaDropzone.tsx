import { useRef, useState } from 'react';
import { PlusIcon, TrashIcon } from '../../ui/Icons';
import { uploadStudioImage, type StudioImage } from '../../../lib/reelStudio';

interface Props {
  images: StudioImage[];
  onChange: (next: StudioImage[]) => void;
  onToast: (t: { message: string; tone?: 'ok' | 'crit' | 'gold' }) => void;
}

const MAX = 10;

/** גרירה/בחירה של תמונות → העלאה ל-Storage. הסדר כאן = מספור התמונות (#0, #1...) בתסריט. */
export default function MediaDropzone({ images, onChange, onToast }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [pending, setPending] = useState(0);

  async function add(list: FileList | File[]) {
    const files = Array.from(list).filter((f) => f.type.startsWith('image/')).slice(0, MAX - images.length);
    if (!files.length) {
      if (images.length >= MAX) onToast({ tone: 'crit', message: `עד ${MAX} תמונות לרילז` });
      return;
    }
    setPending(files.length);
    let next = images;
    for (const f of files) {
      try {
        const img = await uploadStudioImage(f);
        next = [...next, img];
        onChange(next);
      } catch (e) {
        onToast({ tone: 'crit', message: `${f.name}: ${e instanceof Error ? e.message : String(e)}` });
      } finally {
        setPending((n) => n - 1);
      }
    }
  }

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= images.length) return;
    const next = [...images];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };

  return (
    <div className="flex flex-col gap-3">
      <div
        role="button"
        tabIndex={0}
        onClick={() => !pending && input.current?.click()}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') input.current?.click(); }}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); add(e.dataTransfer.files); }}
        className={`grid cursor-pointer place-items-center rounded-row border border-dashed px-4 py-8 text-center transition-colors ${
          over ? 'border-gold-500 bg-gold-500/[0.08]' : 'border-black/[0.15] bg-ink-800 hover:border-gold-500/50'}`}
      >
        <div className="flex flex-col items-center gap-1.5">
          <PlusIcon className="h-6 w-6 text-gold-600" />
          <span className="text-[15px] font-bold">{pending ? `מעלה ${pending}…` : 'גרור תמונות לכאן או לחץ לבחירה'}</span>
          <span className="text-[13.5px] text-text-faint">עד {MAX} תמונות · התקנות, מוצרים, חנויות</span>
        </div>
        <input ref={input} type="file" accept="image/*" multiple className="hidden"
          onChange={(e) => { if (e.target.files) add(e.target.files); e.target.value = ''; }} />
      </div>

      {images.length > 0 && (
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
          {images.map((img, i) => (
            <div key={img.url} className="group relative overflow-hidden rounded-lg border border-black/[0.08]">
              <img src={img.url} alt="" className="aspect-[9/16] w-full object-cover" />
              <span className="tabular pointer-events-none absolute end-1 top-1 grid h-6 min-w-6 place-items-center rounded-full bg-gold-500 px-1.5 text-[12.5px] font-extrabold text-slate-950">{i}</span>
              <div className="absolute inset-x-1 bottom-1 hidden justify-between group-hover:flex">
                <button type="button" aria-label="הזזה ימינה" onClick={() => move(i, -1)} className="grid h-7 w-7 place-items-center rounded-full bg-black/65 text-[13px] font-bold text-white">›</button>
                <button type="button" aria-label="הסרה" onClick={() => onChange(images.filter((_, k) => k !== i))} className="grid h-7 w-7 place-items-center rounded-full bg-black/65 text-white">
                  <TrashIcon className="h-3.5 w-3.5" />
                </button>
                <button type="button" aria-label="הזזה שמאלה" onClick={() => move(i, 1)} className="grid h-7 w-7 place-items-center rounded-full bg-black/65 text-[13px] font-bold text-white">‹</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
