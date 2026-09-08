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
let channelSeq = 0;

export function useRealtime(tables, onChange, { enabled = true, onStatusChange } = {}) {
  const handler = useRef(onChange);
  handler.current = onChange;

  const statusHandler = useRef(onStatusChange);
  statusHandler.current = onStatusChange;

  const key = tables.join(',');

  // מזהה ייחודי לכל *מופע* של ה-hook, לא רק לרשימת הטבלאות — אחרת
  // שני קומפוננטות שונות שמאזינות לאותה טבלה (למשל שתיהן ל-
  // route_assignments) היו מקבלות בטעות את אותו channel object מ-
  // supabase.channel() (הוא ממחזר לפי שם), וה-.on() השני היה קורס
  // עם "cannot add postgres_changes callbacks ... after subscribe()".
  const instanceId = useRef(null);
  if (instanceId.current === null) instanceId.current = ++channelSeq;

  useEffect(() => {
    if (!enabled || !supabase || !key) return undefined;

    const channel = supabase.channel(`icon-air:${key}:${instanceId.current}`);

    // איחוד פרצי אירועים: ייבוא/סנכרון של עשרות מכשירים, או טכנאי שמסמן
    // 12 מכשירים בזה אחר זה, שולחים עשרות אירועים בשנייה. בלי זה כל
    // אירוע הפעיל refetch נפרד — עשרות שאילתות מקבילות שהרגישו כמו
    // "תקיעה". עכשיו כל הפרץ מתקפל ל-refetch אחד, 250ms אחרי האירוע האחרון.
    let timer = null;
    let lastPayload = null;
    const fire = (payload) => {
      lastPayload = payload;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        handler.current?.(lastPayload);
      }, 250);
    };

    key.split(',').forEach((table) => {
      channel.on('postgres_changes', { event: '*', schema: 'public', table }, fire);
    });

    channel.subscribe((status) => statusHandler.current?.(status));

    return () => {
      if (timer) clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [key, enabled]);
}
