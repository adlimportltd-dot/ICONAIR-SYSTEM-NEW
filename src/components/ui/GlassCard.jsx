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
 * מיכל האייקון של `CardHead` צובע לפי "תחום" הכרטיס — לא תמיד זהב.
 * 2026-09-09 (בעקבות משוב "המערכת מרגישה כמו טבלה אפורה ויבשה"): גיוון
 * צבעוני הגיוני בין מסכים (שמן=טורקיז, קריאות/התראות=אדום, מסלולים=ירוק,
 * דוחות/הגדרות=אפור-כחול ניטרלי) במקום שכל אייקון בכל כרטיס יהיה זהב
 * אחיד. ר' "טוקן טון-כרטיס" ב-CLAUDE.md — רק חמשת הטונים האלה, אין
 * צבעים חדשים.
 */
const CARD_TONE = {
  gold: 'border-[#E2E8F0] bg-ink-800 text-gold-600',
  teal: 'border-teal-500/25 bg-teal-500/[0.1] text-teal-500',
  ok: 'border-ok/25 bg-ok/[0.1] text-ok',
  crit: 'border-crit/25 bg-crit/[0.1] text-crit',
  slate: 'border-slate-500/25 bg-slate-500/[0.1] text-slate-500',
};

/**
 * כותרת כרטיס: אייקון מואר קטן (אופציונלי, עם `tone`) + שם + תת-שורה +
 * פעולה משנית בקצה.
 */
export function CardHead({ icon: Icon, tone = 'gold', title, subtitle, action, onAction }) {
  return (
    <div className="mb-5 flex items-start gap-3.5">
      {Icon && (
        <div className={`grid h-11 w-11 flex-none place-items-center rounded-xl border
                        shadow-icon-glow ${CARD_TONE[tone] ?? CARD_TONE.gold}`}>
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
