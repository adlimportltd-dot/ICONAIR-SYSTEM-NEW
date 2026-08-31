import { useCallback, useEffect, useRef, useState } from 'react';
import { describeError } from '../lib/supabase';

/**
 * טעינת נתונים עם מצבי loading / error / refetch.
 *
 * שני דברים שחשוב שיהיו נכונים כאן:
 *  1. תוצאה של בקשה ישנה לא דורסת תוצאה חדשה (מרוץ בין שתי שליפות
 *     כשמקלידים בחיפוש) — לכן requestId.
 *  2. אין setState אחרי unmount — לכן mounted.
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
    setState((prev) => ({ ...prev, loading: true, error: null }));

    try {
      const data = await fnRef.current();
      if (mounted.current && id === requestId.current) {
        setState({ data, loading: false, error: null });
      }
    } catch (error) {
      if (mounted.current && id === requestId.current) {
        setState({ data: null, loading: false, error: describeError(error) });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ...deps]);

  useEffect(() => {
    run();
  }, [run]);

  return { ...state, refetch: run };
}
