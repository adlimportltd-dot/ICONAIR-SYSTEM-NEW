import { useEffect, useRef } from 'react';

/**
 * חלון קופץ על משטח הזכוכית של המערכת.
 * Esc סוגר, לחיצה על הרקע סוגרת, והפוקוס עובר לשדה הראשון בפתיחה
 * כדי שאפשר יהיה למלא טופס בלי לגעת בעכבר.
 * בנייד החלון נצמד לתחתית המסך — קרוב לאגודל.
 */
// ערימת החלונות הפתוחים. כשכרטיס לקוח פותח מעליו טופס "מכשיר חדש",
// Esc צריך לסגור רק את הטופס — בלי זה שני החלונות היו נסגרים יחד.
const openModals = [];

export default function Modal({ open, title, subtitle, onClose, children, footer }) {
  const panel = useRef(null);

  useEffect(() => {
    if (!open) return undefined;

    const token = {};
    openModals.push(token);

    const onKeyDown = (event) => {
      if (event.key === 'Escape' && openModals[openModals.length - 1] === token) onClose();
    };

    document.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const firstField = panel.current?.querySelector('input, select, textarea');
    firstField?.focus();

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;

      const index = openModals.indexOf(token);
      if (index !== -1) openModals.splice(index, 1);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <button
        type="button"
        aria-label="סגור"
        onClick={onClose}
        className="absolute inset-0 cursor-default backdrop-blur-sm"
        style={{ background: 'rgba(20,16,8,.5)' }}
      />

      <div
        ref={panel}
        className="glass relative z-10 max-h-[92vh] w-full overflow-y-auto rounded-t-card
                   border-white/[0.09] p-5 shadow-lift sm:max-w-[520px] sm:rounded-card"
      >
        <div className="mb-4 flex items-start gap-3">
          <div className="min-w-0">
            <h2 className="font-display text-[19px] font-bold leading-tight">{title}</h2>
            {subtitle && <p className="mt-1 text-[12.5px] text-text-faint">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="סגור"
            className="ms-auto grid h-9 w-9 flex-none place-items-center rounded-pill
                       border border-white/[0.075] text-text-dim transition-colors
                       hover:border-gold-500/35 hover:text-gold-300"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"
                 strokeLinecap="round" className="h-4 w-4">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        {children}

        {footer && <div className="mt-5 flex flex-wrap gap-2.5">{footer}</div>}
      </div>
    </div>
  );
}
