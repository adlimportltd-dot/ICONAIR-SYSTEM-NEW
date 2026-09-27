import { useCallback, useMemo, useState } from 'react';
import GlassCard, { CardHead } from '../ui/GlassCard';
import { SparkleIcon } from '../ui/Icons';
import { PrimaryButton, SecondaryButton } from '../ui/Field';
import { LoadingRows, EmptyState } from '../ui/States';
import { useQuery } from '../../hooks/useQuery';
import { useRealtime } from '../../hooks/useRealtime';
import AssetsCard from './AssetsCard';
import ClaraChat from './ClaraChat';
import ContentCard from './ContentCard';
import ClaraSettingsCard from './ClaraSettingsCard';
import { useClaraRenderer } from './useClaraRenderer';
import {
  getClaraSettings, listAssets, listContent, listMessages, listSites, isClaraSetupMissing, CLARA_SQL_URL,
  type ClaraAsset, type ClaraContent, type ClaraMessage, type ClaraSettings, type Site,
} from '../../lib/clara';

type Toast = { message: string; tone?: 'ok' | 'crit' | 'gold' };
interface Query<T> { data: T | null; loading: boolean; error: string | null; refetch: () => void }

const FILTERS = [
  { id: 'pending', label: 'ממתינים לאישור', match: (c: ClaraContent) => c.status === 'pending_approval' || c.status === 'draft' },
  { id: 'scheduled', label: 'מתוזמנים', match: (c: ClaraContent) => c.status === 'scheduled' || c.status === 'approved' },
  { id: 'published', label: 'פורסמו', match: (c: ClaraContent) => c.status === 'published' },
  { id: 'failed', label: 'נכשלו', match: (c: ClaraContent) => c.status === 'failed' },
];

/**
 * קלרה — סוכנת השיווק (phase46). חומרים מהשטח → Claude כותב → הדפדפן
 * מרנדר רילז MP4 → אישור בשיחה → תזמון לתור של ה-Autopilot → פרסום ב-Meta.
 */
export default function ClaraPanel({ onToast }: { onToast: (t: Toast) => void }) {
  const [filter, setFilter] = useState('pending');

  const settings = useQuery(getClaraSettings, []) as Query<ClaraSettings>;
  const missing = Boolean(settings.error && isClaraSetupMissing(settings.error));
  const ready = !missing && !settings.loading;

  const assets = useQuery(listAssets, [], { enabled: ready }) as Query<ClaraAsset[]>;
  const content = useQuery(listContent, [], { enabled: ready }) as Query<ClaraContent[]>;
  const messages = useQuery(listMessages, [], { enabled: ready }) as Query<ClaraMessage[]>;
  const sites = useQuery(listSites, [], { enabled: ready }) as Query<Site[]>;
  useRealtime(['clara_assets'], assets.refetch, { enabled: ready });
  useRealtime(['clara_content'], content.refetch, { enabled: ready });
  useRealtime(['clara_messages'], messages.refetch, { enabled: ready });

  const renderer = useClaraRenderer(content.data, assets.data, ready);
  const assetMap = useMemo(() => new Map((assets.data ?? []).map((a) => [a.id, a])), [assets.data]);

  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.id, (content.data ?? []).filter(f.match).length])), [content.data]);
  const shown = useMemo(() => (content.data ?? []).filter(FILTERS.find((f) => f.id === filter)!.match), [content.data, filter]);

  const retryRender = useCallback((id: string) => { renderer.retry(id); content.refetch(); }, [renderer, content]);

  if (settings.loading) return <LoadingRows rows={4} height="h-[120px]" />;
  if (missing) return <ClaraSetup onRetry={settings.refetch} />;
  if (settings.error) return <div className="glass-card p-6 text-[15px] text-crit-soft">{settings.error}</div>;

  const ai = settings.data;

  return (
    <div className="flex flex-col gap-5">
      {!renderer.supported.ok && (
        <div className="rounded-row border border-warn/30 bg-warn/[0.08] px-4 py-3 text-[14px] font-semibold text-warn">
          {renderer.supported.reason} פוסטים עדיין יוכנו כרגיל.
        </div>
      )}
      {renderer.current && (
        <div className="glass-card flex items-center gap-3 px-5 py-3.5">
          <SparkleIcon className="h-5 w-5 animate-pulse text-gold-600" />
          <span className="text-[14.5px] font-semibold">קלרה מרנדרת: {renderer.current.title}</span>
          <div className="ms-auto h-2 w-40 overflow-hidden rounded-full bg-ink-700">
            <div className="h-full bg-gold-500 transition-all" style={{ width: `${Math.round(renderer.current.progress * 100)}%` }} />
          </div>
          <span className="tabular w-10 text-end text-[13.5px] text-text-faint">{Math.round(renderer.current.progress * 100)}%</span>
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="flex min-w-0 flex-col gap-5">
          <AssetsCard assets={assets.data ?? []} sites={sites.data ?? []} aiReady={Boolean(ai?.ai_configured)}
            onChanged={assets.refetch} onToast={onToast} />

          <GlassCard>
            <CardHead icon={SparkleIcon} tone="gold" title="תוכן מקלרה" subtitle="רילז ופוסטים שמחכים לך, מתוזמנים ופורסמו" />
            <div className="mb-5 flex flex-wrap gap-2">
              {FILTERS.map((f) => (
                <button key={f.id} type="button" onClick={() => setFilter(f.id)}
                  className={`rounded-pill border px-3.5 py-2 text-[14px] font-bold transition-colors ${
                    filter === f.id ? 'border-gold-300/[0.5] bg-gold-500/[0.14] text-gold-600' : 'border-black/[0.09] text-text-dim hover:border-gold-500/35'}`}>
                  {f.label} <span className="tabular">({counts[f.id] ?? 0})</span>
                </button>
              ))}
            </div>
            {content.loading ? <LoadingRows rows={2} height="h-[200px]" /> : shown.length === 0 ? (
              <EmptyState title={filter === 'pending' ? 'אין כרגע תוכן שמחכה לאישור' : 'אין כאן כלום עדיין'}
                hint={filter === 'pending' ? 'העלה חומרים מהשטח, סמן אותם ולחץ "קלרה, תכיני תוכן".' : undefined} />
            ) : (
              <div className="grid grid-cols-1 items-start gap-5 md:grid-cols-2 2xl:grid-cols-3">
                {shown.map((c) => (
                  <ContentCard key={c.id} item={c} assets={assetMap} onToast={onToast} onRetryRender={retryRender}
                    rendering={renderer.current?.contentId === c.id ? { progress: renderer.current.progress } : null} />
                ))}
              </div>
            )}
          </GlassCard>
        </div>

        <div className="flex min-w-0 flex-col gap-5">
          <ClaraChat messages={messages.data ?? []} content={content.data ?? []} onToast={onToast} />
          <ClaraSettingsCard settings={ai} onSaved={settings.refetch} onToast={onToast} />
        </div>
      </div>
    </div>
  );
}

function ClaraSetup({ onRetry }: { onRetry: () => void }) {
  const [state, setState] = useState<'idle' | 'loading' | 'copied' | 'failed'>('idle');
  const ref = (() => { try { return new URL(import.meta.env.VITE_SUPABASE_URL).hostname.split('.')[0]; } catch { return ''; } })();
  async function copy() {
    setState('loading');
    try {
      const sql = await fetch(CLARA_SQL_URL, { cache: 'no-store' }).then((r) => { if (!r.ok) throw new Error(); return r.text(); });
      await navigator.clipboard.writeText(sql);
      setState('copied');
    } catch {
      setState('failed');
    }
  }
  return (
    <GlassCard>
      <CardHead icon={SparkleIcon} tone="gold" title="הפעלת קלרה — שלב אחד" subtitle="מקימים את הטבלאות של קלרה במסד הנתונים (פעם אחת)" />
      <ol className="flex flex-col gap-3 text-[15px]">
        <li className="flex flex-wrap items-center gap-3"><b>1.</b>
          <PrimaryButton onClick={copy} loading={state === 'loading'}>{state === 'copied' ? 'הקוד הועתק ✓' : 'העתק את קוד ההקמה'}</PrimaryButton>
          {state === 'failed' && <a className="font-semibold text-gold-600 hover:underline" href={CLARA_SQL_URL} target="_blank" rel="noreferrer">פתח את הקובץ ↗</a>}
        </li>
        <li className="flex flex-wrap items-center gap-3"><b>2.</b>
          <a className="ghost-btn" target="_blank" rel="noreferrer" href={ref ? `https://supabase.com/dashboard/project/${ref}/sql/new` : 'https://supabase.com/dashboard'}>פתח את Supabase SQL Editor ↗</a>
          <span className="text-text-dim">הדבק ולחץ <b>Run</b></span>
        </li>
        <li className="flex flex-wrap items-center gap-3"><b>3.</b><SecondaryButton onClick={onRetry}>סיימתי — בדוק שוב</SecondaryButton></li>
      </ol>
    </GlassCard>
  );
}
