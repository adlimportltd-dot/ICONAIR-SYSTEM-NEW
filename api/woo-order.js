// /api/woo-order — קליטת הזמנות מ-WooCommerce (Vercel Serverless, Node.js).
//
// WooCommerce → Webhook (Order created / Order updated) → כאן → RPC
// ingest_woo_order ב-Supabase (iconair_schema_phase51_web_orders.sql).
//
// הפונקציה הזו "צינור" בלבד: היא לא מכירה את הסוד ולא כותבת ל-DB בעצמה.
// היא מעבירה את גוף הבקשה המקורי (בדיוק כפי שהגיע, בלי JSON.parse) ואת
// כותרת החתימה ל-Postgres, ושם החתימה נבדקת מול הסוד שב-Vault.
// אין כאן משתני סביבה חדשים — רק VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
// שכבר קיימים בפרויקט.

import { createClient } from '@supabase/supabase-js';

export const config = { maxDuration: 20 };

const env = (name) => (process.env[name] || '').trim();
const SUPABASE_URL = () => env('VITE_SUPABASE_URL') || env('SUPABASE_URL');
const SUPABASE_ANON = () => env('VITE_SUPABASE_ANON_KEY') || env('SUPABASE_ANON_KEY');

// גוף הבקשה הגולמי. לא נוגעים ב-req.body — Vercel מפרסר אותו רק כשניגשים
// אליו, ופרסור + סריאליזציה מחדש היו משנים את הבתים ושוברים את החתימה.
async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export default async function handler(req, res) {
  // בדיקת חיים פשוטה מהדפדפן
  if (req.method === 'GET') {
    res.status(200).json({ ok: true, service: 'woo-order' });
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const raw = await readRawBody(req);

  // כשיוצרים Webhook חדש, WooCommerce שולח "פינג" בפורמט webhook_id=123
  // (לא JSON). חייבים להחזיר 200, אחרת הוא לא ישמור את ה-Webhook כפעיל.
  if (!raw.trim().startsWith('{')) {
    res.status(200).json({ ok: true, ping: true });
    return;
  }

  const signature = req.headers['x-wc-webhook-signature'];
  if (!signature) {
    res.status(401).json({ error: 'Missing signature' });
    return;
  }

  if (!SUPABASE_URL() || !SUPABASE_ANON()) {
    res.status(500).json({ error: 'Supabase env vars missing' });
    return;
  }

  const supabase = createClient(SUPABASE_URL(), SUPABASE_ANON(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supabase.rpc('ingest_woo_order', {
    p_raw: raw,
    p_signature: String(signature),
    p_topic: req.headers['x-wc-webhook-topic'] ? String(req.headers['x-wc-webhook-topic']) : null,
  });

  if (error) {
    const unauthorized = error.code === '28000';
    console.error('ingest_woo_order failed', error.code, error.message);
    res.status(unauthorized ? 401 : 500).json({ error: error.message });
    return;
  }

  res.status(200).json(data);
}
