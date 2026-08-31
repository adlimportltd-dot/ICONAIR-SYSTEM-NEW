// supabase/functions/analyze-invoice/index.ts
//
// פונקציית Edge שמקבלת תמונה/PDF של חשבונית, שולחת אותה ל-Claude (Anthropic)
// לזיהוי מבני של השדות, ומחזירה JSON נקי ללקוח. המפתח הסודי (ANTHROPIC_API_KEY)
// חי אך ורק כאן, בצד השרת - הדפדפן לעולם לא רואה אותו.
//
// דורש: מפתח אמיתי מ-console.anthropic.com (שירות בתשלום, לא חינמי).
//
// פריסה חד-פעמית:
//   supabase functions deploy analyze-invoice
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  try {
    // ---------- אימות: רק משתמש מחובר ובעל תפקיד admin רשאי להשתמש בסריקה ----------
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "חסר טוקן הזדהות" }), { status: 401, headers: CORS_HEADERS });
    }
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "משתמש לא מזוהה" }), { status: 401, headers: CORS_HEADERS });
    }
    const { data: profile } = await supabaseClient.from("profiles").select("role").eq("id", user.id).maybeSingle();
    if (!profile || profile.role !== "admin") {
      return new Response(JSON.stringify({ error: "רק מנהל רשאי להשתמש בסריקת חשבוניות" }), { status: 403, headers: CORS_HEADERS });
    }

    // ---------- קלט ----------
    const { imageBase64, mediaType } = await req.json();
    if (!imageBase64) {
      return new Response(JSON.stringify({ error: "לא התקבלה תמונה" }), { status: 400, headers: CORS_HEADERS });
    }
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "המערכת לא הוגדרה - חסר ANTHROPIC_API_KEY בסודות הפונקציה" }), { status: 500, headers: CORS_HEADERS });
    }

    // ---------- קריאה ל-Claude עם התמונה ----------
    const prompt = `זוהי תמונה או מסמך של חשבונית ספק ישראלית. חלץ ממנה בדיוק את השדות הבאים והחזר אך ורק אובייקט JSON תקני, בלי שום טקסט נוסף לפניו או אחריו, בפורמט הזה בדיוק:
{
  "supplierName": string או null,
  "invoiceNumber": string או null,
  "invoiceDate": string בפורמט YYYY-MM-DD או null,
  "amountExclVat": number או null,
  "vatAmount": number או null,
  "amountInclVat": number או null
}
אם שדה מסוים לא ניתן לזיהוי בוודאות, החזר null עבורו במקום לנחש. אם מופיע רק סכום כולל מע"מ בלי פירוט, חשב את הפירוק לפי מע"מ 18% ומלא את שלושת השדות. אל תוסיף הסברים, רק את ה-JSON.`;

    const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1024,
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType || "image/jpeg", data: imageBase64 } },
            { type: "text", text: prompt },
          ],
        }],
      }),
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      return new Response(JSON.stringify({ error: `שגיאה משירות הזיהוי: ${errText}` }), { status: 502, headers: CORS_HEADERS });
    }

    const aiData = await aiRes.json();
    const textBlock = (aiData.content || []).find((c) => c.type === "text");
    if (!textBlock) {
      return new Response(JSON.stringify({ error: "לא התקבלה תשובת טקסט מהמודל" }), { status: 502, headers: CORS_HEADERS });
    }

    // חילוץ ה-JSON מתוך התשובה (למקרה שהמודל הוסיף ```json מסביב בכל זאת)
    const cleaned = textBlock.text.replace(/```json|```/g, "").trim();
    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (e) {
      return new Response(JSON.stringify({ error: "התשובה מהמודל לא הייתה JSON תקין" }), { status: 502, headers: CORS_HEADERS });
    }

    return new Response(JSON.stringify(parsed), { status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message || "שגיאה לא צפויה בסריקה" }), { status: 500, headers: CORS_HEADERS });
  }
});
