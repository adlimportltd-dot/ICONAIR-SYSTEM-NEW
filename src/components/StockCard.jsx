import GlassCard, { CardHead } from './ui/GlassCard';
import { BoxIcon } from './ui/Icons';

const FILL = {
  gold: 'linear-gradient(90deg,#D97706,#FCD34D)',
  teal: 'linear-gradient(90deg,#0F766E,#5EA39B)',
  slate: 'linear-gradient(90deg,#475569,#5B6B82)',
  crit: 'linear-gradient(90deg,#B91C1C,#B45309)',
};

export default function StockCard({ delay, stock = [], monthTotal }) {
  return (
    <GlassCard delay={delay}>
      <CardHead icon={BoxIcon} title="תצרוכת שמן לפי ניחוח" subtitle="החודש הנוכחי, מתוך יומן המילויים" />

      <div className="flex flex-col gap-[15px]">
        {stock.map((item) => (
          <div key={item.scent}>
            <div className="flex items-baseline gap-2 text-[15px]">
              <b className="font-semibold">{item.scent}</b>
              <span className="tabular ms-auto font-mono text-[13.5px] text-text-dim">{item.level}%</span>
            </div>
            <div className="meter">
              <span style={{ width: `${item.level}%`, background: FILL[item.tone] }} />
            </div>
          </div>
        ))}

        {monthTotal && (
          <div className="mt-0.5 flex justify-between text-[13px] text-text-faint">
            <span>סה״כ נצרך החודש</span>
            <b className="tabular font-semibold text-text-dim">{monthTotal}</b>
          </div>
        )}
      </div>
    </GlassCard>
  );
}
