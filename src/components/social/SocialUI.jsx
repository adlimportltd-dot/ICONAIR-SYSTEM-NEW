import { useId, useMemo } from 'react';

/**
 * רכיבי תצוגה משותפים לטאב הסושיאל. צבעים רק מהטבלה ב-CLAUDE.md:
 * זהב #F59E0B/#B45309, טורקיז #0F766E, slate #475569, רשת rgba(44,42,41,.08).
 */

export const CHART = { gold: '#F59E0B', goldDeep: '#B45309', teal: '#0F766E', slate: '#475569', grid: 'rgba(44,42,41,.08)' };

/* עקומה חלקה שעוברת בדיוק בכל נקודה (Catmull-Rom → Bezier), כמו OilConsumptionChart */
function smoothPath(points) {
  if (points.length < 2) return '';
  let d = `M${points[0][0].toFixed(1)} ${points[0][1].toFixed(1)}`;
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[i === 0 ? 0 : i - 1];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    // תקרה לנקודות-הבקרה: עקומה חלקה לא "צוללת" מתחת לקו האפס בנתונים חדים.
    const lo = Math.max(p1[1], p2[1]);
    d += ` C${c1x.toFixed(1)} ${Math.min(c1y, lo).toFixed(1)}, ${c2x.toFixed(1)} ${Math.min(c2y, lo).toFixed(1)}, ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return d;
}

/**
 * גרף מגמה: עד שתי סדרות (primary = שטח זהב, secondary = קו טורקיז בציר משלו).
 * labels — תוויות ציר X (מוצגות דלילות).
 */
export function TrendChart({ labels = [], primary = [], secondary, primaryLabel, secondaryLabel, height = 190, format = (v) => v }) {
  const gid = useId().replace(/:/g, '');
  const W = 640;
  const H = height;
  const PAD = 14;
  const BASE = H - 6;

  const geo = useMemo(() => {
    const n = primary.length;
    if (n < 2) return null;
    // ציר זמן RTL (החדש משמאל), כמו גרף השמן בדשבורד.
    const x = (i) => W - PAD - (i * (W - PAD * 2)) / (n - 1);
    const max1 = Math.max(1, ...primary);
    const y1 = (v) => BASE - (v / max1) * (BASE - 18);
    const line1 = smoothPath(primary.map((v, i) => [x(i), y1(v)]));
    let line2 = null;
    if (secondary?.length === n) {
      const max2 = Math.max(1, ...secondary);
      line2 = smoothPath(secondary.map((v, i) => [x(i), BASE - (v / max2) * (BASE - 18)]));
    }
    const step = Math.max(1, Math.ceil(n / 6));
    const ticks = labels.map((l, i) => ({ l, x: x(i), show: i % step === 0 || i === n - 1 })).filter((t) => t.show);
    return { line1, area: `${line1} L${x(n - 1)} ${BASE} L${x(0)} ${BASE} Z`, line2, ticks, max1 };
  }, [labels, primary, secondary, BASE]);

  if (!geo) {
    return <div className="grid h-[150px] place-items-center rounded-row bg-ink-800 text-[14px] text-text-faint">עוד אין מספיק נתונים לגרף</div>;
  }

  return (
    <div>
      <div className="tabular mb-1 text-[12.5px] font-semibold text-text-faint">שיא: {format(geo.max1)}</div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={primaryLabel} style={{ direction: 'ltr' }}>
        <defs>
          <linearGradient id={`g${gid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={CHART.gold} stopOpacity=".34" />
            <stop offset="1" stopColor={CHART.gold} stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <line key={f} x1={PAD} x2={W - PAD} y1={BASE - f * (BASE - 18)} y2={BASE - f * (BASE - 18)} stroke={CHART.grid} />
        ))}
        <path d={geo.area} fill={`url(#g${gid})`} />
        <path d={geo.line1} fill="none" stroke={CHART.gold} strokeWidth="2.4" strokeLinecap="round" />
        {geo.line2 && <path d={geo.line2} fill="none" stroke={CHART.teal} strokeWidth="2" strokeDasharray="5 5" strokeLinecap="round" />}
      </svg>
      <div className="relative h-5 text-[12.5px] text-text-faint">
        {geo.ticks.map((t) => (
          <span key={`${t.l}${t.x}`} className="tabular absolute top-0 -translate-x-1/2 whitespace-nowrap" style={{ left: `${(t.x / W) * 100}%` }}>{t.l}</span>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-4 text-[13.5px] text-text-dim">
        {primaryLabel && <span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-[3px] bg-gold-500" />{primaryLabel}</span>}
        {secondaryLabel && <span className="inline-flex items-center gap-1.5"><i className="h-0.5 w-3 bg-teal-500" />{secondaryLabel}</span>}
      </div>
    </div>
  );
}

/** מד אופקי קטן (חלק יחסי) */
export function Bar({ value, max, tone = 'gold' }) {
  const pct = max > 0 ? Math.max(3, Math.round((value / max) * 100)) : 0;
  const fill = tone === 'teal' ? 'bg-teal-500' : tone === 'slate' ? 'bg-slate-500' : 'bg-gold-500';
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-ink-700">
      <div className={`h-full rounded-full ${fill}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

/** אריח מספר-על */
export function Stat({ label, value, hint, tone }) {
  const color = tone === 'crit' ? 'text-crit' : tone === 'ok' ? 'text-ok' : tone === 'gold' ? 'text-gold-600' : 'text-text';
  return (
    <div className="glass-card p-5 sm:p-6">
      <div className="text-[12.5px] font-semibold uppercase tracking-[1.1px] text-text-faint">{label}</div>
      <div className={`tabular mt-2.5 font-display text-[34px] font-bold leading-none tracking-[-0.5px] sm:text-[38px] ${color}`}>{value}</div>
      {hint && <div className="mt-2 text-[13.5px] text-text-faint">{hint}</div>}
    </div>
  );
}

/** תת-ניווט (טאבים פנימיים) — גלילה אופקית בנייד במקום שבירת שורה */
export function SubTabs({ tabs, active, onChange }) {
  return (
    <div className="glass mb-5 flex gap-1.5 overflow-x-auto rounded-panel p-1.5" role="tablist">
      {tabs.map((t) => {
        const on = t.id === active;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(t.id)}
            className={`relative flex flex-none items-center gap-2 whitespace-nowrap rounded-pill px-4 py-2.5 text-[15px] font-bold transition-colors ${
              on ? 'bg-gold-500 text-slate-950 shadow-lift' : 'text-text-dim hover:bg-ink-800 hover:text-text'
            }`}
          >
            {t.icon && <t.icon className="h-4 w-4" />}
            {t.label}
            {t.badge > 0 && (
              <span className={`tabular rounded-full px-1.5 py-0.5 text-[11px] font-bold leading-none ${on ? 'bg-slate-950 text-white' : 'bg-crit text-white'}`}>
                {t.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** בורר קטן בסגנון "גלולות" */
export function Pills({ options, value, onChange, size = 'md' }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`rounded-pill border font-semibold transition-colors ${size === 'sm' ? 'px-3 py-1.5 text-[13.5px]' : 'px-4 py-2.5 text-[15px]'} ${
            value === o.value ? 'border-gold-300/[0.5] bg-gold-500/[0.14] text-gold-600' : 'border-black/[0.09] text-text-dim hover:border-gold-500/35'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** הודעה קטנה צפה (טוסט) */
export function Toast({ message, tone = 'ok' }) {
  if (!message) return null;
  return (
    <div role="status" className="glass fixed inset-x-0 top-4 z-[70] mx-auto flex w-fit max-w-[92vw] items-center gap-2.5 rounded-pill px-4 py-2.5 text-[14px] font-medium shadow-lift animate-rise">
      <span className={`h-2 w-2 flex-none rounded-full ${tone === 'crit' ? 'bg-crit' : tone === 'gold' ? 'bg-gold-500' : 'bg-ok'}`} />
      {message}
    </div>
  );
}
