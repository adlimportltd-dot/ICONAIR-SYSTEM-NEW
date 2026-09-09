import GlassCard from './ui/GlassCard';
import { iconMap, ArrowUpIcon, ArrowDownIcon } from './ui/Icons';

const iconTone = {
  slate: 'text-slate-500',
  teal: 'text-teal-500',
  gold: 'text-gold-600',
  crit: 'text-crit',
};

// 2026-09-09 (בעקבות משוב "אפור ויבש"): מיכל האייקון עצמו צובע לפי
// kpi.iconColor, לא רק הגליף בתוכו — קודם המיכל היה זהב אחיד תמיד, אז
// אייקון אדום/טורקיז/אפור בתוך עיגול זהוב נראה מנותק. עכשיו כל הכרטיס
// (עיגול+גליף) מספר את אותו סיפור-צבע במבט אחד.
const containerTone = {
  slate: 'border-slate-500/30 bg-slate-500/[0.12]',
  teal: 'border-teal-500/30 bg-teal-500/[0.12]',
  gold: 'border-gold-300/[0.35] bg-gold-500/[0.14]',
  crit: 'border-crit/30 bg-crit/[0.12]',
};

const trendTone = {
  up: 'text-ok bg-ok/10 border-ok/20',
  down: 'text-crit bg-crit/10 border-crit/20',
  flat: 'text-gold-600 bg-gold-500/[0.14] border-gold-500/25',
};

/** שבב מגמה: כיוון + ערך. hideArrow למקרים שהמספר הוא ספירה ולא שינוי. */
function Trend({ direction, text, hideArrow }) {
  const Arrow = direction === 'down' ? ArrowDownIcon : ArrowUpIcon;

  return (
    <span
      className={`tabular inline-flex items-center gap-1 whitespace-nowrap rounded-lg border
                  px-[9px] py-[4px] text-[14px] font-semibold ${trendTone[direction]}`}
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
    <GlassCard delay={delay} className="!px-6 !py-6">
      <div className="mb-5 flex items-center gap-3">
        <div className={`grid h-10 w-10 flex-none place-items-center rounded-xl border
                        shadow-icon-glow ${containerTone[kpi.iconColor] ?? containerTone.gold}`}>
          <Icon className={`h-[18px] w-[18px] ${iconTone[kpi.iconColor]}`} />
        </div>
        <div className="text-[14px] font-semibold uppercase tracking-[1.1px] text-text-faint">{kpi.label}</div>
      </div>

      <div className="tabular font-display text-[44px] font-bold leading-none tracking-[-0.5px]">
        {kpi.value}
        {kpi.unit && <span className="ms-[6px] font-ui text-[15px] font-medium text-text-dim">{kpi.unit}</span>}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 text-[14px] text-text-faint">
        <Trend {...kpi.trend} />
        {kpi.footnote}
      </div>
    </GlassCard>
  );
}
