import { listQueue, removeFromQueue, markQueueItemError, isNetworkError } from './offlineQueue';
import { OFFLINE_EXECUTORS } from './queries';

/**
 * מריץ את התור בסדר שבו הפעולות נוצרו (FIFO) — חשוב במיוחד לאותו
 * מכשיר: שתי פעולות "סיום ביקור" על אותו device_id חייבות להסתנכרן
 * באותו סדר שבוצעו בשטח, אחרת מפלס השמן הסופי במכשיר יהיה שגוי.
 *
 * שגיאת רשת (עדיין בלי קליטה בפועל, למרות ש-online התחיל) → עוצרים
 * את כל הריצה מיד, לא רק מדלגים על הפריט — כדי לא לשבש את הסדר של מה
 * שנשאר. שגיאה אמיתית מהשרת (למשל חריגת קיבולת שגילינו רק עכשיו,
 * בזמן הסנכרון) → מסמנים כ"נכשל" וממשיכים לפריט הבא, כדי שפריט אחד
 * בעייתי לא יתקע לצמיתות את כל מה שאחריו.
 */
export async function syncQueue({ onProgress } = {}) {
  const queue = await listQueue();
  const pending = queue.filter((item) => item.status === 'pending');

  let synced = 0;
  let failed = 0;

  for (const item of pending) {
    const executor = OFFLINE_EXECUTORS[item.type];
    if (!executor) {
      await markQueueItemError(item.id, `סוג פעולה לא מוכר: ${item.type}`);
      failed += 1;
      continue;
    }

    try {
      await executor(item.payload);
      await removeFromQueue(item.id);
      synced += 1;
      onProgress?.({ synced, failed, total: pending.length });
    } catch (error) {
      if (isNetworkError(error)) {
        // עדיין בלי רשת אמיתית — עוצרים כאן, ננסה שוב בפעם הבאה
        break;
      }
      await markQueueItemError(item.id, String(error?.message ?? error));
      failed += 1;
      onProgress?.({ synced, failed, total: pending.length });
    }
  }

  return { synced, failed };
}

/**
 * מפעיל סנכרון אוטומטי: מיד עם החזרת הרשת (אירוע online), ובנוסף
 * בדיקה כל 20 שניות כל עוד יש פריטים ממתינים — כי אירוע online לא
 * תמיד אומר שיש אינטרנט אמיתי-החוצה (רק שכרטיס הרשת קם), אז ניסיון
 * חוזר קצר טווח תופס גם את המקרים ש-online "שיקר".
 */
export function startAutoSync({ onSynced } = {}) {
  let interval = null;
  let cancelled = false;

  async function runIfNeeded() {
    if (cancelled) return;
    const queue = await listQueue();
    const hasPending = queue.some((item) => item.status === 'pending');
    if (!hasPending) {
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
      return;
    }
    if (!interval) {
      interval = setInterval(runIfNeeded, 20000);
    }
    const result = await syncQueue();
    if (result.synced > 0) onSynced?.(result);
  }

  window.addEventListener('online', runIfNeeded);
  runIfNeeded();

  return () => {
    cancelled = true;
    window.removeEventListener('online', runIfNeeded);
    if (interval) clearInterval(interval);
  };
}
