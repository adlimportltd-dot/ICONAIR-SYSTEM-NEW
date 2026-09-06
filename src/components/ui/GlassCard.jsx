/**
 * GlassCard — משטח הזכוכית הבסיסי של המערכת.
 * delay מייצר את הופעת ההרמה המדורגת של הדשבורד בטעינה.
 * ריווח נדיב (p-6/7) בכוונה — כרטיס דחוס נראה זול, לא פרימיום.
 */
export default function GlassCard({ children, className = '', delay = 0, as: Tag = 'article' }) {
  return (
    <Tag
      className={`glass-card animate-rise p-6 sm:p-7 ${className}`}
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
    <div className="mb-5 flex items-start gap-3">
      {Icon && (
        <div className="grid h-9 w-9 flex-none place-items-center rounded-xl border
                        border-gold-300/[0.16] bg-gold-500/[0.07] text-gold-300 shadow-icon-glow">
          <Icon className="h-[17px] w-[17px]" />
        </div>
      )}
      <div className="min-w-0">
        <h2 className="font-display text-[16.5px] font-bold leading-tight">{title}</h2>
        {subtitle && <div className="mt-1 text-[13px] text-text-faint">{subtitle}</div>}
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
