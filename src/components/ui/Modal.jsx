import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * חלון קופץ על משטח הזכוכית של המערכת.
 * Esc סוגר, לחיצה על הרקע סוגרת, והפוקוס עובר לשדה הראשון בפתיחה
 * כדי שאפשר יהיה למלא טופס בלי לגעת בעכבר.
 * בנייד החלון נצמד לתחתית המסך — קרוב לאגודל.
 *
 * 2026-09-14 (בקשה מפורשת, תקלה אמיתית בשטח): המודל היה מרונדר
 * *inline* בעץ הקומפוננטות (לא ב-portal) — position:fixed אמור
 * למקם יחסית ל-viewport, אבל כל אב עם transform/filter/will-change
 * (dnd-kit על שורת-עצירה נגררת, אנימציית .animate-rise על GlassCard
 * וכו') הופך את עצמו ל-containing-block עבור צאצא fixed, ומזיז את
 * המודל למקום הלא-נכון יחסית לאב הזה במקום ל-viewport האמיתי — בדיוק
 * מה שנראה כ"חלונות נערמים אחד על השני" בצילום שנשלח. createPortal
 * ל-document.body עוקף את זה לגמרי, בלי תלות באיזה אב ספציפי אשם.
 */
// ערימת החלונות הפתוחים. כשכרטיס לקוח פותח מעליו טופס "מכשיר חדש",
// Esc צריך לסגור רק את הטופס — בלי זה שני החלונות היו נסגרים יחד.
// אותה ערימה גם קובעת z-index: מודל מקונן (למשל "עדכון שמן" שנפתח
// מעל כרטיס לקוח שכבר פתוח) חייב לקבל z-index גבוה יותר מהאב שלו,
// לא להסתמך על סדר-DOM מקרי בין שני עצים נפרדים.
const openModals = [];

export default function Modal({ open, title, subtitle, onClose, children, footer }) {
  const panel = useRef(null);
  const [stackDepth, setStackDepth] = useState(0);

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

  // useLayoutEffect (לא useEffect) — רץ סינכרונית לפני שהדפדפן מצייר
  // פריים ראשון, כדי ש-stackDepth (וה-z-index שתלוי בו) יהיה נכון
  // מהצביעה הראשונה של מודל מקונן, בלי הבהוב-רגע ב-z-index ברירת המחדל.
  useLayoutEffect(() => {
    if (!open) return undefined;

    const token = {};
    openModals.push(token);
    setStackDepth(openModals.length);

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

  // 50 = בסיס (מעל תוכן הדף), +20 לכל רמת קינון — מודל שנפתח מעל מודל
  // אחר תמיד מעל, בלי קשר לסדר-DOM בין שני עצי-קומפוננטות נפרדים.
  const baseZ = 50 + Math.max(0, stackDepth - 1) * 20;

  return createPortal(
    <div
      className="fixed inset-0 flex items-end justify-center p-0 sm:items-center sm:p-6"
      style={{ zIndex: baseZ }}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <button
        type="button"
        aria-label="סגור"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-black/80 backdrop-blur-sm"
      />

      <div
        ref={panel}
        className="glass relative max-h-[92vh] w-full overflow-y-auto rounded-t-card
                   p-5 shadow-lift sm:max-w-[520px] sm:rounded-card"
        style={{ zIndex: baseZ + 1 }}
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
    </div>,
    document.body
  );
}
