import { supabase } from './supabase';

/**
 * phase74 — דיווח אוטומטי למערכת על מה שתקוע בתור הלא-מקוון בטלפון הזה.
 * ביקורים שנשמרו בלי קליטה יושבים רק בזיכרון של הטלפון (IndexedDB), והמנהל
 * לא רואה אותם. כאן כל טלפון מעדכן שורה אחת שלו בטבלה offline_queue_status:
 * כמה ממתינים, כמה נכשלו (ומה), ומתי נוצר הממתין הוותיק ביותר.
 * מרכז ההתראות (alertsQueries) מתריע למנהל כשיש כאלה.
 *
 * שולחים רק כשיש רשת, רק כשהמצב השתנה או פעם ב-10 דקות (כדי לא להעמיס),
 * ורק כשיש משתמש מחובר. שום כשל כאן לא משפיע על האפליקציה.
 */
const MIN_INTERVAL_MS = 10 * 60 * 1000;
let lastSignature = null;
let lastSentAt = 0;
let sending = false;

export async function reportQueueStatus(items) {
  try {
    if (sending || typeof navigator === 'undefined' || !navigator.onLine) return;
    const list = Array.isArray(items) ? items : [];
    const pendingItems = list.filter((i) => i.status === 'pending');
    const failedItems = list.filter((i) => i.status === 'error');
    const signature = `${pendingItems.length}|${failedItems.map((i) => i.id).join(',')}`;
    const now = Date.now();
    if (signature === lastSignature && now - lastSentAt < MIN_INTERVAL_MS) return;

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    sending = true;
    const oldest = pendingItems.map((i) => i.createdAt).filter(Boolean).sort()[0] ?? null;
    const { error } = await supabase.from('offline_queue_status').upsert({
      user_id: session.user.id,
      pending: pendingItems.length,
      failed: failedItems.length,
      oldest_pending_at: oldest,
      failed_items: failedItems.slice(0, 20).map((i) => ({
        type: i.type,
        device_id: i.payload?.device_id ?? null,
        liters_added: i.payload?.liters_added ?? null,
        created_at: i.createdAt,
        error: String(i.error ?? '').slice(0, 200),
      })),
      app_info: String(navigator.userAgent || '').slice(0, 180),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });
    if (!error) {
      lastSignature = signature;
      lastSentAt = now;
    }
  } catch {
    // דיווח בלבד — אף פעם לא מפיל את האפליקציה
  } finally {
    sending = false;
  }
}
