/**
 * GlassCard — משטח הזכוכית הבסיסי של המערכת.
 * delay מייצר את הופעת ההרמה המדורגת של הדשבורד בטעינה.
 * ריווח נדיב (p-6/7) בכוונה — כרטיס דחוס נראה זול, לא פרימיום.
 */
export default function GlassCard({ children, className = '', delay = 0, as: Tag = 'article' }) {
  return (
    <Tag
      className={`glass-card animate-rise p-6 sm:p-8 ${className}`}
      style={delay ? { animationDelay: `${delay}s` } : undefined}
    >
      {children}
    </Tag>
  );
}

/**
 * כותרת כרטיס: אייקון מואר קטן (אופציונלי) + שם + תת-שורה + פעולה משנית בקצה.
 * ה-icon container הוא אותו דפוס בכל כרטיס במערכת — זהות ויזואלית אחידה,
 * לא רק בכרטיסי KPI.
 */
export function CardHead({ icon: Icon, title, subtitle, action, onAction }) {
  return (
    <div className="mb-5 flex items-start gap-3.5">
      {Icon && (
        <div className="grid h-11 w-11 flex-none place-items-center rounded-xl border
                        border-[#E2E8F0] bg-ink-800 text-gold-600 shadow-icon-glow">
          <Icon className="h-5 w-5" />
        </div>
      )}
      <div className="min-w-0">
        <h2 className="font-display text-[19px] font-extrabold leading-tight text-text">{title}</h2>
        {subtitle && <div className="mt-1 text-[14px] font-medium text-text-faint">{subtitle}</div>}
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
