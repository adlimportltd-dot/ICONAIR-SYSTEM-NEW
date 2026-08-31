// visit-notify — Supabase Edge Function (Deno).
//
// ⚠ טיוטה שמעולם לא נפרסה ולא נבדקה. אין לי גישה ל-Supabase CLI, לחשבון
// WhatsApp Business API, או לסודות שלך — הקוד הזה כתוב לפי תיעוד ה-API
// הרשמי של Meta (WhatsApp Cloud API), אבל לא הופעל אף פעם בפועל.
//
// מה שהוא מניח, וצריך שתספק לפני שזה יעבוד:
//   1. חשבון WhatsApp Business API (דרך Meta) עם מספר טלפון מאומת.
//   2. הודעת הפתיחה חייבת להיות "template" מאושר מראש ע"י Meta —
//      WhatsApp לא מרשה לעסק לפתוח שיחה עם הודעת טקסט חופשי; רק
//      אחרי שהאדמין עצמו הגיב, 24 השעות הבאות מאפשרות טקסט חופשי.
//      כלומר: ההודעה הראשונה על כל ביקור צריכה תבנית מאושרת, לא רק
//      את הטקסט למטה. תבנית לדוגמה בהערה בסוף הקובץ.
//   3. משתני סביבה (Supabase Dashboard → Edge Functions → Secrets):
//        WHATSAPP_TOKEN        — Permanent access token
//        WHATSAPP_PHONE_ID     — מזהה מספר הטלפון העסקי
//        ADMIN_WHATSAPP_NUMBER — מספר האדמין ביעד (כולל קידומת מדינה)
//        WEBHOOK_SHARED_SECRET — אותו סוד שהטריגר ב-Postgres שולח
//                                 ב-Authorization header (ר' שלב 3
//                                 ב-iconair_schema_phase3_visits.sql)

const WHATSAPP_TOKEN = Deno.env.get('WHATSAPP_TOKEN');
const WHATSAPP_PHONE_ID = Deno.env.get('WHATSAPP_PHONE_ID');
const ADMIN_WHATSAPP_NUMBER = Deno.env.get('ADMIN_WHATSAPP_NUMBER');
const WEBHOOK_SHARED_SECRET = Deno.env.get('WEBHOOK_SHARED_SECRET');

interface VisitPayload {
  oil_tracking_id: string;
  device_id: string;
  device_serial: string;
  customer_name: string;
  technician_name: string | null;
  event_type: 'refill' | 'replacement' | 'reading';
  scent_name: string | null;
  level_after_pct: number;
  recorded_at: string;
}

const EVENT_LABEL: Record<VisitPayload['event_type'], string> = {
  refill: 'מילוי',
  replacement: 'החלפה',
  reading: 'קריאה',
};

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  // אימות: רק הטריגר ב-Postgres (שמכיר את הסוד) יכול להפעיל את הפונקציה.
  const auth = req.headers.get('Authorization');
  if (!WEBHOOK_SHARED_SECRET || auth !== `Bearer ${WEBHOOK_SHARED_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  if (!WHATSAPP_TOKEN || !WHATSAPP_PHONE_ID || !ADMIN_WHATSAPP_NUMBER) {
    console.error('חסרים משתני סביבה של WhatsApp — ר\' ההערות בראש הקובץ');
    return new Response('Server misconfigured', { status: 500 });
  }

  const payload: VisitPayload = await req.json();

  const message =
    `ביקור הושלם — ${EVENT_LABEL[payload.event_type] ?? payload.event_type}\n` +
    `לקוח: ${payload.customer_name}\n` +
    `מכשיר: ${payload.device_serial}\n` +
    `${payload.scent_name ? `ניחוח: ${payload.scent_name}\n` : ''}` +
    `מפלס אחרי: ${payload.level_after_pct}%\n` +
    `טכנאי: ${payload.technician_name ?? 'לא ידוע'}\n` +
    `זמן: ${new Date(payload.recorded_at).toLocaleString('he-IL')}`;

  // הודעת טקסט חופשי — עובדת רק בתוך חלון 24 השעות מאז שהאדמין הגיב
  // לאחרונה. מחוץ לחלון הזה, WhatsApp דוחה את הקריאה הזו ודורש
  // "template message" מאושר במקומה (ר' דוגמה בתחתית הקובץ).
  const waResponse = await fetch(
    `https://graph.facebook.com/v20.0/${WHATSAPP_PHONE_ID}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: ADMIN_WHATSAPP_NUMBER,
        type: 'text',
        text: { body: message },
      }),
    }
  );

  if (!waResponse.ok) {
    const errorBody = await waResponse.text();
    console.error('WhatsApp API error:', waResponse.status, errorBody);
    return new Response('WhatsApp send failed', { status: 502 });
  }

  return new Response('ok', { status: 200 });
});

/* ---------------------------------------------------------------------
   דוגמה ל-template message (נדרש אם 24 השעות חלפו — ר' ההערה למעלה).
   יש ליצור ולאשר את התבנית מראש ב-Meta Business Manager, ואז להחליף
   את גוף הבקשה למעלה במשהו כזה:

   body: JSON.stringify({
     messaging_product: 'whatsapp',
     to: ADMIN_WHATSAPP_NUMBER,
     type: 'template',
     template: {
       name: 'visit_completed',       // שם התבנית שאישרת ב-Meta
       language: { code: 'he' },
       components: [{
         type: 'body',
         parameters: [
           { type: 'text', text: payload.customer_name },
           { type: 'text', text: payload.device_serial },
           { type: 'text', text: String(payload.level_after_pct) },
         ],
       }],
     },
   })
--------------------------------------------------------------------- */
