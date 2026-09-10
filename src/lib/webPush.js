import { supabase } from './supabase';

/**
 * התראות Web Push אמיתיות (לא PWA-caching, לא offline) — ר' public/sw.js
 * ו-api/send-push.js. היקף מכוון: מנהלים בלבד, כדי לקבל התראה קופצת
 * כשטכנאי מסיים ביקור, גם כשהטלפון נעול/האפליקציה סגורה.
 *
 * ⚠ מגבלת פלטפורמה אמיתית שחשוב לדעת: ב-iOS (Safari) התראות Web Push
 * עובדות רק אם האפליקציה הותקנה כ-PWA אמיתי ("הוסף למסך הבית"), לא
 * מתוך טאב רגיל בספארי, ורק מ-iOS 16.4 ומעלה — זו מגבלה של אפל, לא
 * שלנו. ב-Android/Chrome זה עובד גם מתוך טאב רגיל בדפדפן.
 */

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

export const isPushSupported = () =>
  typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

/** 'unsupported' | 'denied' | 'subscribed' | 'not-subscribed' */
export async function getPushState() {
  if (!isPushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  try {
    const reg = await navigator.serviceWorker.getRegistration('/sw.js');
    const sub = await reg?.pushManager.getSubscription();
    return sub ? 'subscribed' : 'not-subscribed';
  } catch {
    return 'not-subscribed';
  }
}

export async function subscribeToPush(vapidPublicKey, userId) {
  if (!isPushSupported()) throw new Error('הדפדפן הזה לא תומך בהתראות Push');
  if (!vapidPublicKey) throw new Error('לא הוגדר מפתח VAPID ציבורי במערכת');

  const reg = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('ההרשאה להתראות נדחתה');

  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
    });
  }

  const json = sub.toJSON();
  const { error } = await supabase
    .from('push_subscriptions')
    .upsert(
      { user_id: userId, endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth },
      { onConflict: 'endpoint' }
    );
  if (error) throw error;

  return sub;
}

export async function unsubscribeFromPush() {
  const reg = await navigator.serviceWorker.getRegistration('/sw.js');
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
    await sub.unsubscribe();
  }
}
