/**
 * GlassCard — משטח הזכוכית הבסיסי של המערכת.
 * delay מייצר את הופעת ההרמה המדורגת של הדשבורד בטעינה.
 */
export default function GlassCard({ children, className = '', delay = 0, as: Tag = 'article' }) {
  return (
    <Tag
      className={`glass-card animate-rise p-5 ${className}`}
      style={delay ? { animationDelay: `${delay}s` } : undefined}
    >
      {children}
    </Tag>
  );
}

/** כותרת כרטיס: שם, תת-שורה ופעולה משנית בקצה */
export function CardHead({ title, subtitle, action, onAction }) {
  return (
    <div className="mb-[18px] flex items-start gap-3">
      <div className="min-w-0">
        <h2 className="font-display text-[16.5px] font-bold leading-tight">{title}</h2>
        {subtitle && <div className="mt-1 text-xs text-text-faint">{subtitle}</div>}
      </div>
      {action && (
        <button type="button" onClick={onAction} className="ghost-btn ms-auto">
          {action}
        </button>
      )}
    </div>
  );
}

/** ריבוע צבע קטן ללגנדות ולרשימות */
export function Swatch({ style, className = '' }) {
  return <i className={`block h-2.5 w-2.5 flex-none rounded-[3px] ${className}`} style={style} />;
}
