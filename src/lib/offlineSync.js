import { listQueue, removeFromQueue, markQueueItemError, isNetworkError } from './offlineQueue';
import { OFFLINE_EXECUTORS } from './queries';
import { supabase } from './supabase';

/**
 * phase73 — הגנה מכפילויות (נמצאו 70 רישומי מילוי כפולים, רובם אצל אוורסט):
 * 1. רק סנכרון אחד רץ בכל רגע — גם בתוך הלשונית (inFlight) וגם בין לשוניות
 *    (Web Locks). קודם האירוע online, הבדיקה כל 20 שניות והריצה הראשונה יכלו
 *    לרוץ במקביל ולשלוח את אותו פריט 2–3 פעמים.
 * 2. לפני שליחת מילוי מהתור — בודקים אם רישום זהה (אותו מכשיר, סוג וכמות)
 *    כבר נקלט ב-30 הדקות האחרונות. זה המקרה שבו השרת כן קיבל את הבקשה אבל
 *    התשובה לא חזרה בגלל קליטה חלשה, והפריט נשאר בתור ונשלח שוב.
 */
let inFlight = null;

async function alreadyRecorded(item) {
  if (item.type !== 'completeVisit' && item.type !== 'createOilEntry') return false;
  const p = item.payload || {};
  if (!p.device_id) return false;
  const since = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('oil_tracking')
    .select('id')
    .eq('device_id', p.device_id)
    .eq('event_type', p.event_type ?? 'refill')
    .eq('liters_added', Number(p.liters_added ?? 0))
    .gte('recorded_at', since)
    .limit(1);
  if (error) return false; // לא חוסמים סנכרון בגלל בדיקה שנכשלה
  return (data ?? []).length > 0;
}

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
export function syncQueue(options = {}) {
  if (inFlight) return inFlight;
  const run = () => runSyncQueue(options);
  inFlight = (typeof navigator !== 'undefined' && navigator.locks?.request
    ? navigator.locks.request('iconair-offline-sync', { ifAvailable: true }, (lock) => (lock ? run() : { synced: 0, failed: 0 }))
    : run()
  ).finally(() => { inFlight = null; });
  return inFlight;
}

async function runSyncQueue({ onProgress } = {}) {
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
      if (await alreadyRecorded(item)) {
        // כבר נקלט בשרת בשליחה קודמת — רק מוציאים מהתור, בלי רישום כפול
        await removeFromQueue(item.id);
        continue;
      }
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
