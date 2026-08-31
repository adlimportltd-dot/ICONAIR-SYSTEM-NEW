import { useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';

/**
 * מאזין לשינויים בטבלאות ומפעיל callback.
 *
 * ה-callback נשמר ב-ref ולא נכנס לתלויות ה-effect: אחרת כל רינדור
 * היה יוצר פונקציה חדשה, מנתק את הערוץ ופותח אותו מחדש — ובפועל
 * המערכת הייתה פותחת WebSocket חדש כמה פעמים בשנייה.
 *
 * דורש שהטבלאות יתווספו לפרסום ה-Realtime (נעשה ב-02_rls.sql).
 * ה-RLS חל גם כאן: משתמש לא מחובר לא מקבל אירועים.
 */
export function useRealtime(tables, onChange, { enabled = true } = {}) {
  const handler = useRef(onChange);
  handler.current = onChange;

  const key = tables.join(',');

  useEffect(() => {
    if (!enabled || !supabase || !key) return undefined;

    const channel = supabase.channel(`icon-air:${key}`);

    key.split(',').forEach((table) => {
      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table },
        (payload) => handler.current?.(payload)
      );
    });

    channel.subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [key, enabled]);
}
