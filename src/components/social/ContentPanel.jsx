import { useMemo, useState } from 'react';
import GlassCard, { CardHead } from '../ui/GlassCard';
import DataTable, { StatusChip } from '../ui/DataTable';
import { MegaphoneIcon, ChevronRightIcon, SearchIcon } from '../ui/Icons';
import { Async, EmptyState } from '../ui/States';
import { formatDateTime } from '../../lib/mappers';
import { Pills } from './SocialUI';
import { postState, POST_STATE, engagementOf, reachOf, compact } from '../../lib/social';

const WEEKDAYS = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
const FILTERS = [
  { value: '', label: 'הכל' },
  { value: 'scheduled', label: 'מתוזמנים' },
  { value: 'draft', label: 'טיוטות' },
  { value: 'published', label: 'פורסמו' },
  { value: 'failed', label: 'דורשים טיפול' },
];

const DOT = { draft: 'bg-slate-500', scheduled: 'bg-gold-500', publishing: 'bg-teal-500', published: 'bg-ok', failed: 'bg-crit' };

const dayKey = (d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
const postDate = (p) => new Date(p.published_at || p.scheduled_at || p.created_at);

export default function ContentPanel({ posts, onOpen, onNew, onPublish, onDelete, busyId }) {
  const [view, setView] = useState('calendar');
  const [cursor, setCursor] = useState(() => { const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); return d; });
  const [filter, setFilter] = useState('');
  const [search, setSearch] = useState('');

  const rows = posts.data ?? [];
  const filtered = useMemo(() => {
    let list = rows;
    if (filter) list = list.filter((p) => postState(p) === filter || (filter === 'scheduled' && postState(p) === 'publishing'));
    if (search.trim()) list = list.filter((p) => (p.caption || '').toLowerCase().includes(search.trim().toLowerCase()));
    return list;
  }, [rows, filter, search]);

  const byDay = useMemo(() => {
    const map = new Map();
    for (const p of filtered) {
      const k = dayKey(postDate(p));
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(p);
    }
    for (const list of map.values()) list.sort((a, b) => postDate(a) - postDate(b));
    return map;
  }, [filtered]);

  const cells = useMemo(() => {
    const start = new Date(cursor);
    start.setDate(1 - start.getDay());
    return Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
  }, [cursor]);

  const today = dayKey(new Date());
  const shiftMonth = (n) => setCursor((c) => { const d = new Date(c); d.setMonth(d.getMonth() + n); return d; });

  function newOn(day) {
    const d = new Date(day);
    d.setHours(10, 0, 0, 0);
    if (d.getTime() < Date.now() + 10 * 60 * 1000) onNew();
    else onNew({ scheduled_at: d.toISOString() });
  }

  const columns = [
    {
      key: 'post', label: 'פוסט', width: 'minmax(220px,2.4fr)',
      render: (p) => (
        <div className="flex min-w-0 items-center gap-3">
          {p.media_urls?.[0] ? (
            <div className="relative flex-none">
              <img src={p.media_urls[0]} alt="" className="h-12 w-12 rounded-lg border border-black/[0.08] object-cover" />
              {p.media_urls.length > 1 && <span className="tabular absolute -end-1.5 -top-1.5 rounded-full bg-slate-950 px-1.5 text-[11px] font-bold text-white">{p.media_urls.length}</span>}
            </div>
          ) : (
            <div className="grid h-12 w-12 flex-none place-items-center rounded-lg bg-ink-800 text-text-faint"><MegaphoneIcon className="h-5 w-5" /></div>
          )}
          <div className="min-w-0">
            <div className="truncate font-semibold">{p.caption || '(ללא טקסט)'}</div>
            <div className="flex gap-1.5 text-[12.5px] font-bold text-text-faint">
              {p.fb_status && <span className={p.fb_status === 'failed' ? 'text-crit-soft' : p.fb_status === 'published' ? 'text-ok' : ''}>FB</span>}
              {p.ig_status && <span className={p.ig_status === 'failed' ? 'text-crit-soft' : p.ig_status === 'published' ? 'text-ok' : ''}>IG</span>}
              {p.boosted_campaign_id && <span className="text-gold-600">· מקודם</span>}
            </div>
          </div>
        </div>
      ),
    },
    { key: 'state', label: 'סטטוס', width: '118px', render: (p) => { const s = POST_STATE[postState(p)]; return <StatusChip tone={s.tone}>{s.label}</StatusChip>; } },
    { key: 'when', label: 'מועד', width: '110px', render: (p) => <span className="tabular text-[13.5px] text-text-faint">{p.published_at ? formatDateTime(p.published_at) : p.scheduled_at ? formatDateTime(p.scheduled_at) : '—'}</span> },
    { key: 'reach', label: 'חשיפה', width: '72px', render: (p) => <span className="tabular">{p.published_at ? compact(reachOf(p)) : '—'}</span> },
    { key: 'eng', label: 'מעורבות', width: '76px', render: (p) => <span className="tabular font-bold">{p.published_at ? compact(engagementOf(p)) : '—'}</span> },
  ];

  return (
    <GlassCard>
      <CardHead icon={MegaphoneIcon} tone="gold" title="לוח תוכן" subtitle="כל הפוסטים — מתוזמנים, טיוטות ופורסמו" />

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Pills size="sm" value={view} onChange={setView} options={[{ value: 'calendar', label: 'לוח שנה' }, { value: 'list', label: 'רשימה' }]} />
        <div className="relative min-w-[180px] flex-1">
          <SearchIcon className="pointer-events-none absolute end-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="חיפוש בטקסט…"
            className="w-full rounded-pill border border-black/[0.09] bg-ink-800 py-2 pe-10 ps-3.5 text-[14.5px] focus:border-gold-500/45 focus:outline-none" />
        </div>
        <Pills size="sm" value={filter} onChange={setFilter} options={FILTERS} />
      </div>

      <Async loading={posts.loading} error={posts.error} onRetry={posts.refetch} isEmpty={false}>
        {view === 'calendar' ? (
          <div>
            <div className="mb-3 flex items-center gap-2">
              <button type="button" onClick={() => shiftMonth(-1)} className="ghost-btn !px-2.5" aria-label="חודש קודם"><ChevronRightIcon className="h-4 w-4" /></button>
              <div className="min-w-[140px] text-center font-display text-[18px] font-bold">
                {cursor.toLocaleDateString('he-IL', { month: 'long', year: 'numeric' })}
              </div>
              <button type="button" onClick={() => shiftMonth(1)} className="ghost-btn !px-2.5" aria-label="חודש הבא"><ChevronRightIcon className="h-4 w-4 rotate-180" /></button>
              <button type="button" onClick={() => { const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); setCursor(d); }} className="ghost-btn ms-1 !py-2 text-[13.5px]">היום</button>
            </div>

            <div className="grid grid-cols-7 gap-1.5 text-center text-[12.5px] font-semibold text-text-faint">
              {WEEKDAYS.map((w) => <div key={w} className="pb-1">{w}</div>)}
            </div>
            <div className="grid grid-cols-7 gap-1.5">
              {cells.map((d) => {
                const k = dayKey(d);
                const list = byDay.get(k) ?? [];
                const inMonth = d.getMonth() === cursor.getMonth();
                return (
                  <div key={k}
                    onClick={(e) => { if (e.target === e.currentTarget) newOn(d); }}
                    className={`group flex cursor-pointer min-h-[74px] flex-col gap-1 rounded-row border p-1.5 text-start sm:min-h-[108px] sm:p-2 ${
                      k === today ? 'border-gold-500/60 bg-gold-500/[0.06]' : 'border-[#E2E8F0] bg-white'
                    } ${inMonth ? '' : 'opacity-45'}`}>
                    <div className="flex items-center justify-between">
                      <span className={`tabular text-[13px] font-bold ${k === today ? 'text-gold-600' : 'text-text-dim'}`}>{d.getDate()}</span>
                      <button type="button" onClick={() => newOn(d)} aria-label="פוסט ביום הזה"
                        className="hidden h-6 w-6 place-items-center rounded-md text-[16px] font-bold leading-none text-text-faint hover:bg-gold-500/[0.14] hover:text-gold-600 sm:group-hover:grid">+</button>
                    </div>
                    {list.slice(0, 3).map((p) => {
                      const st = postState(p);
                      return (
                        <button key={p.id} type="button" onClick={() => onOpen(p)} title={p.caption}
                          className="flex items-center gap-1.5 rounded-md bg-ink-800 px-1.5 py-1 text-start text-[12px] font-semibold leading-tight hover:bg-gold-500/[0.12]">
                          <i className={`h-2 w-2 flex-none rounded-full ${DOT[st]}`} />
                          <span className="tabular hidden flex-none text-text-faint sm:inline">{postDate(p).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}</span>
                          <span className="hidden truncate sm:inline">{p.caption || 'פוסט'}</span>
                        </button>
                      );
                    })}
                    {list.length > 3 && <span className="text-[11.5px] font-semibold text-text-faint">+{list.length - 3}</span>}
                  </div>
                );
              })}
            </div>
            <div className="mt-3 flex flex-wrap gap-4 text-[13px] text-text-dim">
              {Object.entries(DOT).map(([k, c]) => <span key={k} className="inline-flex items-center gap-1.5"><i className={`h-2 w-2 rounded-full ${c}`} />{POST_STATE[k].label}</span>)}
            </div>
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState title={search || filter ? 'אין פוסט שתואם' : 'עוד אין פוסטים'} hint="לחץ “פוסט חדש” — כתיבה, עיצוב בסטודיו ותזמון בחלון אחד." />
        ) : (
          <div className="overflow-x-auto">
            <DataTable
              columns={columns}
              rows={filtered}
              rowKey={(p) => p.id}
              onRowClick={onOpen}
              actions={(p) => {
                const st = postState(p);
                const busy = busyId === p.id;
                const stop = (fn) => (e) => { e.stopPropagation(); fn(); };
                return (
                  <>
                    {(st === 'draft' || st === 'failed') && (
                      <button type="button" disabled={busy} onClick={stop(() => onPublish(p))} className="ghost-btn whitespace-nowrap px-2.5 py-2 text-[13.5px] disabled:opacity-50">
                        {busy ? 'מפרסם…' : st === 'failed' ? 'נסה שוב' : 'פרסם'}
                      </button>
                    )}
                    <button type="button" disabled={busy} onClick={stop(() => onDelete(p))} className="ghost-btn whitespace-nowrap px-2.5 py-2 text-[13.5px] text-crit-soft disabled:opacity-50">מחיקה</button>
                  </>
                );
              }}
            />
          </div>
        )}
      </Async>
    </GlassCard>
  );
}
