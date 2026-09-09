import { useMemo } from 'react';
import GlassCard, { CardHead, Swatch } from './ui/GlassCard';
import { DropIcon } from './ui/Icons';

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

/**
 * עקומת Catmull-Rom הפוכה לבזייה מעוקבת — עוברת בדיוק דרך כל נקודת
 * נתון (בניגוד לעקומה מוחלקת-בממוצע), אבל בלי הפינות החדות של קווים
 * ישרים. זה מה שנותן לגרף מראה "אנליטיקס" נקי במקום סקיצה גרפית.
 */
function smoothPath(points) {
  if (points.length < 2) return '';
  if (points.length === 2) {
    return `M${points[0][0].toFixed(1)} ${points[0][1].toFixed(1)} L${points[1][0].toFixed(1)} ${points[1][1].toFixed(1)}`;
  }

  let d = `M${points[0][0].toFixed(1)} ${points[0][1].toFixed(1)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i === 0 ? 0 : i - 1];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;

    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;

    d += ` C${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return d;
}

const toPath = (values, x, y) => smoothPath(values.map((v, i) => [x(i, values.length), y(v)]));

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
        icon={DropIcon}
        title="צריכת שמן לאורך השנה"
        subtitle="ליטרים בפועל מול ממוצע נגרר של 3 החודשים הקודמים"
        action={`${months.length} חודשים`}
      />

      {!hasData ? (
        <p className="rounded-row border border-dashed border-black/[0.1] px-4 py-8 text-center
                      text-[14px] text-text-faint">
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
              <stop offset="0%" stopColor="#D97706" stopOpacity=".34" />
              <stop offset="100%" stopColor="#D97706" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="oilLine" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#0F766E" />
              <stop offset="100%" stopColor="#FCD34D" />
            </linearGradient>
          </defs>

          <g stroke="rgba(44,42,41,.08)" strokeWidth="1" vectorEffect="non-scaling-stroke">
            {GRID_LINES.map((y) => (
              <line key={y} x1="0" y1={y} x2={W} y2={y} />
            ))}
          </g>

          <path
            d={forecastLine}
            fill="none"
            stroke="rgba(71,85,105,.85)"
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
            { stroke: 'rgba(252,211,77,.22)', width: 22 },
            { stroke: '#FCD34D', width: 8 },
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
      <div dir="ltr" className="mt-2.5 flex justify-between px-[2.5%] text-[13px] tracking-wide text-text-faint">
        {months.map((m) => (
          <span key={m}>{m}</span>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap gap-4 border-t border-black/[0.075] pt-[15px]">
        <span className="flex items-center gap-2 text-[14px] text-text-dim">
          <Swatch style={{ background: 'linear-gradient(90deg,#0F766E,#FCD34D)' }} />
          צריכה בפועל <b className="tabular font-semibold text-text">{summary.actualTotal}</b>
        </span>
        <span className="flex items-center gap-2 text-[14px] text-text-dim">
          <Swatch style={{ background: 'rgba(71,85,105,.85)' }} />
          ממוצע נגרר <b className="tabular font-semibold text-text">{summary.forecastTotal}</b>
        </span>
        <span className="flex items-center gap-2 text-[14px] text-text-dim">
          <Swatch style={{ background: '#15803D' }} />
          סטייה <b className="tabular font-semibold text-text">{summary.deviation}</b>
        </span>
      </div>
      </>
      )}
    </GlassCard>
  );
}
