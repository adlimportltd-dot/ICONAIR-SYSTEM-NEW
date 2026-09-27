import { useMemo, useRef, useState } from 'react';
import GlassCard, { CardHead } from '../ui/GlassCard';
import { PlusIcon, TrashIcon } from '../ui/Icons';
import { Field, TextInput, TextArea, PrimaryButton } from '../ui/Field';
import { uploadAsset, updateAsset, startBatch, type ClaraAsset, type Site } from '../../lib/clara';

interface Props {
  assets: ClaraAsset[];
  sites: Site[];
  aiReady: boolean;
  onChanged: () => void;
  onToast: (t: { message: string; tone?: 'ok' | 'crit' | 'gold' }) => void;
}

interface UploadItem { name: string; state: 'uploading' | 'done' | 'error'; error?: string }

/**
 * קליטת נכסים: העלאה מהשטח (תמונות/סרטונים + סניף/מיקום + הערות), ספריית
 * נכסים לבחירה, ושליחה לקלרה עם הנחיה קצרה.
 */
export default function AssetsCard({ assets, sites, aiReady, onChanged, onToast }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [siteId, setSiteId] = useState('');
  const [location, setLocation] = useState('');
  const [notes, setNotes] = useState('');
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [brief, setBrief] = useState('');
  const [reels, setReels] = useState(2);
  const [posts, setPosts] = useState(1);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const siteLabel = useMemo(() => {
    const s = sites.find((x) => x.id === siteId);
    return s ? [s.customer?.name, s.label, s.city].filter(Boolean).join(' · ') : '';
  }, [siteId, sites]);

  async function handleFiles(list: FileList | File[]) {
    const files = Array.from(list).slice(0, 20);
    if (!files.length) return;
    setUploads(files.map((f) => ({ name: f.name, state: 'uploading' })));
    const created: string[] = [];
    for (let i = 0; i < files.length; i += 1) {
      try {
        const a = await uploadAsset(files[i], {
          siteId: siteId || null,
          locationLabel: location.trim() || siteLabel || null,
          notes: notes.trim() || null,
        });
        created.push(a.id);
        setUploads((u) => u.map((x, k) => (k === i ? { ...x, state: 'done' } : x)));
      } catch (e) {
        setUploads((u) => u.map((x, k) => (k === i ? { ...x, state: 'error', error: e instanceof Error ? e.message : String(e) } : x)));
      }
    }
    setSelected((s) => [...new Set([...created, ...s])].slice(0, 20));
    onChanged();
    if (created.length) onToast({ message: `הועלו ${created.length} קבצים — מסומנים ומוכנים לקלרה` });
  }

  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id].slice(0, 20)));

  async function send() {
    if (!selected.length) return;
    setBusy(true);
    try {
      await startBatch(selected, brief.trim(), { reels, posts });
      setSelected([]);
      setBrief('');
      setUploads([]);
      onToast({ message: 'קלרה סיימה לכתוב — עכשיו היא מרנדרת את הסרטונים', tone: 'gold' });
    } catch (e) {
      onToast({ tone: 'crit', message: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  async function archive(a: ClaraAsset) {
    try {
      await updateAsset(a.id, { archived: true });
      setSelected((s) => s.filter((x) => x !== a.id));
      onChanged();
    } catch (e) {
      onToast({ tone: 'crit', message: e instanceof Error ? e.message : String(e) });
    }
  }

  const uploading = uploads.some((u) => u.state === 'uploading');

  return (
    <GlassCard>
      <CardHead icon={PlusIcon} tone="gold" title="חומרים מהשטח" subtitle="תמונות וסרטונים של התקנות, מוצרים וחנויות — קלרה הופכת אותם לתוכן" />

      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
        onClick={() => !uploading && fileRef.current?.click()}
        role="button"
        tabIndex={0}
        className={`grid cursor-pointer place-items-center rounded-row border border-dashed px-4 py-8 text-center transition-colors ${
          dragOver ? 'border-gold-500 bg-gold-500/[0.08]' : 'border-black/[0.15] bg-ink-800 hover:border-gold-500/50'}`}
      >
        <div className="flex flex-col items-center gap-1.5">
          <PlusIcon className="h-6 w-6 text-gold-600" />
          <span className="text-[15px] font-bold">{uploading ? 'מעלה…' : 'גרור לכאן או לחץ לבחירה'}</span>
          <span className="text-[13.5px] text-text-faint">עד 20 קבצים · תמונות וסרטונים (עד 250MB)</span>
        </div>
        <input ref={fileRef} type="file" multiple accept="image/*,video/*" className="hidden"
          onChange={(e) => { if (e.target.files) handleFiles(e.target.files); e.target.value = ''; }} />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3.5 sm:grid-cols-2">
        <Field label="סניף / לקוח (אופציונלי)">
          <select value={siteId} onChange={(e) => setSiteId(e.target.value)}
            className="w-full rounded-pill border border-[#E2E8F0] bg-ink-800 px-4 py-3 text-[15px] font-medium text-text">
            <option value="">—</option>
            {sites.map((s) => <option key={s.id} value={s.id}>{[s.customer?.name, s.label, s.city].filter(Boolean).join(' · ')}</option>)}
          </select>
        </Field>
        <Field label="מיקום (טקסט חופשי)">
          <TextInput value={location} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setLocation(e.target.value)} placeholder="למשל: קניון עזריאלי חיפה" />
        </Field>
      </div>
      <div className="mt-3.5">
        <Field label="הערות מהשטח">
          <TextInput value={notes} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNotes(e.target.value)} placeholder="מה רואים? למשל: התקנת Icon 700 בכניסה, ריח ענבר" />
        </Field>
      </div>

      {uploads.length > 0 && (
        <div className="mt-3 flex flex-col gap-1 text-[13.5px]">
          {uploads.map((u) => (
            <div key={u.name} className="flex gap-2">
              <span className={u.state === 'done' ? 'text-ok' : u.state === 'error' ? 'text-crit-soft' : 'text-text-faint'}>
                {u.state === 'done' ? '✓' : u.state === 'error' ? '✕' : '…'}
              </span>
              <span className="truncate" dir="auto">{u.name}</span>
              {u.error && <span className="text-crit-soft">— {u.error}</span>}
            </div>
          ))}
        </div>
      )}

      <div className="mt-5 flex items-center justify-between">
        <span className="text-[15px] font-bold text-text-dim">ספרייה <span className="font-normal text-text-faint">({assets.length})</span></span>
        {selected.length > 0 && <button type="button" className="text-[14px] font-semibold text-gold-600" onClick={() => setSelected([])}>ניקוי בחירה ({selected.length})</button>}
      </div>
      {assets.length === 0 ? (
        <div className="mt-2 rounded-row border border-dashed border-black/[0.1] px-4 py-6 text-center text-[14px] text-text-faint">עוד אין חומרים. העלה את הראשונים למעלה.</div>
      ) : (
        <div className="mt-2 grid max-h-[340px] grid-cols-4 gap-2 overflow-y-auto sm:grid-cols-5">
          {assets.map((a) => {
            const on = selected.includes(a.id);
            return (
              <div key={a.id} className={`group relative overflow-hidden rounded-lg border-2 ${on ? 'border-gold-500' : 'border-transparent'}`}>
                <button type="button" onClick={() => toggle(a.id)} className="block w-full" title={a.notes || a.location_label || ''}>
                  <img src={a.thumb_url || a.public_url} alt="" className="aspect-square w-full object-cover" loading="lazy" />
                </button>
                {a.media_type === 'video' && (
                  <span className="tabular pointer-events-none absolute bottom-1 start-1 rounded bg-black/65 px-1.5 text-[11.5px] font-bold text-white">
                    ▶ {Math.round(a.duration_sec || 0)}ש׳
                  </span>
                )}
                {on && <span className="pointer-events-none absolute end-1 top-1 grid h-6 w-6 place-items-center rounded-full bg-gold-500 text-[13px] font-extrabold text-slate-950">{selected.indexOf(a.id) + 1}</span>}
                <button type="button" onClick={() => archive(a)} aria-label="הסרה מהספרייה"
                  className="absolute start-1 top-1 hidden h-6 w-6 place-items-center rounded-full bg-black/60 text-white group-hover:grid">
                  <TrashIcon className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-5 flex flex-col gap-3 rounded-row border border-gold-300/[0.35] bg-gold-500/[0.05] p-4">
        <Field label="מה לבקש מקלרה? (אופציונלי)">
          <TextArea rows={2} value={brief} onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setBrief(e.target.value)}
            placeholder="למשל: להדגיש שירות מהיר לעסקים בחיפה, טון קליל" />
        </Field>
        <div className="flex flex-wrap items-center gap-4 text-[14.5px]">
          <label className="flex items-center gap-2 font-semibold">רילז
            <input type="number" min={0} max={3} value={reels} onChange={(e) => setReels(Math.max(0, Math.min(3, Number(e.target.value))))}
              className="tabular w-16 rounded-pill border border-[#E2E8F0] bg-white px-3 py-2 text-center" />
          </label>
          <label className="flex items-center gap-2 font-semibold">פוסטים
            <input type="number" min={0} max={3} value={posts} onChange={(e) => setPosts(Math.max(0, Math.min(3, Number(e.target.value))))}
              className="tabular w-16 rounded-pill border border-[#E2E8F0] bg-white px-3 py-2 text-center" />
          </label>
        </div>
        <PrimaryButton onClick={send} loading={busy} disabled={!aiReady || !selected.length || busy || reels + posts === 0}>
          {busy ? 'קלרה כותבת…' : selected.length ? `קלרה, תכיני תוכן מ-${selected.length} קבצים` : 'סמן קבצים מהספרייה'}
        </PrimaryButton>
        {!aiReady && <span className="text-[13.5px] text-crit-soft">צריך קודם לחבר את קלרה ל-AI (הגדרות למטה).</span>}
      </div>
    </GlassCard>
  );
}
