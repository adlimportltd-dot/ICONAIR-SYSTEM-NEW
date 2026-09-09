import { useCallback, useEffect, useRef, useState } from 'react';
import { describeError } from '../lib/supabase';

/**
 * טעינת נתונים עם מצבי loading / error / refetch.
 *
 * שלושה דברים שחשוב שיהיו נכונים כאן:
 *  1. תוצאה של בקשה ישנה לא דורסת תוצאה חדשה (מרוץ בין שתי שליפות
 *     כשמקלידים בחיפוש) — לכן requestId.
 *  2. אין setState אחרי unmount — לכן mounted.
 *  3. **`loading` דולק רק עד השליפה המוצלחת/הכושלת הראשונה, לא בכל
 *     refetch** (2026-09-09, בעקבות באג קריטי: "המסך קופץ לראש העמוד
 *     אחרי כל פעולה"). כל `refetch()` — כולל זה שרץ אוטומטית אחרי
 *     שמירה/מחיקה (`refreshAll`), וזה שה-`useRealtime` מפעיל ברקע —
 *     קודם היה מדליק `loading=true` בלי תנאי, מה שגרם ל-`Async` (ר'
 *     `States.jsx`) להחליף לרגע את כל התוכן הקיים (למשל 37 כרטיסי-כתובת
 *     אצל אוורסט) בשלד-טעינה קטן בן כמה שורות. קריסת הגובה הזו גרמה
 *     לדפדפן "לקצץ" את מיקום הגלילה חזרה לראש העמוד — ואז כשהנתונים
 *     חזרו, המיקום הישן כבר לא שוחזר. הפתרון: כל עוד יש כבר `data` מוצלח
 *     מהעבר, `refetch` משאיר את ה-DOM הקיים על כנו (`loading` נשאר
 *     `false`) ופשוט מחליף את הערכים בתוכו כשהתשובה החדשה מגיעה — אין
 *     קריסה, אין קפיצה, אין איפוס מיקום/פוקוס. שגיאה ברענון ברקע גם
 *     שומרת את ה-`data` הישן (לא מוחקת מסך שהצליח פעם).
 *
 * @param fn   פונקציה אסינכרונית שמחזירה נתונים
 * @param deps תלויות; שינוי בהן מפעיל שליפה מחדש
 */
export function useQuery(fn, deps = [], { enabled = true } = {}) {
  const [state, setState] = useState({ data: null, loading: enabled, error: null });

  const fnRef = useRef(fn);
  fnRef.current = fn;

  const requestId = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(async () => {
    if (!enabled) {
      setState({ data: null, loading: false, error: null });
      return;
    }

    const id = ++requestId.current;
    // loading=true רק אם עוד אין data מהעבר — refetch על מסך שכבר נטען
    // בהצלחה משאיר את התוכן הקיים על המסך במקום להחליפו בשלד-טעינה.
    setState((prev) => ({ ...prev, loading: prev.data === null, error: null }));

    try {
      const data = await fnRef.current();
      if (mounted.current && id === requestId.current) {
        setState({ data, loading: false, error: null });
      }
    } catch (error) {
      if (mounted.current && id === requestId.current) {
        setState((prev) => ({ ...prev, loading: false, error: describeError(error) }));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ...deps]);

  useEffect(() => {
    run();
  }, [run]);

  return { ...state, refetch: run };
}
