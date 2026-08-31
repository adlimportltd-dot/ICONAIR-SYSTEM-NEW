import GlassCard, { CardHead } from './ui/GlassCard';

/* פס החומרה בקצה השורה — הדחיפות נקראת לפני שקוראים מילה */
const SEVERITY_BAR = {
  crit: 'bg-crit shadow-[0_0_12px_rgba(240,85,92,.55)]',
  warn: 'bg-warn shadow-[0_0_12px_rgba(240,164,58,.4)]',
  norm: 'bg-slate-500',
  sched: 'bg-white/20',
};

const SEVERITY_CHIP = {
  crit: 'text-crit-soft border-crit/30 bg-crit/10',
  warn: 'text-[#FFC479] border-warn/30 bg-warn/[0.09]',
  norm: '',
  sched: 'text-gold-300 border-gold-500/30 bg-gold-500/[0.14]',
};

export default function ServiceCallsCard({ delay, calls = [], subtitle, onOpenAll, onSelect }) {
  return (
    <GlassCard delay={delay}>
      <CardHead
        title="קריאות שירות פתוחות"
        subtitle={subtitle}
        action="לכל הקריאות"
        onAction={onOpenAll}
      />

      <div className="flex flex-col gap-[9px]">
        {calls.map((call) => (
          <button
            key={call.rowId ?? call.id}
            type="button"
            onClick={onSelect ? () => onSelect(call) : undefined}
            className="inner-row group grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1
                       px-3.5 py-[13px] text-start transition-all
                       hover:-translate-x-[3px] hover:border-white/[0.13] hover:bg-white/[0.05]
                       sm:grid-cols-[auto_minmax(0,1fr)_auto]"
          >
            <i
              aria-hidden
              className={`row-span-2 h-full min-h-[38px] w-[3px] flex-none rounded-[3px]
                          sm:h-[34px] sm:min-h-0 ${SEVERITY_BAR[call.severity]}`}
            />

            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">{call.client}</div>
              <div className="mt-0.5 truncate text-[12.5px] text-text-faint">{call.description}</div>
            </div>

            <div className="mt-[5px] flex flex-row items-center gap-[9px]
                            sm:row-span-2 sm:mt-0 sm:flex-col sm:items-end sm:gap-[5px]">
              <span className={`chip ${SEVERITY_CHIP[call.severity]}`}>{call.statusLabel}</span>
              <span className="tabular text-[11.5px] text-text-faint">
                {call.id} · {call.age}
              </span>
            </div>
          </button>
        ))}
      </div>
    </GlassCard>
  );
}
