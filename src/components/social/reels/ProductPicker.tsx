import { useCallback, useEffect, useState } from 'react';
import { Field, TextInput, TextArea, PrimaryButton, SecondaryButton } from '../../ui/Field';
import {
  listProducts, saveScentProfile, saveModelProfile, hasProfile, isStudioSetupMissing, STUDIO_SQL_URL,
  type Products, type ScentProduct, type ModelProduct, type ScentProfile, type ModelProfile,
} from '../../../lib/reelStudio';

type Toast = (t: { message: string; tone?: 'ok' | 'crit' | 'gold' }) => void;

interface Props {
  scentIds: string[];
  modelIds: string[];
  onChange: (next: { scentIds: string[]; modelIds: string[] }) => void;
  onToast: Toast;
}

const MAX = 4;

/**
 * בחירת מוצרים מהקטלוג (ניחוחות + דגמי מכשיר). הפרופיל של כל מוצר — תווים,
 * אווירה, שטח כיסוי — נשלף אוטומטית למחולל, והוא העובדות היחידות שנכתבות על המוצר.
 * מוצר בלי פרופיל מסומן, ואפשר למלא אותו כאן פעם אחת.
 */
export default function ProductPicker({ scentIds, modelIds, onChange, onToast }: Props) {
  const [products, setProducts] = useState<Products | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ kind: 'scent' | 'model'; id: string } | null>(null);

  const load = useCallback(() => {
    setError(null);
    listProducts().then(setProducts).catch((e: unknown) => setError(isStudioSetupMissing(e) ? 'setup' : String((e as Error)?.message ?? e)));
  }, []);
  useEffect(load, [load]);

  if (error === 'setup') return <ProductsSetup onRetry={load} />;
  if (error) return <div className="text-[14px] text-crit-soft">{error}</div>;
  if (!products) return <div className="h-12 animate-pulse rounded-row bg-ink-800" />;

  const toggle = (kind: 'scent' | 'model', id: string) => {
    const list = kind === 'scent' ? scentIds : modelIds;
    const next = list.includes(id) ? list.filter((x) => x !== id) : [...list, id].slice(-MAX);
    onChange(kind === 'scent' ? { scentIds: next, modelIds } : { scentIds, modelIds: next });
  };

  const replace = (p: ScentProduct | ModelProduct) => setProducts((cur) => cur && ({
    scents: 'notes_top' in p ? cur.scents.map((x) => (x.id === p.id ? p : x)) : cur.scents,
    models: 'notes_top' in p ? cur.models : cur.models.map((x) => (x.id === p.id ? (p as ModelProduct) : x)),
  }));

  const editScent = editing?.kind === 'scent' ? products.scents.find((s) => s.id === editing.id) : undefined;
  const editModel = editing?.kind === 'model' ? products.models.find((m) => m.id === editing.id) : undefined;

  return (
    <div className="flex flex-col gap-3">
      <ChipGroup title="ניחוחות" items={products.scents} selected={scentIds} onToggle={(id) => toggle('scent', id)}
        onEdit={(id) => setEditing({ kind: 'scent', id })} empty="אין ניחוחות פעילים בקטלוג (ניהול מלאי)" />
      <ChipGroup title="דגם מכשיר" items={products.models} selected={modelIds} onToggle={(id) => toggle('model', id)}
        onEdit={(id) => setEditing({ kind: 'model', id })} empty="אין דגמים פעילים בקטלוג" />

      {editScent && (
        <ScentEditor key={editScent.id} scent={editScent} onClose={() => setEditing(null)} onToast={onToast}
          onSaved={(p) => { replace(p); setEditing(null); onToast({ message: `הפרופיל של ${p.name} נשמר` }); }} />
      )}
      {editModel && (
        <ModelEditor key={editModel.id} model={editModel} onClose={() => setEditing(null)} onToast={onToast}
          onSaved={(p) => { replace(p); setEditing(null); onToast({ message: `הפרופיל של ${p.name} נשמר` }); }} />
      )}
    </div>
  );
}

function ChipGroup({ title, items, selected, onToggle, onEdit, empty }: {
  title: string;
  items: (ScentProduct | ModelProduct)[];
  selected: string[];
  onToggle: (id: string) => void;
  onEdit: (id: string) => void;
  empty: string;
}) {
  return (
    <div>
      <div className="mb-1.5 text-[14px] font-bold text-text-dim">{title}</div>
      {items.length === 0 ? <div className="text-[13.5px] text-text-faint">{empty}</div> : (
        <div className="flex flex-wrap gap-1.5">
          {items.map((p) => {
            const on = selected.includes(p.id);
            const filled = hasProfile(p);
            return (
              <span key={p.id} className={`inline-flex items-center overflow-hidden rounded-pill border text-[14px] font-bold transition-colors ${
                on ? 'border-gold-300/[0.6] bg-gold-500/[0.14] text-gold-600' : 'border-black/[0.1] bg-white text-text-dim'}`}>
                <button type="button" onClick={() => onToggle(p.id)} className="px-3 py-1.5" dir="auto">
                  {on ? '✓ ' : ''}{p.name}
                </button>
                {on && (
                  <button type="button" onClick={() => onEdit(p.id)} title="פרופיל מוצר"
                    className={`border-s px-2.5 py-1.5 text-[12.5px] font-bold ${filled ? 'border-gold-300/[0.4] text-gold-600' : 'border-warn/30 bg-warn/[0.1] text-warn'}`}>
                    {filled ? 'פרופיל' : 'חסר פרופיל'}
                  </button>
                )}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

type Input = React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>;

function useSaver<T>(save: () => PromiseLike<T>, onSaved: (v: T) => void, onToast: Toast) {
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try { onSaved(await save()); } catch (e) { onToast({ tone: 'crit', message: e instanceof Error ? e.message : String(e) }); } finally { setBusy(false); }
  };
  return { busy, run };
}

function EditorShell({ title, busy, onSave, onClose, children }: { title: string; busy: boolean; onSave: () => void; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 rounded-row border border-[#E2E8F0] bg-white p-4">
      <div className="text-[15px] font-extrabold" dir="auto">{title}</div>
      <p className="text-[13.5px] text-text-faint">התסריט כותב על המוצר רק מה שכתוב כאן — בלי להמציא. ממלאים פעם אחת.</p>
      {children}
      <div className="flex gap-2">
        <PrimaryButton loading={busy} onClick={onSave}>שמירה</PrimaryButton>
        <SecondaryButton onClick={onClose}>סגירה</SecondaryButton>
      </div>
    </div>
  );
}

function ScentEditor({ scent, onSaved, onClose, onToast }: { scent: ScentProduct; onSaved: (p: ScentProduct) => void; onClose: () => void; onToast: Toast }) {
  const [f, setF] = useState<ScentProfile>({
    description: scent.description ?? '', notes_top: scent.notes_top ?? '', notes_heart: scent.notes_heart ?? '',
    notes_base: scent.notes_base ?? '', mood: scent.mood ?? '', best_for: scent.best_for ?? '',
  });
  const set = (k: keyof ScentProfile) => (e: Input) => setF((x) => ({ ...x, [k]: e.target.value }));
  const { busy, run } = useSaver(() => saveScentProfile(scent.id, f), onSaved, onToast);
  return (
    <EditorShell title={`פרופיל ניחוח — ${scent.name}`} busy={busy} onSave={run} onClose={onClose}>
      <Field label="תיאור שיווקי">
        <TextArea rows={2} value={f.description ?? ''} onChange={set('description')} placeholder="ריח עוטף של ענבר ווניל, שמשרה תחושת בית יוקרתי" />
      </Field>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="תווי ראש"><TextInput value={f.notes_top ?? ''} onChange={set('notes_top')} placeholder="ברגמוט, לימון" /></Field>
        <Field label="תווי לב"><TextInput value={f.notes_heart ?? ''} onChange={set('notes_heart')} placeholder="יסמין, ורד" /></Field>
        <Field label="תווי בסיס"><TextInput value={f.notes_base ?? ''} onChange={set('notes_base')} placeholder="ענבר, מושק" /></Field>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="אווירה"><TextInput value={f.mood ?? ''} onChange={set('mood')} placeholder="חם ויוקרתי" /></Field>
        <Field label="מתאים ל"><TextInput value={f.best_for ?? ''} onChange={set('best_for')} placeholder="לובי מלון, בוטיק, סלון" /></Field>
      </div>
    </EditorShell>
  );
}

function ModelEditor({ model, onSaved, onClose, onToast }: { model: ModelProduct; onSaved: (p: ModelProduct) => void; onClose: () => void; onToast: Toast }) {
  const [f, setF] = useState({
    description: model.description ?? '', coverage: model.coverage_m2 ? String(model.coverage_m2) : '',
    features: model.features ?? '', best_for: model.best_for ?? '',
  });
  const set = (k: keyof typeof f) => (e: Input) => setF((x) => ({ ...x, [k]: e.target.value }));
  const save = () => {
    const coverage = f.coverage.trim() ? Math.round(Number(f.coverage)) : null;
    if (coverage !== null && !(coverage > 0)) return Promise.reject<ModelProduct>(new Error('שטח כיסוי צריך להיות מספר חיובי'));
    const p: ModelProfile = { description: f.description, coverage_m2: coverage, features: f.features, best_for: f.best_for };
    return saveModelProfile(model.id, p);
  };
  const { busy, run } = useSaver(save, onSaved, onToast);
  return (
    <EditorShell title={`פרופיל דגם — ${model.name}`} busy={busy} onSave={run} onClose={onClose}>
      <Field label="תיאור שיווקי">
        <TextArea rows={2} value={f.description} onChange={set('description')} placeholder="מפיץ ריח שקט לחללים בינוניים, עיצוב נקי שנעלם בחלל" />
      </Field>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[140px_1fr]">
        <Field label='שטח כיסוי (מ"ר)'>
          <TextInput type="number" min={1} inputMode="numeric" value={f.coverage} onChange={set('coverage')} placeholder="150" />
        </Field>
        <Field label="יכולות"><TextInput value={f.features} onChange={set('features')} placeholder="טיימר שבועי, שליטה באפליקציה, שקט" /></Field>
      </div>
      <Field label="מתאים ל"><TextInput value={f.best_for} onChange={set('best_for')} placeholder="חנויות, משרדים, קליניקות" /></Field>
    </EditorShell>
  );
}

function ProductsSetup({ onRetry }: { onRetry: () => void }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  async function copy() {
    try {
      const sql = await fetch(STUDIO_SQL_URL, { cache: 'no-store' }).then((r) => { if (!r.ok) throw new Error(); return r.text(); });
      await navigator.clipboard.writeText(sql);
      setState('copied');
    } catch { setState('failed'); }
  }
  return (
    <div className="flex flex-col gap-2 rounded-row border border-warn/30 bg-warn/[0.08] p-3.5 text-[14px]">
      <span className="font-semibold text-warn">כדי לבחור מוצרים מהקטלוג צריך להריץ פעם אחת את קוד ה-SQL של סטודיו הרילז (phase48).</span>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="ghost-btn" onClick={copy}>{state === 'copied' ? 'הועתק ✓ — הדבק ב-Supabase והרץ' : 'העתק את קוד העדכון'}</button>
        {state === 'failed' && <a className="font-semibold text-gold-600 hover:underline" href={STUDIO_SQL_URL} target="_blank" rel="noreferrer">פתח את הקובץ ↗</a>}
        <button type="button" className="ghost-btn" onClick={onRetry}>בדוק שוב</button>
      </div>
    </div>
  );
}
