import { TrashIcon, PlusIcon } from '../../ui/Icons';
import { Field, TextInput, TextArea } from '../../ui/Field';
import { reelLength, type ReelScript, type StudioImage } from '../../../lib/reelStudio';

interface Props {
  script: ReelScript;
  images: StudioImage[];
  onChange: (next: ReelScript) => void;
}

type Input = React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>;

/** עריכת התסריט: סצנות (תמונה + כתובית + זמן), הנעה לפעולה, קפשן והאשטגים. */
export default function ScriptEditor({ script, images, onChange }: Props) {
  const set = <K extends keyof ReelScript>(k: K, v: ReelScript[K]) => onChange({ ...script, [k]: v });
  const setScene = (i: number, patch: Partial<ReelScript['scenes'][number]>) =>
    set('scenes', script.scenes.map((s, k) => (k === i ? { ...s, ...patch } : s)));

  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[14px] font-bold text-text-dim">סצנות וכתוביות</span>
          <span className="tabular text-[13.5px] text-text-faint">{reelLength(script).toFixed(1)} שניות</span>
        </div>
        <div className="flex flex-col gap-2">
          {script.scenes.map((s, i) => (
            <div key={i} className="inner-row flex items-center gap-2.5 px-2.5 py-2">
              <select value={s.image_index} onChange={(e) => setScene(i, { image_index: Number(e.target.value) })}
                aria-label="תמונה" className="h-10 w-14 flex-none rounded-md border border-[#E2E8F0] bg-white text-center text-[14px] font-bold">
                {images.map((_, k) => <option key={k} value={k}>#{k}</option>)}
              </select>
              {images[s.image_index] && <img src={images[s.image_index].url} alt="" className="h-12 w-7 flex-none rounded object-cover" />}
              <input value={s.subtitle} onChange={(e) => setScene(i, { subtitle: e.target.value.slice(0, 60) })}
                className="min-w-0 flex-1 rounded-md border border-[#E2E8F0] bg-white px-3 py-2 text-[14.5px] font-semibold" aria-label="כתובית" />
              <input type="number" min={1.5} max={4.5} step={0.5} value={s.seconds} aria-label="שניות"
                onChange={(e) => setScene(i, { seconds: Math.max(1.5, Math.min(4.5, Number(e.target.value) || 2.5)) })}
                className="tabular w-16 flex-none rounded-md border border-[#E2E8F0] bg-white px-2 py-2 text-center text-[14px]" />
              <button type="button" aria-label="מחיקת סצנה" disabled={script.scenes.length <= 1}
                onClick={() => set('scenes', script.scenes.filter((_, k) => k !== i))}
                className="grid h-9 w-9 flex-none place-items-center rounded-md text-text-faint hover:text-crit-soft disabled:opacity-30">
                <TrashIcon className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
        {script.scenes.length < 7 && (
          <button type="button" onClick={() => set('scenes', [...script.scenes, { image_index: 0, seconds: 2.5, subtitle: '' }])}
            className="mt-2 inline-flex items-center gap-1.5 text-[14px] font-semibold text-gold-600 hover:underline">
            <PlusIcon className="h-4 w-4" /> סצנה
          </button>
        )}
      </div>

      <Field label="הנעה לפעולה (מסך סיום)">
        <TextInput value={script.cta} onChange={(e: Input) => set('cta', e.target.value.slice(0, 60))} />
      </Field>
      <Field label="קפשן">
        <TextArea rows={5} value={script.caption} onChange={(e: Input) => set('caption', e.target.value)} />
      </Field>
      <Field label="האשטגים">
        <TextInput key={script.hashtags.join(' ')} dir="auto" defaultValue={script.hashtags.join(' ')}
          onBlur={(e: React.FocusEvent<HTMLInputElement>) => set('hashtags', [...new Set(e.target.value.split(/\s+/).filter(Boolean)
            .map((t) => `#${t.replace(/^#+/, '')}`).filter((t) => t.length > 1))])} />
      </Field>
    </div>
  );
}
