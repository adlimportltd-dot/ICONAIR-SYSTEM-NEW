/**
 * טבלה שהופכת לכרטיסים בנייד.
 *
 * טבלה עם 7 עמודות על מסך 390px היא טבלה בלתי קריאה, וגלילה אופקית
 * בממשק RTL מבלבלת אפילו יותר. לכן מרוחב sm ומעלה זו רשת עמודות
 * אמיתית, ומתחתיו כל שורה נפרשת לכרטיס עם תווית לכל ערך.
 *
 * columns: [{ key, label, width, align, render(row), hideOnMobile }]
 */
export default function DataTable({ columns, rows, rowKey, onRowClick, actions }) {
  const template = columns.map((c) => c.width ?? 'minmax(0,1fr)').join(' ');

  return (
    <div className="flex flex-col gap-[9px]">
      {/* כותרות — רק בתצוגת הרשת */}
      <div
        className="hidden gap-3 px-3.5 pb-1 text-[11.5px] font-semibold tracking-wide text-text-faint sm:grid"
        style={{ gridTemplateColumns: actions ? `${template} auto` : template }}
      >
        {columns.map((column) => (
          <span key={column.key} className={column.align === 'start' ? 'text-start' : ''}>
            {column.label}
          </span>
        ))}
        {actions && <span />}
      </div>

      {rows.map((row) => {
        const key = rowKey(row);

        return (
          <div
            key={key}
            onClick={onRowClick ? () => onRowClick(row) : undefined}
            className={`inner-row px-3.5 py-3 transition-colors ${
              onRowClick ? 'cursor-pointer hover:border-white/[0.13] hover:bg-white/[0.05]' : ''
            }`}
          >
            {/* --- רשת: מרוחב sm ומעלה --- */}
            <div
              className="hidden items-center gap-3 text-[13.5px] sm:grid"
              style={{ gridTemplateColumns: actions ? `${template} auto` : template }}
            >
              {columns.map((column) => (
                <div key={column.key} className="min-w-0 truncate">
                  {column.render(row)}
                </div>
              ))}
              {actions && <div className="flex flex-none gap-2">{actions(row)}</div>}
            </div>

            {/* --- כרטיס: בנייד --- */}
            <div className="flex flex-col gap-2 sm:hidden">
              {columns.map((column, index) => (
                <div
                  key={column.key}
                  className={index === 0
                    ? 'text-[14px] font-semibold'
                    : 'flex items-baseline justify-between gap-3 text-[12.5px]'}
                >
                  {index === 0 ? (
                    column.render(row)
                  ) : (
                    <>
                      <span className="flex-none text-text-faint">{column.label}</span>
                      <span className="min-w-0 truncate text-end">{column.render(row)}</span>
                    </>
                  )}
                </div>
              ))}
              {actions && <div className="mt-1 flex flex-wrap gap-2">{actions(row)}</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** שבב סטטוס אחיד לכל הטבלאות */
export function StatusChip({ tone = 'neutral', children }) {
  const tones = {
    neutral: '',
    ok: 'text-ok border-ok/25 bg-ok/10',
    warn: 'text-warn border-warn/30 bg-warn/[0.09]',
    crit: 'text-crit-soft border-crit/30 bg-crit/10',
    gold: 'text-gold-300 border-gold-500/30 bg-gold-500/[0.14]',
    teal: 'text-teal-500 border-teal-500/25 bg-teal-500/10',
    slate: 'text-slate-300 border-slate-500/30 bg-slate-500/10',
  };

  return <span className={`chip ${tones[tone] ?? ''}`}>{children}</span>;
}

/** מד אופקי קטן לתוך תא טבלה */
export function MiniMeter({ value, tone = 'teal' }) {
  const fills = {
    teal: 'linear-gradient(90deg,#4CC9C0,#8FE3DC)',
    gold: 'linear-gradient(90deg,#C5A059,#D4AF37)',
    slate: 'linear-gradient(90deg,#6E86A8,#A3B6CE)',
    warn: 'linear-gradient(90deg,#F0A43A,#F5C078)',
    crit: 'linear-gradient(90deg,#F0555C,#F0A43A)',
  };

  return (
    <div className="flex items-center gap-2">
      <div className="meter !mt-0 w-full max-w-[86px] flex-1">
        <span style={{ width: `${Math.max(value, 2)}%`, background: fills[tone] }} />
      </div>
      <span className="tabular flex-none font-mono text-[11.5px] text-text-dim">{value}%</span>
    </div>
  );
}

export function oilTone(level) {
  if (level <= 12) return 'crit';
  if (level <= 25) return 'warn';
  if (level <= 60) return 'slate';
  return 'teal';
}
