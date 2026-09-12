import * as Sentry from '@sentry/react';
import { isNetworkError } from './offlineQueue';

/**
 * Sentry — 2026-09-12, בקשה מפורשת. VITE_SENTRY_DSN חייב להיות מוגדר
 * גם ב-.env.local (מקומי) וגם במשתני הסביבה של Vercel (production) —
 * אותו דפוס בדיוק כמו VITE_GOOGLE_MAPS_API_KEY: נחשף לצד הלקוח בכוונה
 * (כך תמיד עובד Sentry Browser SDK — ה-DSN הוא כתובת-קליטה, לא סוד;
 * מגבילים ב-Sentry עצמו לפי project/rate-limits, לא ע"י הסתרתו).
 *
 * בלי DSN מוגדר (למשל בסביבת פיתוח מקומית של מישהו שלא הגדיר את זה) —
 * initSentry() פשוט לא עושה כלום, לא זורק ולא מציג שגיאה. Sentry הוא
 * תוספת-ניטור, לא תלות קריטית שהאפליקציה צריכה כדי לעבוד.
 */
export function initSentry() {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn) {
    console.info('Sentry: VITE_SENTRY_DSN לא מוגדר — ניטור שגיאות כבוי.');
    return;
  }

  Sentry.init({
    dsn,
    environment: import.meta.env.MODE, // 'development' | 'production'
    integrations: [Sentry.browserTracingIntegration()],

    // דגימת ביצועים (traces) — לא 100%, כדי לא לצרוך את המכסה החינמית
    // מהר על אפליקציית ניהול-שטח פנימית קטנה (לא אתר-צרכנים בנפח גבוה).
    tracesSampleRate: import.meta.env.PROD ? 0.2 : 1.0,

    // מסנן רעש ידוע-ומטופל: הטכנאים עובדים בשטח עם רשת לא יציבה
    // בכוונה — יש כבר תור-אופליין שלם (offlineQueue.js/offlineSync.js)
    // שמטפל בזה כמצב תקין, לא תקלה. שגיאת "אין רשת" היא לא bug
    // שצריך לדווח עליו ל-Sentry ולבזבז עליה מכסה — היא בדיוק המצב
    // שהתכנון של האפליקציה כבר יודע להתמודד איתו.
    beforeSend(event, hint) {
      if (isNetworkError(hint?.originalException)) return null;
      return event;
    },
  });
}

/**
 * מקשר שגיאה שנתפסת ב-Sentry למשתמש המחובר בפועל (לא רק "שגיאה
 * אנונימית") — נקרא מ-AuthContext בכל שינוי session/profile.
 * user=null (בהתנתקות) מנקה את ההקשר, כדי שלא יישאר משתמש-קודם
 * מקושר לשגיאות של מי שהתחבר אחריו על אותו מכשיר.
 */
export function setSentryUser(user) {
  Sentry.setUser(user);
}

export { Sentry };
