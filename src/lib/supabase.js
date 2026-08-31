import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

/**
 * האם המפתחות הוגדרו.
 * לא זורקים שגיאה כאן במכוון: throw בזמן import מפיל את כל האפליקציה
 * למסך לבן בלי הסבר. במקום זה App מציג מסך הגדרה עם ההוראות.
 */
export const isSupabaseConfigured = Boolean(url && anonKey);

export const supabase = isSupabaseConfigured
  ? createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;

/**
 * הודעות השגיאה של Supabase מגיעות באנגלית ולפעמים לא מובנות לטכנאי בשטח.
 * כאן מתרגמים את המקרים השכיחים למשהו שאפשר לפעול לפיו.
 */
export function describeError(error) {
  if (!error) return null;

  const message = String(error.message || error);

  if (/Invalid login credentials/i.test(message)) {
    return 'אימייל או סיסמה שגויים.';
  }
  if (/Email not confirmed/i.test(message)) {
    return 'האימייל עוד לא אומת. בדוק את תיבת הדואר, או כבה אימות אימייל בהגדרות Supabase.';
  }
  if (/User already registered/i.test(message)) {
    return 'המשתמש כבר קיים. נסה להתחבר במקום להירשם.';
  }
  if (/Failed to fetch|NetworkError/i.test(message)) {
    return 'אין חיבור לשרת. בדוק את הרשת ואת כתובת ה-VITE_SUPABASE_URL.';
  }
  if (/JWT|not authenticated|permission denied|row-level security/i.test(message)) {
    return 'אין הרשאה לפעולה הזו. ייתכן שההתחברות פגה — התחבר מחדש.';
  }
  if (/duplicate key/i.test(message)) {
    return 'הערך הזה כבר קיים במערכת.';
  }
  if (/violates foreign key/i.test(message)) {
    return 'לא ניתן למחוק — יש רשומות שתלויות בשורה הזו.';
  }

  return message;
}
