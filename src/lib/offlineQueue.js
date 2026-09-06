/**
 * תור פעולות לא-מקוונות (IndexedDB) — כשטכנאי בשטח בלי קליטה מבצע
 * פעולה קריטית (עדכון שמן / סיום ביקור / רישום מכשיר), הפעולה נשמרת
 * כאן במקום להיזרק כשגיאה, ומסתנכרנת אוטומטית ברגע שיש רשת שוב
 * (ר' offlineSync.js). IndexedDB ולא localStorage — כי localStorage
 * מוגבל ל-~5MB וסינכרוני (חוסם את ה-thread הראשי בכל קריאה/כתיבה),
 * וזה תור שיכול לגדול וממשיך לגדול כל עוד הטכנאי בלי קליטה.
 */
const DB_NAME = 'iconair-offline';
const DB_VERSION = 1;
const STORE = 'outbox';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const store = tx.objectStore(STORE);
    const result = fn(store);
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
  });
}

/** מוסיף פעולה לתור. type הוא שם קבוע (ר' offlineSync.EXECUTORS), payload — הארגומנטים המקוריים של הקריאה. */
export async function enqueue(type, payload) {
  const item = {
    id: crypto.randomUUID(),
    type,
    payload,
    status: 'pending',
    error: null,
    createdAt: new Date().toISOString(),
  };
  await withStore('readwrite', (store) => store.add(item));
  return item;
}

export async function listQueue() {
  return withStore('readonly', (store) => {
    return new Promise((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result.sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
      req.onerror = () => reject(req.error);
    });
  }).then((p) => p);
}

export async function removeFromQueue(id) {
  return withStore('readwrite', (store) => store.delete(id));
}

export async function markQueueItemError(id, message) {
  return withStore('readwrite', (store) => {
    return new Promise((resolve, reject) => {
      const getReq = store.get(id);
      getReq.onsuccess = () => {
        const item = getReq.result;
        if (!item) return resolve();
        item.status = 'error';
        item.error = message;
        store.put(item);
        resolve();
      };
      getReq.onerror = () => reject(getReq.error);
    });
  });
}

/** תואם ל"רשת נפלה" — לא כל שגיאה: שגיאה מהשרת (למשל אין מלאי, חריגת קיבולת) לא אמורה להיתקע בתור לנצח בלי שהמשתמש יידע. */
export function isNetworkError(error) {
  const msg = String(error?.message ?? error ?? '');
  return (
    !navigator.onLine ||
    /Failed to fetch|NetworkError|Load failed|network request failed/i.test(msg)
  );
}
