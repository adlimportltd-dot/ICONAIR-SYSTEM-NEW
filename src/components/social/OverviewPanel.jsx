import { useMemo } from 'react';
import GlassCard, { CardHead } from '../ui/GlassCard';
import { StatusChip } from '../ui/DataTable';
import { ChartIcon, MegaphoneIcon, FunnelIcon, BellIcon } from '../ui/Icons';
import { EmptyState } from '../ui/States';
import { Stat, TrendChart, Bar } from './SocialUI';
import { postState, POST_STATE, engagementOf, reachOf, compact, num } from '../../lib/social';

/**
 * סקירה: מה קרה ב-30 יום, מה מתוכנן לשבוע הקרוב, מה דורש טיפול,
 * והפוסטים המובילים. הכל מחושב מהנתונים האמיתיים שה-Autopilot אוסף.
 */
export default function OverviewPanel({ posts, settings, live, leads, onOpen, onNew, onGo }) {
  const rows = posts ?? [];

  const stats = useMemo(() => {
    const since = Date.now() - 30 * 86400000;
    const recent = rows.filter((p) => p.published_at && new Date(p.published_at).getTime() >= since);
    const upcoming = rows
      .filter((p) => !p.is_draft && p.scheduled_at && new Date(p.scheduled_at) > new Date() && postState(p) !== 'published')
      .sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at));
    const failed = rows.filter((p) => postState(p) === 'failed');
    const drafts = rows.filter((p) => p.is_draft);
    const top = [...recent].sort((a, b) => engagementOf(b) - engagementOf(a)).slice(0, 5);

    const days = Array.from({ length: 30 }, (_, i) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - 29 + i); return d; });
    const eng = days.map((d) => recent.filter((p) => new Date(p.published_at).toDateString() === d.toDateString()).reduce((a, p) => a + engagementOf(p), 0));
    const leadsDaily = days.map((d) => (leads ?? []).filter((l) => new Date(l.created_at).toDateString() === d.toDateString()).length);

    return {
      published: recent.length,
      reach: recent.reduce((a, p) => a + reachOf(p), 0),
      engagement: recent.reduce((a, p) => a + engagementOf(p), 0),
      leads30: leadsDaily.reduce((a, b) => a + b, 0),
      upcoming, failed, drafts, top,
      labels: days.map((d) => d.toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' })),
      eng, leadsDaily,
    };
  }, [rows, leads]);

  const maxTop = Math.max(1, ...stats.top.map(engagementOf));

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-5 lg:grid-cols-4">
        <Stat label="פוסטים ב-30 יום" value={num(stats.published)} hint={`${stats.upcoming.length} מתוזמנים קדימה`} />
        <Stat label="חשיפה" value={compact(stats.reach)} hint="פייסבוק + אינסטגרם" />
        <Stat label="מעורבות" value={compact(stats.engagement)} tone="gold" hint="לייקים, תגובות, שיתופים, שמירות" />
        <Stat label="לידים ב-CRM" value={num(stats.leads30)} hint="נקלטו ב-30 הימים האחרונים" />
      </div>

      {settings?.connected && (live?.page_followers != null || live?.ig_followers != null) && (
        <div className="grid grid-cols-2 gap-5">
          <div className="inner-row flex items-center gap-3 px-5 py-4">
            <span className="font-bold">עוקבי העמוד</span>
            <span className="tabular ms-auto font-display text-[24px] font-bold">{num(live.page_followers)}</span>
          </div>
          <div className="inner-row flex items-center gap-3 px-5 py-4">
            <span className="font-bold">עוקבי אינסטגרם</span>
            <span className="tabular ms-auto font-display text-[24px] font-bold">{live.ig_followers != null ? num(live.ig_followers) : '—'}</span>
          </div>
        </div>
      )}

      <GlassCard>
        <CardHead icon={ChartIcon} tone="teal" title="מעורבות מול לידים" subtitle="30 הימים האחרונים — האם התוכן מייצר פניות" />
        <TrendChart labels={stats.labels} primary={stats.eng} secondary={stats.leadsDaily} primaryLabel="מעורבות בפוסטים" secondaryLabel="לידים שנקלטו" format={compact} />
      </GlassCard>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <GlassCard>
          <CardHead icon={BellIcon} tone="gold" title="השבוע הקרוב" subtitle="מה ה-Autopilot יפרסם" action="פוסט חדש" onAction={() => onNew()} />
          {stats.upcoming.length === 0 ? (
            <EmptyState title="אין פוסטים מתוזמנים" hint="תזמן כמה פוסטים קדימה — הם יעלו לבד, בדיוק בזמן." />
          ) : (
            <div className="flex flex-col gap-2.5">
              {stats.upcoming.slice(0, 6).map((p) => (
                <button key={p.id} type="button" onClick={() => onOpen(p)} className="inner-row flex items-center gap-3 px-4 py-3 text-start hover:bg-gold-500/[0.07]">
                  <div className="w-[64px] flex-none text-center">
                    <div className="text-[12.5px] font-semibold text-text-faint">{new Date(p.scheduled_at).toLocaleDateString('he-IL', { weekday: 'short' })}</div>
                    <div className="tabular font-bold">{new Date(p.scheduled_at).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}</div>
                  </div>
                  {p.media_urls?.[0] && <img src={p.media_urls[0]} alt="" className="h-10 w-10 flex-none rounded-lg object-cover" />}
                  <span className="min-w-0 flex-1 truncate text-[14.5px]">{p.caption || 'פוסט'}</span>
                  <span className="flex-none text-[12.5px] font-bold text-text-faint">{[p.fb_status && 'FB', p.ig_status && 'IG'].filter(Boolean).join(' · ')}</span>
                </button>
              ))}
            </div>
          )}
        </GlassCard>

        <GlassCard>
          <CardHead icon={MegaphoneIcon} tone="ok" title="הפוסטים המובילים" subtitle="לפי מעורבות, 30 יום" />
          {stats.top.length === 0 ? (
            <EmptyState title="עוד אין נתוני ביצועים" hint="אחרי הפרסום הראשון, הביצועים מתעדכנים אוטומטית כל חצי שעה." />
          ) : (
            <div className="flex flex-col gap-3.5">
              {stats.top.map((p) => (
                <button key={p.id} type="button" onClick={() => onOpen(p)} className="flex items-center gap-3 text-start">
                  {p.media_urls?.[0] ? <img src={p.media_urls[0]} alt="" className="h-11 w-11 flex-none rounded-lg object-cover" /> : <div className="h-11 w-11 flex-none rounded-lg bg-ink-800" />}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[14.5px] font-semibold">{p.caption || 'פוסט'}</div>
                    <div className="mt-1.5"><Bar value={engagementOf(p)} max={maxTop} /></div>
                  </div>
                  <span className="tabular w-14 flex-none text-end font-bold">{compact(engagementOf(p))}</span>
                </button>
              ))}
            </div>
          )}
        </GlassCard>
      </div>

      {(stats.failed.length > 0 || stats.drafts.length > 0) && (
        <GlassCard>
          <CardHead icon={FunnelIcon} tone={stats.failed.length ? 'crit' : 'slate'} title="דורש תשומת לב" subtitle="פוסטים שלא עלו וטיוטות שמחכות" />
          <div className="flex flex-col gap-2.5">
            {[...stats.failed, ...stats.drafts.slice(0, 5)].map((p) => {
              const s = POST_STATE[postState(p)];
              return (
                <button key={p.id} type="button" onClick={() => onOpen(p)} className="inner-row flex flex-wrap items-center gap-3 px-4 py-3 text-start">
                  <StatusChip tone={s.tone}>{s.label}</StatusChip>
                  <span className="min-w-0 flex-1 truncate text-[14.5px]">{p.caption || 'פוסט'}</span>
                  {(p.fb_error || p.ig_error) && <span className="basis-full text-[13.5px] text-crit-soft">{p.fb_error || p.ig_error}</span>}
                </button>
              );
            })}
          </div>
          {stats.failed.length > 0 && <button type="button" className="ghost-btn mt-3" onClick={() => onGo('content')}>לכל הפוסטים</button>}
        </GlassCard>
      )}
    </div>
  );
}
