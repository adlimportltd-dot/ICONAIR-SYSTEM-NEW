import { ChevronDownIcon } from './Icons';

const controlClass =
  'w-full rounded-pill border border-white/[0.09] bg-black/30 px-3.5 py-2.5 text-[14px] ' +
  'text-text placeholder:text-text-faint transition-colors ' +
  'focus:border-gold-500/45 focus:outline-none';

export function Field({ label, hint, error, children, required }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[12.5px] font-medium text-text-dim">
        {label}
        {required && <span className="ms-1 text-gold-500">*</span>}
      </span>
      {children}
      {error
        ? <span className="text-[11.5px] text-crit-soft">{error}</span>
        : hint && <span className="text-[11.5px] text-text-faint">{hint}</span>}
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
 * ה-<select> הסגור כבר עוצב כהה כמו שאר השדות — appearance-none מסיר
 * רק את החץ ואת הרקע הבהיר שדפדפנים מציירים סביבו. הרשימה הפתוחה
 * (תפריט ה-options) היא רכיב UI של מערכת ההפעלה, לא של הדף — CSS לא
 * יכול לצייר אותה מחדש בעקביות בין דפדפנים. color-scheme: dark
 * ב-index.css אומר לדפדפן לצייר את הרשימה בגרסה הכהה שלו במקום
 * בברירת המחדל הבהירה — זה מה שמחליף את "האפור של פעם".
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

/** כפתור ראשי — זהב מלא. משמש לפעולה אחת בכל מסך, לא יותר. */
export function PrimaryButton({ className = '', loading, children, ...props }) {
  return (
    <button
      type="button"
      disabled={loading || props.disabled}
      className={`rounded-pill px-4 py-2.5 text-[13.5px] font-semibold text-[#221B0C]
                  transition-opacity disabled:cursor-not-allowed disabled:opacity-55 ${className}`}
      style={{ background: 'linear-gradient(150deg, #D4AF37, #C5A059)' }}
      {...props}
    >
      {loading ? 'שומר…' : children}
    </button>
  );
}

export function SecondaryButton({ className = '', children, ...props }) {
  return (
    <button type="button" className={`ghost-btn px-4 py-2.5 text-[13.5px] ${className}`} {...props}>
      {children}
    </button>
  );
}
