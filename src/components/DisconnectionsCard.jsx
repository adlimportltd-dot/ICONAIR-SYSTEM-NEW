import GlassCard, { CardHead } from './ui/GlassCard';
import { StatusChip } from './ui/DataTable';
import { WrenchIcon } from './ui/Icons';
import { useQuery } from '../hooks/useQuery';
import { useRealtime } from '../hooks/useRealtime';
import { listOpenDisconnections, daysUntil, fmtDay } from '../lib/disconnections';

/**
 * phase75 — "ניתוקים קרובים" בראש טאב המסלולים: לקוחות שצריך לנתק ולאסוף מהם
 * מכשירים ב-7 הימים הקרובים (וגם ניתוקים שעבר זמנם). הטכנאי רואה כאן גם ביום
 * הניתוק עצמו. "בוצע ניתוק" נעשה בטאב קריאות שירות/התקנות.
 * קריאה בלבד — אם אין ניתוקים קרובים, הכרטיס לא מוצג.
 */
export default function DisconnectionsCard() {
  const q = useQuery(listOpenDisconnections, []);
  useRealtime(['service_calls'], q.refetch);

  const items = (q.data ?? [])
    .map((d) => ({ ...d, days: daysUntil(d.scheduled_at) }))
    .filter((d) => d.days != null && d.days <= 7);

  if (q.loading || q.error || items.length === 0) return null;

  return (
    <GlassCard className="mb-3.5">
      <CardHead
        icon={WrenchIcon}
        tone="crit"
        title={`ניתוקים קרובים · ${items.length}`}
        subtitle="לקוחות שעוזבים — לאסוף את כל המכשירים. סימון 'בוצע ניתוק' בטאב קריאות שירות/התקנות"
      />
      <div className="flex flex-col gap-1.5">
        {items.map((d) => (
          <div key={d.id} className="inner-row flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 px-4 py-2.5">
            <div className="min-w-0">
              <div className="truncate text-[15px] font-semibold">{d.customer?.name ?? '—'}</div>
              <div className="truncate text-[13px] text-text-faint">
                {[d.customer?.address, d.customer?.city].filter(Boolean).join(', ') || '—'}
                {d.customer?.route_name ? ` · ${d.customer.route_name}` : ''}
                {` · ${d.assignee?.full_name ?? 'לא שובץ טכנאי'}`}
              </div>
            </div>
            <StatusChip tone={d.days <= 0 ? 'crit' : 'warn'}>
              {d.days < 0 ? `באיחור · היה ל-${fmtDay(d.scheduled_at)}` : d.days === 0 ? 'ניתוק היום' : `בעוד ${d.days} ימים · ${fmtDay(d.scheduled_at)}`}
            </StatusChip>
          </div>
        ))}
      </div>
    </GlassCard>
  );
}
