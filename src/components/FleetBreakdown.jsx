import GlassCard, { CardHead, Swatch } from './ui/GlassCard';

/* הזהב שמור לדגם הדגל (Icon 700) — הצבע מסמן היררכיה, לא רק קטגוריה */
const TONE = {
  slate: '#6E86A8',
  teal: '#4CC9C0',
  gold: '#D8B36A',
};

const R = 54;
const CIRCUMFERENCE = 2 * Math.PI * R;
const GAP = 4;

export default function FleetBreakdown({ delay, data = [] }) {
  const total = data.reduce((sum, m) => sum + m.count, 0);

  let cursor = 0;
  const arcs = data.map((model) => {
    const share = model.count / total;
    const length = share * CIRCUMFERENCE;
    const arc = {
      ...model,
      share,
      dash: `${Math.max(length - GAP, 1).toFixed(1)} ${(CIRCUMFERENCE - length + GAP).toFixed(1)}`,
      offset: -Number(cursor.toFixed(1)),
    };
    cursor += length;
    return arc;
  });

  return (
    <GlassCard delay={delay}>
      <CardHead title="פילוח הצי" subtitle="לפי דגם מכשיר" />

      <div className="flex flex-col gap-[18px]">
        <div className="relative mx-auto mt-0.5 h-[180px] w-[180px]">
          <svg viewBox="0 0 140 140" className="h-[180px] w-[180px] -rotate-90" aria-hidden>
            <circle cx="70" cy="70" r={R} fill="none" stroke="rgba(37,30,16,.07)" strokeWidth="15" />
            {arcs.map((arc) => (
              <circle
                key={arc.model}
                cx="70"
                cy="70"
                r={R}
                fill="none"
                stroke={TONE[arc.color]}
                strokeWidth="15"
                strokeLinecap="round"
                strokeDasharray={arc.dash}
                strokeDashoffset={arc.offset}
              />
            ))}
          </svg>

          <div className="absolute inset-0 grid place-content-center text-center">
            <div className="tabular font-display text-[34px] font-bold leading-none">{total}</div>
            <div className="mt-[5px] text-[11.5px] tracking-wide text-text-faint">מכשירים</div>
          </div>
        </div>

        <div className="flex flex-col gap-2.5">
          {arcs.map((arc) => (
            <div key={arc.model} className="flex items-center gap-2.5 text-[13.5px]">
              <Swatch style={{ background: TONE[arc.color] }} />
              <span className="font-semibold">{arc.model}</span>
              <span className="tabular ms-auto font-mono text-[13px] text-text-dim">{arc.count}</span>
              <span className="tabular w-[42px] text-start font-mono text-[11.5px] text-text-faint">
                {Math.round(arc.share * 100)}%
              </span>
            </div>
          ))}
        </div>
      </div>
    </GlassCard>
  );
}
