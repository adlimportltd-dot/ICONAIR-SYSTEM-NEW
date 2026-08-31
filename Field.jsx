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

export function Select({ className = '', options = [], placeholder, ...props }) {
  return (
    <select className={`${controlClass} ${className}`} {...props}>
      {placeholder && <option value="">{placeholder}</option>}
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
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
      style={{ background: 'linear-gradient(150deg, #F0DCB4, #D8B36A)' }}
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
