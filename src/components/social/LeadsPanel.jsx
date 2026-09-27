import { useMemo } from 'react';
import GlassCard, { CardHead } from '../ui/GlassCard';
import { FunnelIcon, ChartIcon } from '../ui/Icons';
import { Async, EmptyState } from '../ui/States';
import { useQuery } from '../../hooks/useQuery';
import { listLeadStatuses } from '../../lib/queries';
import { formatDateTime } from '../../lib/mappers';
import { Stat, TrendChart, Bar } from './SocialUI';
import { num } from '../../lib/social';

/**
 * לידים מקמפיינים — אותה טבלת leads בדיוק שמזינה את טאב "לידים מקמפיין"
 * (Make.com ← טופסי Meta). כאן רק ניתוח: משפך, קצב קליטה ואחוז המרה.
 * הטיפול בליד עצמו נשאר בטאב הלידים — אין כפילות.
 */
export default function LeadsPanel({ leads, onGoLeads }) {
  const statuses = useQuery(listLeadStatuses, []);
  const rows = leads.data ?? [];

  const s = useMemo(() => {
    const labels = { converted: 'הומר ללקוח' };
    for (const st of statuses.data ?? []) labels[st.name] = st.label;
    const counts = {};
    for (const l of rows) counts[l.status] = (counts[l.status] || 0) + 1;
    const funnel = Object.entries(counts).map(([k, v]) => ({ key: k, label: labels[k] ?? k, value: v })).sort((a, b) => b.value - a.value);

    const days = Array.from({ length: 30 }, (_, i) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - 29 + i); return d; });
    const daily = days.map((d) => rows.filter((l) => new Date(l.created_at).toDateString() === d.toDateString()).length);
    const last30 = daily.reduce((a, b) => a + b, 0);
    const prev30 = rows.filter((l) => { const t = new Date(l.created_at).getTime(); return t < Date.now() - 30 * 86400000 && t >= Date.now() - 60 * 86400000; }).length;
    const converted = counts.converted || 0;
    return {
      funnel, daily, last30, prev30, converted,
      rate: rows.length ? (converted / rows.length) * 100 : 0,
      fresh: counts.new || 0,
      labels: days.map((d) => d.toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' })),
      recent: rows.slice(0, 8), labelOf: (k) => labels[k] ?? k,
    };
  }, [rows, statuses.data]);

  const trend = s.prev30 ? Math.round(((s.last30 - s.prev30) / s.prev30) * 100) : null;
  const max = Math.max(1, ...s.funnel.map((f) => f.value));

  return (
    <Async loading={leads.loading} error={leads.error} onRetry={leads.refetch} isEmpty={false}>
      <div className="flex flex-col gap-5">
        <div className="grid grid-cols-2 gap-5 lg:grid-cols-4">
          <Stat label="לידים ב-30 יום" value={num(s.last30)} tone="gold" hint={trend != null ? `${trend >= 0 ? '+' : ''}${trend}% מול 30 הימים הקודמים` : undefined} />
          <Stat label="חדשים שמחכים" value={num(s.fresh)} tone={s.fresh ? 'crit' : undefined} hint="עוד לא טופלו" />
          <Stat label="הומרו ללקוח" value={num(s.converted)} tone="ok" hint="90 יום" />
          <Stat label="אחוז המרה" value={`${s.rate.toFixed(1)}%`} hint="ליד → לקוח פעיל" />
        </div>

        <GlassCard>
          <CardHead icon={ChartIcon} tone="teal" title="קצב קליטת לידים" subtitle="לפי יום, 30 הימים האחרונים" action="לטאב הלידים" onAction={onGoLeads} />
          <TrendChart labels={s.labels} primary={s.daily} primaryLabel="לידים ביום" />
        </GlassCard>

        <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
          <GlassCard>
            <CardHead icon={FunnelIcon} tone="gold" title="משפך" subtitle="איפה הלידים נמצאים עכשיו (90 יום)" />
            {s.funnel.length === 0 ? <EmptyState title="עוד אין לידים" /> : (
              <div className="flex flex-col gap-3.5">
                {s.funnel.map((f) => (
                  <div key={f.key}>
                    <div className="mb-1.5 flex justify-between text-[14.5px]"><span className="font-semibold">{f.label}</span><span className="tabular font-bold">{num(f.value)}</span></div>
                    <Bar value={f.value} max={max} tone={f.key === 'converted' ? 'teal' : 'gold'} />
                  </div>
                ))}
              </div>
            )}
          </GlassCard>

          <GlassCard>
            <CardHead icon={FunnelIcon} tone="slate" title="אחרונים שנכנסו" subtitle="לטיפול — בטאב הלידים" />
            {s.recent.length === 0 ? <EmptyState title="עוד אין לידים" /> : (
              <div className="flex flex-col gap-2">
                {s.recent.map((l) => (
                  <button key={l.id} type="button" onClick={onGoLeads} className="inner-row flex items-center gap-3 px-4 py-3 text-start hover:bg-gold-500/[0.07]">
                    <span className="min-w-0 flex-1 truncate font-semibold">{l.full_name}{l.city ? <span className="font-normal text-text-faint"> · {l.city}</span> : null}</span>
                    <span className="chip">{s.labelOf(l.status)}</span>
                    <span className="tabular hidden text-[13px] text-text-faint sm:inline">{formatDateTime(l.created_at)}</span>
                  </button>
                ))}
              </div>
            )}
          </GlassCard>
        </div>
      </div>
    </Async>
  );
}
