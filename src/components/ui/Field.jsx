import { ChevronDownIcon } from './Icons';

// 2026-09-09 (Full Design Overhaul): שדות בגובה ≥46px וטקסט 15px — נוחים
// לאצבע בנייד, בלי להתאמץ לקרוא. גבול slate-200, רקע slate-100 שקוע.
const controlClass =
  'w-full rounded-pill border border-[#E2E8F0] bg-ink-800 px-4 py-3 text-[15px] ' +
  'text-text font-medium placeholder:text-text-faint placeholder:font-normal transition-colors ' +
  'focus:border-gold-500/60 focus:bg-white focus:outline-none';

export function Field({ label, hint, error, children, required }) {
  return (
    <label className="flex flex-col gap-2">
      <span className="text-[15px] font-bold text-text-dim">
        {label}
        {required && <span className="ms-1 text-gold-600">*</span>}
      </span>
      {children}
      {error
        ? <span className="text-[14px] text-crit-soft">{error}</span>
        : hint && <span className="text-[14px] leading-relaxed text-text-faint">{hint}</span>}
    </label>
  );
}

export function TextInput({ className = '', ...props }) {
  return <input className={`${controlClass} ${className}`} {...props} />;
}

export function TextArea({ className = '', rows = 3, ...props }) {
  return <textarea rows={rows} className={`${controlClass} resize-y ${className}`} {...props} />;
}

/**
 * ה-<select> הסגור כבר עוצב כמו שאר השדות — appearance-none מסיר רק
 * את החץ המובנה. הרשימה הפתוחה (תפריט ה-options) היא רכיב UI של
 * מערכת ההפעלה, לא של הדף — CSS לא יכול לצייר אותה מחדש בעקביות בין
 * דפדפנים. color-scheme: light ב-index.css, יחד עם select option
 * הכתוב שם, אומרים לדפדפן לצייר את הרשימה בגוונים התואמים למותג.
 */
export function Select({ className = '', options = [], placeholder, ...props }) {
  return (
    <div className="relative">
      <select
        className={`${controlClass} appearance-none pe-9 ${className}`}
        {...props}
      >
        {placeholder && <option value="">{placeholder}</option>}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDownIcon
        aria-hidden
        className="pointer-events-none absolute end-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint"
      />
    </div>
  );
}

/**
 * כפתור ראשי — ענבר עשיר מלא (bg-amber-500, hover:bg-amber-600), טקסט
 * slate-950 עבה (font-extrabold). משמש לפעולה אחת בכל מסך, לא יותר.
 * 2026-09-09 Full Design Overhaul #2: הוחלף מגרדיאנט זהב סטטי לכפתור
 * ענבר מלא עם הובר אמיתי, בדיוק לפי בקשת המשתמש.
 */
export function PrimaryButton({ className = '', loading, children, ...props }) {
  return (
    <button
      type="button"
      disabled={loading || props.disabled}
      className={`inline-flex items-center justify-center gap-2 rounded-pill bg-gold-500 px-5 py-3
                  text-[15px] font-extrabold text-slate-950 shadow-lift transition-colors hover:bg-amber-600
                  disabled:cursor-not-allowed disabled:opacity-55 ${className}`}
      {...props}
    >
      {loading ? 'שומר…' : children}
    </button>
  );
}

export function SecondaryButton({ className = '', children, ...props }) {
  return (
    <button type="button" className={`ghost-btn px-4 py-3 text-[15px] ${className}`} {...props}>
      {children}
    </button>
  );
}
