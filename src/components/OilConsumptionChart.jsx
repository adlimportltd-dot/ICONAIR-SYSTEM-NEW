import { useMemo } from 'react';
import GlassCard, { CardHead, Swatch } from './ui/GlassCard';

/* מערכת הקואורדינטות של הגרף. ה-SVG נמתח לרוחב הכרטיס
   (preserveAspectRatio="none"), ולכן כל קו מקבל vector-effect
   כדי שעובי הקו לא יתעוות. */
const W = 720;
const H = 224;
const PAD_X = 20;
const TOP = 40;
const BOTTOM = 200;
const BASELINE = 212;
const GRID_LINES = [8, 62, 116, 170, 212];

/** ערך לא-מספרי (null/undefined/NaN/מחרוזת ריקה) הופך ל-0, לא קורס את הגרף */
const toFinite = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

function buildScale(series) {
  const all = series.flat().map(toFinite);
  const lo = Math.min(...all) * 0.85;
  const hiRaw = Math.max(...all) * 1.05;
  // כשכל הערכים שווים (הכי נפוץ: אין עדיין שום צריכה, הכול 0), הטווח
  // מתאפס ל-lo===hi, וחלוקה ב-(hi-lo) הייתה מחזירה NaN לכל נקודה.
  const hi = hiRaw > lo ? hiRaw : lo + 1;

  const x = (i, n) => (n > 1 ? PAD_X + (i * (W - PAD_X * 2)) / (n - 1) : PAD_X);
  const y = (v) => BOTTOM - ((toFinite(v) - lo) / (hi - lo)) * (BOTTOM - TOP);

  return { x, y };
}

const toPath = (values, x, y) =>
  values.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i, values.length).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');

export default function OilConsumptionChart({ delay, data }) {
  const { months = [], actual = [], forecast = [], summary = {} } = data ?? {};
  const hasData = actual.length > 1;

  const { actualLine, actualArea, forecastLine, endPoint } = useMemo(() => {
    if (!hasData) return {};

    const { x, y } = buildScale([actual, forecast]);
    const line = toPath(actual, x, y);
    const lastX = x(actual.length - 1, actual.length);

    return {
      actualLine: line,
      actualArea: `${line} L${lastX.toFixed(1)} ${BASELINE} L${PAD_X} ${BASELINE} Z`,
      forecastLine: toPath(forecast, x, y),
      endPoint: { x: lastX, y: y(actual[actual.length - 1]) },
    };
  }, [actual, forecast, hasData]);

  return (
    <GlassCard delay={delay}>
      <CardHead
        title="צריכת שמן לאורך השנה"
        subtitle="ליטרים בפועל מול ממוצע נגרר של 3 החודשים הקודמים"
        action={`${months.length} חודשים`}
      />

      {!hasData ? (
        <p className="rounded-row border border-dashed border-white/[0.1] px-4 py-8 text-center
                      text-[12.5px] text-text-faint">
          עוד אין מספיק היסטוריה לגרף. כל רישום מילוי במסך "מעקב שמנים" מוסיף כאן נקודה.
        </p>
      ) : (
      <>
      <div className="relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="block h-56 w-full overflow-visible"
          role="img"
          aria-label="גרף צריכת שמן חודשית — בפועל מול תחזית"
        >
          <defs>
            <linearGradient id="oilArea" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#D8B36A" stopOpacity=".34" />
              <stop offset="100%" stopColor="#D8B36A" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="oilLine" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#4CC9C0" />
              <stop offset="100%" stopColor="#F0DCB4" />
            </linearGradient>
          </defs>

          <g stroke="rgba(37,30,16,.08)" strokeWidth="1" vectorEffect="non-scaling-stroke">
            {GRID_LINES.map((y) => (
              <line key={y} x1="0" y1={y} x2={W} y2={y} />
            ))}
          </g>

          <path
            d={forecastLine}
            fill="none"
            stroke="rgba(110,134,168,.75)"
            strokeWidth="1.6"
            strokeDasharray="5 6"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />

          <path d={actualArea} fill="url(#oilArea)" />
          <path
            d={actualLine}
            fill="none"
            stroke="url(#oilLine)"
            strokeWidth="2.4"
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />

          {/* נקודת הסיום: קו באורך אפס עם קצה עגול — נשאר עיגול מושלם
              גם כשה-SVG נמתח בצורה לא-אחידה, בניגוד ל-circle */}
          {[
            { stroke: 'rgba(240,220,180,.16)', width: 22 },
            { stroke: '#F0DCB4', width: 8 },
            { stroke: '#FFFFFF', width: 3 },
          ].map((dot) => (
            <line
              key={dot.width}
              x1={endPoint.x}
              y1={endPoint.y}
              x2={endPoint.x}
              y2={endPoint.y}
              stroke={dot.stroke}
              strokeWidth={dot.width}
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>
      </div>

      {/* ציר הזמן זורם משמאל לימין יחד עם ה-SVG, גם בממשק RTL */}
      <div dir="ltr" className="mt-2.5 flex justify-between px-[2.5%] text-[11.5px] tracking-wide text-text-faint">
        {months.map((m) => (
          <span key={m}>{m}</span>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap gap-4 border-t border-white/[0.075] pt-[15px]">
        <span className="flex items-center gap-2 text-[12.5px] text-text-dim">
          <Swatch style={{ background: 'linear-gradient(90deg,#4CC9C0,#F0DCB4)' }} />
          צריכה בפועל <b className="tabular font-semibold text-text">{summary.actualTotal}</b>
        </span>
        <span className="flex items-center gap-2 text-[12.5px] text-text-dim">
          <Swatch style={{ background: 'rgba(110,134,168,.75)' }} />
          ממוצע נגרר <b className="tabular font-semibold text-text">{summary.forecastTotal}</b>
        </span>
        <span className="flex items-center gap-2 text-[12.5px] text-text-dim">
          <Swatch style={{ background: '#4ED9A4' }} />
          סטייה <b className="tabular font-semibold text-text">{summary.deviation}</b>
        </span>
      </div>
      </>
      )}
    </GlassCard>
  );
}
