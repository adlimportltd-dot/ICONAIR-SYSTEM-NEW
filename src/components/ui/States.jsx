/**
 * מצבי טעינה, שגיאה וריק.
 * שלושתם נראים כמו הכרטיס שהם מחליפים, כדי שהמסך לא "יקפוץ"
 * ברגע שהנתונים מגיעים.
 */

export function Skeleton({ className = '' }) {
  return (
    <div
      className={`animate-pulse rounded-lg bg-white/[0.055] ${className}`}
      style={{ animationDuration: '1.6s' }}
    />
  );
}

export function LoadingRows({ rows = 4, height = 'h-[54px]' }) {
  return (
    <div className="flex flex-col gap-[9px]" role="status" aria-label="טוען נתונים">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className={`${height} w-full`} />
      ))}
    </div>
  );
}

export function ErrorState({ message, onRetry }) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-row border border-crit/25 bg-crit/[0.07] p-4">
      <div>
        <div className="text-[13.5px] font-semibold text-crit-soft">לא הצלחתי לטעון את הנתונים</div>
        <p className="mt-1 max-w-prose text-[12.5px] leading-relaxed text-text-dim">{message}</p>
      </div>
      {onRetry && (
        <button type="button" onClick={onRetry} className="ghost-btn">
          נסה שוב
        </button>
      )}
    </div>
  );
}

export function EmptyState({ title, hint, action }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-row border border-dashed border-white/[0.1] px-4 py-8 text-center">
      <div className="text-[13.5px] font-semibold text-text-dim">{title}</div>
      {hint && <p className="max-w-xs text-[12.5px] leading-relaxed text-text-faint">{hint}</p>}
      {action}
    </div>
  );
}

/**
 * עוטף כרטיס: מחליף את התוכן במצב טעינה/שגיאה/ריק, ומציג אותו רק
 * כשבאמת יש מה להציג.
 */
export function Async({ loading, error, onRetry, isEmpty, empty, skeleton, children }) {
  if (loading) return skeleton ?? <LoadingRows />;
  if (error) return <ErrorState message={error} onRetry={onRetry} />;
  if (isEmpty) return empty ?? <EmptyState title="אין עדיין נתונים" />;
  return children;
}
