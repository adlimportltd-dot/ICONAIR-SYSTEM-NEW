import GlassCard, { CardHead } from './ui/GlassCard';

/**
 * אין טבלת route_stops (ביקורים מתוכננים) בסכימה הפשוטה, אז אין "התקדמות
 * היום". במקום זה — פילוח אמיתי: כמה מכשירים על כל קו, כמה מהם פעילים,
 * ומה מפלס השמן הממוצע שלהם (הטבעת צובעת לפי זה).
 */
const RING_R = 19;
const RING_C = 2 * Math.PI * RING_R;

function oilRingColor(percent) {
  if (percent >= 55) return '#4CC9C0';
  if (percent >= 35) return '#D8B36A';
  return '#F0555C';
}

function ProgressRing({ percent }) {
  const color = oilRingColor(percent);
  return (
    <div className="relative h-[46px] w-[46px] flex-none">
      <svg width="46" height="46" viewBox="0 0 46 46" className="-rotate-90" aria-hidden>
        <circle cx="23" cy="23" r={RING_R} fill="none" stroke="rgba(255,255,255,.07)" strokeWidth="4" />
        <circle
          cx="23"
          cy="23"
          r={RING_R}
          fill="none"
          stroke={color}
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={`${((percent / 100) * RING_C).toFixed(1)} ${RING_C.toFixed(1)}`}
        />
      </svg>
      <span className="tabular absolute inset-0 grid place-items-center text-[11.5px] font-semibold">
        {Math.round(percent)}%
      </span>
    </div>
  );
}

export default function RoutesCard({ delay, routes = [], onOpenMap }) {
  const totalDevices = routes.reduce((sum, route) => sum + route.total, 0);

  return (
    <GlassCard delay={delay}>
      <CardHead
        title="פילוח לפי קו הפצה"
        subtitle={`${routes.length} קווים · ${totalDevices} מכשירים בשטח`}
        action="לכל המכשירים"
        onAction={onOpenMap}
      />

      <div className="flex flex-col gap-[11px]">
        {routes.map((route) => (
          <div key={route.name} className="inner-row flex items-center gap-[13px] px-3.5 py-[13px]">
            <ProgressRing percent={route.avgOil} />

            <div className="min-w-0">
              <div className="text-sm font-semibold">{route.name}</div>
              <div className="mt-0.5 truncate text-xs text-text-faint">
                {route.active}/{route.total} מכשירים פעילים
              </div>
            </div>

            <div className="ms-auto text-start">
              <b className="tabular font-mono text-sm font-medium">{Math.round(route.avgOil)}%</b>
              <i className="mt-0.5 block text-[11px] not-italic text-text-faint">שמן ממוצע</i>
            </div>
          </div>
        ))}
      </div>
    </GlassCard>
  );
}
