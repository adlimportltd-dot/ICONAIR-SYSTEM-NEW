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

  // onClose מגיע כמעט תמיד כ-arrow function מוטבע אצל הקורא
  // (onClose={() => setX(null)}), שמקבל זהות חדשה בכל רינדור של
  // ההורה — כולל רינדורים שלא קשורים בכלל לחלון הזה (למשל App.jsx
  // מרענן כל 5 שניות בשביל תור ה-offline, ורילטיים על devices/
  // service_calls/route_assignments יורד לכל מסך). כשה-effect הזה
  // היה תלוי ב-onClose, כל רינדור כזה גרם לו לרוץ מחדש: לנקות
  // ולהירשם שוב למאזין ה-Escape, ובעיקר — **לגנוב פוקוס בחזרה לשדה
  // הראשון של הטופס בכל פעם**, מה שגרם לחלון להרגיש כאילו הוא
  // "נסגר ומשהו קורה" גם כשה-open עצמו לא השתנה בכלל. הפתרון: onClose
  // נקרא דרך ref שתמיד מעודכן, וה-effect תלוי רק ב-open — רץ פעם
  // אחת בפתיחה ופעם אחת בסגירה, לא בכל רינדור-הורה מקרי.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return undefined;

    const token = {};
    openModals.push(token);

    const onKeyDown = (event) => {
      if (event.key === 'Escape' && openModals[openModals.length - 1] === token) onCloseRef.current();
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
  }, [open]);

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
        className="absolute inset-0 cursor-default bg-black/65 backdrop-blur-sm"
      />

      <div
        ref={panel}
        className="glass relative z-10 max-h-[92vh] w-full overflow-y-auto rounded-t-card
                   p-5 shadow-lift sm:max-w-[520px] sm:rounded-card"
      >
        <div className="mb-4 flex items-start gap-3">
          <div className="min-w-0">
            <h2 className="font-display text-[19px] font-bold leading-tight">{title}</h2>
            {subtitle && <p className="mt-1 text-[15px] text-text-faint">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="סגור"
            className="ms-auto grid h-9 w-9 flex-none place-items-center rounded-pill
                       border border-black/[0.075] text-text-dim transition-colors
                       hover:border-gold-500/35 hover:text-gold-600"
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
