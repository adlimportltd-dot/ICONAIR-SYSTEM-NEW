// /api/send-push — Vercel Serverless Function (Node.js runtime).
//
// נקרא אך ורק מהטריגר ב-Postgres (send_service_report_push, ר'
// iconair_schema_phase24_push_notifications.sql) דרך pg_net, מיד אחרי
// שדוח שירות נוצר. לא נוגע ב-Supabase בכלל — כל מה שהוא צריך (רשימת
// המנויים, מפתחות VAPID, תוכן ההודעה) כבר מגיע בגוף הבקשה, כי ה-trigger
// כבר שלף אותם ישירות מה-DB/מ-Vault. זה שומר את הפונקציה הזו stateless
// לגמרי — בלי עוד סוד (כמו SUPABASE_SERVICE_ROLE_KEY) שהיה צריך לשבת
// כמשתנה סביבה ב-Vercel, שאין לי גישה להגדיר בו (ר' ההערה בקובץ ה-SQL).
//
// שולח לכל מנוי בנפרד ולא נכשל כולו אם מנוי אחד "מת" (410/404 — המשתמש
// ביטל את ההרשאה או המכשיר לא קיים יותר); כל שגיאה כזו רק מדווחת בתשובה,
// לא זורקת. פישוט מכוון: לא מנקה מנויים מתים מ-push_subscriptions כאן —
// זה ידרוש גישת DB חזרה, שבחרתי להימנע ממנה כדי לא להוסיף עוד סוד.
// מנוי מת פשוט ימשיך להיכשל בשקט בכל שליחה עתידית, בלי להפריע לשאר.

import webpush from 'web-push';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { subscriptions, vapidPublicKey, vapidPrivateKey, vapidSubject, title, body, url } = req.body ?? {};

  if (!vapidPublicKey || !vapidPrivateKey) {
    res.status(400).json({ error: 'Missing VAPID keys' });
    return;
  }
  if (!Array.isArray(subscriptions) || subscriptions.length === 0) {
    res.status(200).json({ sent: 0, failed: 0, results: [] });
    return;
  }

  webpush.setVapidDetails(vapidSubject || 'mailto:iconairisrael@gmail.com', vapidPublicKey, vapidPrivateKey);

  const payload = JSON.stringify({ title: title || 'ICON AIR', body: body || '', url: url || '/' });

  const results = await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(sub, payload);
        return { endpoint: sub.endpoint, ok: true };
      } catch (error) {
        return { endpoint: sub.endpoint, ok: false, status: error?.statusCode, message: error?.message };
      }
    })
  );

  const sent = results.filter((r) => r.ok).length;
  res.status(200).json({ sent, failed: results.length - sent, results });
}
