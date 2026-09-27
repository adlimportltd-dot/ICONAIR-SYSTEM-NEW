// /api/social — Vercel Serverless Function (Node.js runtime).
//
// הגשר היחיד בין טאב "ניהול סושיאל" לבין Meta Graph API (phase45).
// טוקן ה-Meta יושב אך ורק כאן, כמשתנה סביבה ב-Vercel — לעולם לא בדפדפן
// ולא ב-DB.
//
// אבטחה: כל קריאה חייבת להגיע עם ה-access token של המשתמש המחובר
// (Authorization: Bearer ...). הפונקציה יוצרת לקוח Supabase בשם המשתמש
// עצמו (anon key + ה-JWT שלו) ובודקת is_admin() — כך שכל קריאה/כתיבה
// ל-social_posts עוברת את אותו RLS בדיוק כמו בדפדפן. אין כאן service_role.
//
// משתני סביבה ב-Vercel (Project → Settings → Environment Variables):
//   META_PAGE_ID            — מזהה עמוד הפייסבוק (חובה לפייסבוק)
//   META_PAGE_ACCESS_TOKEN  — Page Access Token ארוך-טווח (חובה; משמש גם לאינסטגרם)
//   META_IG_USER_ID         — מזהה חשבון האינסטגרם העסקי המקושר לעמוד (לאינסטגרם)
//   META_AD_ACCOUNT_ID      — מזהה חשבון המודעות, בלי act_ (לקמפיינים, אופציונלי)
//   META_ADS_ACCESS_TOKEN   — טוקן עם ads_read (אופציונלי; ברירת מחדל: טוקן העמוד)
//   META_GRAPH_VERSION      — אופציונלי, ברירת מחדל v23.0
// VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY כבר מוגדרים בפרויקט (לבנייה) —
// Vercel חושף אותם גם לפונקציות.

import { createClient } from '@supabase/supabase-js';

const env = (name) => (process.env[name] || '').trim();
const GRAPH = () => `https://graph.facebook.com/${env('META_GRAPH_VERSION') || 'v23.0'}`;

// פייסבוק דורש שזמן תזמון יהיה לפחות 10 דקות קדימה. מתחת לזה — הפוסט
// ממתין אצלנו ומתפרסם כשהגיע זמנו (כמו אינסטגרם).
const FB_MIN_SCHEDULE_MS = 11 * 60 * 1000;
const LOCK_TTL_MS = 2 * 60 * 1000;

function metaConfig() {
  const pageToken = env('META_PAGE_ACCESS_TOKEN');
  return {
    pageId: env('META_PAGE_ID'),
    pageToken,
    igUserId: env('META_IG_USER_ID'),
    adAccountId: env('META_AD_ACCOUNT_ID').replace(/^act_/, ''),
    adsToken: env('META_ADS_ACCESS_TOKEN') || pageToken,
  };
}

async function graph(path, { method = 'GET', params = {}, token }) {
  const url = new URL(`${GRAPH()}/${path}`);
  const init = { method };
  const all = { ...params, access_token: token };

  if (method === 'GET' || method === 'DELETE') {
    for (const [k, v] of Object.entries(all)) if (v != null) url.searchParams.set(k, String(v));
  } else {
    const body = new URLSearchParams();
    for (const [k, v] of Object.entries(all)) if (v != null) body.set(k, String(v));
    init.body = body;
  }

  const res = await fetch(url, init);
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) {
    const err = json.error || {};
    throw new Error(err.error_user_msg || err.message || `Meta API ${res.status}`);
  }
  return json;
}

async function authorize(req) {
  const url = env('VITE_SUPABASE_URL') || env('SUPABASE_URL');
  const anonKey = env('VITE_SUPABASE_ANON_KEY') || env('SUPABASE_ANON_KEY');
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!url || !anonKey) throw Object.assign(new Error('Supabase לא מוגדר בשרת'), { status: 500 });
  if (!token) throw Object.assign(new Error('לא מחובר'), { status: 401 });

  const db = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: isAdmin, error } = await db.rpc('is_admin');
  if (error) throw Object.assign(new Error(error.message), { status: 401 });
  if (!isAdmin) throw Object.assign(new Error('פעולה למנהלים בלבד'), { status: 403 });
  return db;
}

/* ---------------------------- status ---------------------------- */

async function getStatus() {
  const cfg = metaConfig();
  const out = {
    facebook: { configured: Boolean(cfg.pageId && cfg.pageToken) },
    instagram: { configured: Boolean(cfg.igUserId && cfg.pageToken) },
    ads: { configured: Boolean(cfg.adAccountId && cfg.adsToken) },
  };

  const checks = [];
  if (out.facebook.configured) {
    checks.push(
      graph(cfg.pageId, { params: { fields: 'name,link,followers_count,fan_count' }, token: cfg.pageToken })
        .then((p) => Object.assign(out.facebook, { ok: true, name: p.name, link: p.link, followers: p.followers_count ?? p.fan_count ?? null }))
        .catch((e) => Object.assign(out.facebook, { ok: false, error: e.message }))
    );
  }
  if (out.instagram.configured) {
    checks.push(
      graph(cfg.igUserId, { params: { fields: 'username,followers_count,media_count' }, token: cfg.pageToken })
        .then((p) => Object.assign(out.instagram, { ok: true, name: p.username, followers: p.followers_count ?? null, media: p.media_count ?? null }))
        .catch((e) => Object.assign(out.instagram, { ok: false, error: e.message }))
    );
  }
  if (out.ads.configured) {
    checks.push(
      graph(`act_${cfg.adAccountId}`, { params: { fields: 'name,account_status,currency' }, token: cfg.adsToken })
        .then((a) => Object.assign(out.ads, { ok: true, name: a.name, currency: a.currency, accountStatus: a.account_status }))
        .catch((e) => Object.assign(out.ads, { ok: false, error: e.message }))
    );
  }
  await Promise.all(checks);
  return out;
}

/* ---------------------------- publish ---------------------------- */

function fullCaption(post) {
  // בפוסט עם תמונה אין שדה link נפרד בפייסבוק — הקישור מצורף לטקסט.
  return post.image_url && post.link_url ? `${post.caption}\n\n${post.link_url}`.trim() : post.caption;
}

async function publishFacebook(post, cfg, dueAt) {
  const future = dueAt && dueAt.getTime() - Date.now() >= FB_MIN_SCHEDULE_MS;
  const scheduleParams = future
    ? { published: 'false', scheduled_publish_time: Math.floor(dueAt.getTime() / 1000) }
    : {};

  const result = post.image_url
    ? await graph(`${cfg.pageId}/photos`, {
        method: 'POST',
        params: { url: post.image_url, caption: fullCaption(post), ...scheduleParams },
        token: cfg.pageToken,
      })
    : await graph(`${cfg.pageId}/feed`, {
        method: 'POST',
        params: { message: post.caption, link: post.link_url || undefined, ...scheduleParams },
        token: cfg.pageToken,
      });

  return { fb_post_id: result.post_id || result.id, fb_status: future ? 'scheduled' : 'published', fb_error: null };
}

async function publishInstagram(post, cfg) {
  if (!post.image_url) throw new Error('אינסטגרם דורש תמונה');
  const container = await graph(`${cfg.igUserId}/media`, {
    method: 'POST',
    params: { image_url: post.image_url, caption: fullCaption(post) },
    token: cfg.pageToken,
  });
  const published = await graph(`${cfg.igUserId}/media_publish`, {
    method: 'POST',
    params: { creation_id: container.id },
    token: cfg.pageToken,
  });
  return { ig_media_id: published.id, ig_status: 'published', ig_error: null };
}

async function publishPost(db, postId) {
  const cfg = metaConfig();

  // נעילה אטומית: רק קריאה אחת תופסת את הפוסט. אם מישהו אחר כבר באמצע
  // פרסום (נעילה טרייה) — לא נוגעים.
  const staleBefore = new Date(Date.now() - LOCK_TTL_MS).toISOString();
  const { data: claimed, error: claimError } = await db
    .from('social_posts')
    .update({ publish_lock: new Date().toISOString(), is_draft: false })
    .eq('id', postId)
    .or(`publish_lock.is.null,publish_lock.lt."${staleBefore}"`)
    .select()
    .maybeSingle();
  if (claimError) throw new Error(claimError.message);
  if (!claimed) throw Object.assign(new Error('הפוסט כבר בתהליך פרסום'), { status: 409 });

  const post = claimed;
  const dueAt = post.scheduled_at ? new Date(post.scheduled_at) : null;
  const isDue = !dueAt || dueAt.getTime() <= Date.now() + 30 * 1000;
  const patch = { publish_lock: null };

  if (['pending', 'failed'].includes(post.fb_status)) {
    if (!cfg.pageId || !cfg.pageToken) {
      Object.assign(patch, { fb_status: 'failed', fb_error: 'פייסבוק לא מחובר (חסרים META_PAGE_ID / META_PAGE_ACCESS_TOKEN ב-Vercel)' });
    } else if (isDue || dueAt.getTime() - Date.now() >= FB_MIN_SCHEDULE_MS) {
      try {
        Object.assign(patch, await publishFacebook(post, cfg, isDue ? null : dueAt));
      } catch (e) {
        Object.assign(patch, { fb_status: 'failed', fb_error: e.message });
      }
    }
    // אחרת: פחות מ-10 דקות לזמן היעד — ממתין אצלנו ויתפרסם כשיגיע הזמן.
  }

  if (['pending', 'failed'].includes(post.ig_status) && isDue) {
    if (!cfg.igUserId || !cfg.pageToken) {
      Object.assign(patch, { ig_status: 'failed', ig_error: 'אינסטגרם לא מחובר (חסר META_IG_USER_ID ב-Vercel)' });
    } else {
      try {
        Object.assign(patch, await publishInstagram(post, cfg));
      } catch (e) {
        Object.assign(patch, { ig_status: 'failed', ig_error: e.message });
      }
    }
  }

  if (patch.fb_status === 'published' || patch.ig_status === 'published') {
    patch.published_at = new Date().toISOString();
  }

  const { data: saved, error: saveError } = await db
    .from('social_posts')
    .update(patch)
    .eq('id', postId)
    .select()
    .single();
  if (saveError) throw new Error(saveError.message);
  return saved;
}

/** ביטול תזמון בפייסבוק (מוחק את הפוסט הלא-מפורסם אצל Meta) והחזרה לטיוטה */
async function unschedulePost(db, postId) {
  const cfg = metaConfig();
  const { data: post, error } = await db.from('social_posts').select().eq('id', postId).single();
  if (error) throw new Error(error.message);

  if (post.fb_status === 'scheduled' && post.fb_post_id) {
    await graph(post.fb_post_id, { method: 'DELETE', token: cfg.pageToken });
  }

  const patch = { is_draft: true, publish_lock: null };
  if (post.fb_status && post.fb_status !== 'published') Object.assign(patch, { fb_status: 'pending', fb_post_id: null, fb_error: null });
  if (post.ig_status && post.ig_status !== 'published') Object.assign(patch, { ig_status: 'pending', ig_error: null });

  const { data: saved, error: saveError } = await db.from('social_posts').update(patch).eq('id', postId).select().single();
  if (saveError) throw new Error(saveError.message);
  return saved;
}

/* ---------------------------- campaigns ---------------------------- */

async function listCampaigns() {
  const cfg = metaConfig();
  if (!cfg.adAccountId || !cfg.adsToken) return { configured: false, campaigns: [] };

  const fields = [
    'name', 'objective', 'status', 'effective_status', 'daily_budget', 'lifetime_budget',
    'start_time', 'stop_time',
    'insights.date_preset(last_30d){spend,impressions,reach,clicks,ctr,actions}',
  ].join(',');

  const res = await graph(`act_${cfg.adAccountId}/campaigns`, {
    params: { fields, limit: 50, effective_status: JSON.stringify(['ACTIVE', 'PAUSED', 'IN_PROCESS', 'WITH_ISSUES', 'CAMPAIGN_PAUSED']) },
    token: cfg.adsToken,
  });

  const campaigns = (res.data || []).map((c) => {
    const insight = c.insights?.data?.[0] || {};
    const leads = (insight.actions || [])
      .filter((a) => a.action_type === 'lead' || a.action_type === 'onsite_conversion.lead_grouped')
      .reduce((max, a) => Math.max(max, Number(a.value) || 0), 0);
    return {
      id: c.id,
      name: c.name,
      objective: c.objective,
      status: c.effective_status || c.status,
      dailyBudget: c.daily_budget ? Number(c.daily_budget) / 100 : null,
      lifetimeBudget: c.lifetime_budget ? Number(c.lifetime_budget) / 100 : null,
      startTime: c.start_time || null,
      stopTime: c.stop_time || null,
      spend: insight.spend != null ? Number(insight.spend) : 0,
      impressions: Number(insight.impressions || 0),
      reach: Number(insight.reach || 0),
      clicks: Number(insight.clicks || 0),
      ctr: insight.ctr != null ? Number(insight.ctr) : null,
      leads,
    };
  });

  return { configured: true, campaigns };
}

/* ---------------------------- handler ---------------------------- */

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const db = await authorize(req);
    const { action, postId } = req.body ?? {};

    switch (action) {
      case 'status':
        res.status(200).json(await getStatus());
        return;
      case 'publish':
        if (!postId) throw Object.assign(new Error('חסר postId'), { status: 400 });
        res.status(200).json({ post: await publishPost(db, postId) });
        return;
      case 'unschedule':
        if (!postId) throw Object.assign(new Error('חסר postId'), { status: 400 });
        res.status(200).json({ post: await unschedulePost(db, postId) });
        return;
      case 'campaigns':
        res.status(200).json(await listCampaigns());
        return;
      default:
        res.status(400).json({ error: 'Unknown action' });
    }
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Server error' });
  }
}
