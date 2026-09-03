import GlassCard, { CardHead } from './ui/GlassCard';

const FILL = {
  gold: 'linear-gradient(90deg,#C5A059,#D4AF37)',
  teal: 'linear-gradient(90deg,#4CC9C0,#8FE3DC)',
  slate: 'linear-gradient(90deg,#6E86A8,#A3B6CE)',
  crit: 'linear-gradient(90deg,#F0555C,#F0A43A)',
};

export default function StockCard({ delay, stock = [], monthTotal }) {
  return (
    <GlassCard delay={delay}>
      <CardHead title="תצרוכת שמן לפי ניחוח" subtitle="החודש הנוכחי, מתוך יומן המילויים" />

      <div className="flex flex-col gap-[15px]">
        {stock.map((item) => (
          <div key={item.scent}>
            <div className="flex items-baseline gap-2 text-[13.5px]">
              <b className="font-semibold">{item.scent}</b>
              <span className="tabular ms-auto font-mono text-xs text-text-dim">{item.level}%</span>
            </div>
            <div className="meter">
              <span style={{ width: `${item.level}%`, background: FILL[item.tone] }} />
            </div>
          </div>
        ))}

        {monthTotal && (
          <div className="mt-0.5 flex justify-between text-[11.5px] text-text-faint">
            <span>סה״כ נצרך החודש</span>
            <b className="tabular font-semibold text-text-dim">{monthTotal}</b>
          </div>
        )}
      </div>
    </GlassCard>
  );
}
