import GlassCard from './ui/GlassCard';
import { iconMap, ArrowUpIcon, ArrowDownIcon } from './ui/Icons';

const iconTone = {
  slate: 'text-slate-500',
  teal: 'text-teal-500',
  gold: 'text-gold-500',
  crit: 'text-crit',
};

const trendTone = {
  up: 'text-ok bg-ok/10 border-ok/20',
  down: 'text-crit bg-crit/10 border-crit/20',
  flat: 'text-gold-300 bg-gold-500/[0.14] border-gold-500/25',
};

/** שבב מגמה: כיוון + ערך. hideArrow למקרים שהמספר הוא ספירה ולא שינוי. */
function Trend({ direction, text, hideArrow }) {
  const Arrow = direction === 'down' ? ArrowDownIcon : ArrowUpIcon;

  return (
    <span
      className={`tabular inline-flex items-center gap-1 whitespace-nowrap rounded-lg border
                  px-[9px] py-[3px] text-[11.5px] font-semibold ${trendTone[direction]}`}
    >
      {!hideArrow && direction !== 'flat' && <Arrow className="h-[11px] w-[11px]" />}
      {text}
    </span>
  );
}

export default function KpiCard({ kpi, delay }) {
  const Icon = iconMap[kpi.icon];
  if (!Icon) return null;

  return (
    <GlassCard delay={delay} className="!px-5 !py-[18px]">
      <div className="mb-3.5 flex items-center gap-[11px]">
        <div className="grid h-[38px] w-[38px] flex-none place-items-center rounded-xl
                        border border-white/[0.13] bg-white/[0.04]">
          <Icon className={`h-[18px] w-[18px] ${iconTone[kpi.iconColor]}`} />
        </div>
        <div className="text-[13px] font-medium text-text-dim">{kpi.label}</div>
      </div>

      <div className="tabular font-display text-[38px] font-bold leading-none tracking-tight">
        {kpi.value}
        {kpi.unit && <span className="ms-[5px] font-ui text-[15px] font-medium text-text-dim">{kpi.unit}</span>}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-[12.5px] text-text-faint">
        <Trend {...kpi.trend} />
        {kpi.footnote}
      </div>
    </GlassCard>
  );
}
