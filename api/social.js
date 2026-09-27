// /api/social — מנוע הסושיאל של ICONAIR (Vercel Serverless, Node.js).
//
// שלושה ערוצי כניסה, שלוש שכבות הרשאה:
//   1. POST מהמערכת (מנהל מחובר) — Authorization: Bearer <Supabase JWT>.
//      לקוח Supabase נוצר בשם המשתמש עצמו ו-is_admin() נבדק; כל גישה ל-DB
//      עוברת RLS רגיל. הטוקנים של Meta נשלפים דרך social_credentials().
//   2. GET מ-Meta (OAuth callback) — ?code&state. ה-state אקראי, חד-פעמי,
//      תקף 15 דקות (social_oauth_context/finish).
//   3. POST מ-pg_cron (Autopilot) — { action: 'cron', secret }. הסוד יושב רק
//      ב-DB (social_settings.cron_secret) ונשלח ע"י ה-cron עצמו.
//
// אין כאן משתני סביבה חדשים: VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
// כבר קיימים בפרויקט. פרטי ה-App וכל הטוקנים נשמרים ב-social_settings
// (סגורה ב-RLS), ומוזנים מתוך המערכת עצמה (אשף החיבור בטאב הסושיאל).

import { createClient } from '@supabase/supabase-js';

// פרסום לאינסטגרם כולל המתנה לעיבוד התמונה אצל Meta — נותנים לפונקציה עד דקה.
export const config = { maxDuration: 60 };

const GRAPH_VERSION = 'v23.0';
const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;
const OAUTH_SCOPES = [
  'pages_show_list', 'pages_read_engagement', 'pages_manage_posts', 'pages_manage_metadata',
  'read_insights', 'business_management',
  'instagram_basic', 'instagram_content_publish', 'instagram_manage_insights',
  'ads_read', 'ads_management', 'leads_retrieval',
].join(',');

const env = (name) => (process.env[name] || '').trim();
const SUPABASE_URL = () => env('VITE_SUPABASE_URL') || env('SUPABASE_URL');
const SUPABASE_ANON = () => env('VITE_SUPABASE_ANON_KEY') || env('SUPABASE_ANON_KEY');

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ================================ Graph API ================================ */

// תרגום שגיאות Meta לעברית שאפשר לפעול לפיה — בלי קודים טכניים מול המשתמש.
function friendlyMetaError(err = {}) {
  const code = Number(err.code);
  const sub = Number(err.error_subcode);
  if (code === 190 || sub === 463 || sub === 460) return 'החיבור ל-Meta פג או בוטל — לחץ "חיבור מחדש" בלשונית ההגדרות';
  if (code === 10 || code === 200 || (code >= 200 && code < 300)) return 'חסרה הרשאה ב-Meta לפעולה הזו — לחץ "חיבור מחדש" ואשר את כל ההרשאות';
  if (code === 4 || code === 17 || code === 32 || code === 613) return 'Meta מגבילה כרגע את קצב הבקשות — ננסה שוב אוטומטית בעוד כמה דקות';
  if (code === 9007 || sub === 2207027) return 'אינסטגרם עדיין מעבד את התמונה — ננסה שוב אוטומטית';
  if (sub === 2207026 || sub === 2207009) return 'יחס הגובה-רוחב של התמונה לא נתמך באינסטגרם';
  if (sub === 2207004 || sub === 2207052) return 'אינסטגרם לא הצליח להוריד את התמונה — נסה להעלות אותה מחדש';
  if (code === 368) return 'Meta חסמה זמנית פרסום מהעמוד — נסה שוב מאוחר יותר';
  if (code === 100 && /budget/i.test(err.message || '')) return 'התקציב שהוזן נמוך מהמינימום של Meta';
  if (code === 1487390 || /payment/i.test(err.message || '')) return 'לחשבון המודעות אין אמצעי תשלום פעיל ב-Meta';
  return err.error_user_msg || err.error_user_title || err.message || 'שגיאה לא צפויה מ-Meta';
}

function isRetryable(err = {}) {
  const code = Number(err.code);
  return [1, 2, 4, 17, 32, 341, 613, 9007].includes(code) || Number(err.error_subcode) === 2207027 || err.is_transient;
}

async function graph(path, { method = 'GET', params = {}, token } = {}) {
  const url = new URL(path.startsWith('http') ? path : `${GRAPH}/${path}`);
  const all = { ...params };
  if (token) all.access_token = token;
  const init = { method };

  if (method === 'GET' || method === 'DELETE') {
    for (const [k, v] of Object.entries(all)) if (v != null) url.searchParams.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  } else {
    const body = new URLSearchParams();
    for (const [k, v] of Object.entries(all)) if (v != null) body.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
    init.body = body;
  }

  let lastErr;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const res = await fetch(url, init).catch((e) => ({ ok: false, json: async () => ({ error: { message: e.message, is_transient: true } }) }));
    const json = await res.json().catch(() => ({}));
    if (res.ok && !json.error) return json;
    lastErr = json.error || { message: `Meta ${res.status}` };
    // POST חוזר רק כשבטוח ש-Meta לא ביצעה את הפעולה (הגבלת קצב / מדיה בעיבוד) —
    // אחרת עלול להיווצר פוסט כפול.
    const notExecuted = [4, 17, 32, 613, 9007].includes(Number(lastErr.code)) || Number(lastErr.error_subcode) === 2207027;
    if (!isRetryable(lastErr) || (method === 'POST' && !notExecuted)) break;
    await sleep(800 * (attempt + 1));
  }
  const e = new Error(friendlyMetaError(lastErr));
  e.meta = lastErr;
  e.retryable = isRetryable(lastErr);
  throw e;
}

/* ================================ Supabase ================================ */

function userClient(jwt) {
  return createClient(SUPABASE_URL(), SUPABASE_ANON(), {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
const anonClient = () => createClient(SUPABASE_URL(), SUPABASE_ANON(), { auth: { persistSession: false, autoRefreshToken: false } });

async function rpc(db, fn, args) {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw fail(error.message, 500);
  return data;
}

async function authorizeAdmin(req) {
  if (!SUPABASE_URL() || !SUPABASE_ANON()) throw fail('Supabase לא מוגדר בשרת', 500);
  const jwt = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!jwt) throw fail('לא מחובר', 401);
  const db = userClient(jwt);
  const { data: isAdmin, error } = await db.rpc('is_admin');
  if (error) throw fail('ההתחברות פגה — רענן את הדף', 401);
  if (!isAdmin) throw fail('פעולה למנהלים בלבד', 403);
  return db;
}

function baseUrl(req) {
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || 'https';
  return `${proto}://${host}`;
}
const redirectUri = (req) => `${baseUrl(req)}/api/social`;

/* ================================ OAuth ================================ */

async function oauthStart(db, req) {
  const { state, app_id: appId } = await rpc(db, 'social_begin_oauth');
  const url = new URL(`https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth`);
  url.searchParams.set('client_id', appId);
  url.searchParams.set('redirect_uri', redirectUri(req));
  url.searchParams.set('state', state);
  url.searchParams.set('scope', OAUTH_SCOPES);
  url.searchParams.set('response_type', 'code');
  return { url: url.toString() };
}

async function oauthCallback(req, res) {
  const { code, state, error_description: denied } = req.query || {};
  const back = (params) => {
    res.statusCode = 302;
    res.setHeader('Location', `${baseUrl(req)}/?${new URLSearchParams({ tab: 'social', ...params })}`);
    res.end();
  };
  if (denied || !code) return back({ meta: 'cancelled' });

  try {
    const db = anonClient();
    const ctx = await rpc(db, 'social_oauth_context', { p_state: state });

    const short = await graph('oauth/access_token', {
      params: { client_id: ctx.app_id, client_secret: ctx.app_secret, redirect_uri: redirectUri(req), code },
    });
    const long = await graph('oauth/access_token', {
      params: { grant_type: 'fb_exchange_token', client_id: ctx.app_id, client_secret: ctx.app_secret, fb_exchange_token: short.access_token },
    });
    const userToken = long.access_token || short.access_token;
    const expiresAt = long.expires_in ? new Date(Date.now() + long.expires_in * 1000).toISOString() : null;

    // טוקן עמוד שנגזר מטוקן משתמש ארוך-טווח — לא פג תוקף.
    const pagesRes = await graph('me/accounts', {
      params: { fields: 'id,name,access_token,picture{url},instagram_business_account{id,username}', limit: 100 },
      token: userToken,
    });
    const pages = (pagesRes.data || []).map((p) => ({
      id: p.id,
      name: p.name,
      access_token: p.access_token,
      picture: p.picture?.data?.url || null,
      ig_user_id: p.instagram_business_account?.id || null,
      ig_username: p.instagram_business_account?.username || null,
    }));

    let adAccounts = [];
    try {
      const ads = await graph('me/adaccounts', { params: { fields: 'account_id,name,currency,account_status', limit: 100 }, token: userToken });
      adAccounts = (ads.data || []).map((a) => ({ id: a.account_id, name: a.name, currency: a.currency, account_status: a.account_status }));
    } catch { /* אין הרשאת מודעות — ממשיכים בלי */ }

    await rpc(db, 'social_oauth_finish', {
      p_state: state, p_user_token: userToken, p_expires_at: expiresAt, p_pages: pages, p_ad_accounts: adAccounts,
    });
    return back({ meta: pages.length ? 'connected' : 'no_pages' });
  } catch (e) {
    return back({ meta: 'error', reason: String(e.message || '').slice(0, 180) });
  }
}

/* ================================ סטטוס ================================ */

async function status(db) {
  const s = await rpc(db, 'social_status');
  const out = { ...s, health: null };
  if (!s.connected) return out;

  const creds = await rpc(db, 'social_credentials');
  try {
    const page = await graph(creds.page_id, { params: { fields: 'followers_count,fan_count' }, token: creds.page_token });
    out.page_followers = page.followers_count ?? page.fan_count ?? null;
    if (creds.ig_user_id) {
      const ig = await graph(creds.ig_user_id, { params: { fields: 'followers_count,media_count' }, token: creds.page_token }).catch(() => null);
      out.ig_followers = ig?.followers_count ?? null;
      out.ig_media = ig?.media_count ?? null;
    }
    out.health = 'ok';
  } catch (e) {
    out.health = 'error';
    out.health_message = e.message;
  }
  return out;
}

/* ================================ פרסום ================================ */

const withLink = (post) => (post.link_url && post.media_urls?.length ? `${post.caption}\n\n${post.link_url}`.trim() : post.caption);

async function publishFacebook(post, c) {
  const media = post.media_urls || [];
  let postId;

  if (media.length === 0) {
    const r = await graph(`${c.page_id}/feed`, { method: 'POST', params: { message: post.caption, link: post.link_url || undefined }, token: c.page_token });
    postId = r.id;
  } else if (media.length === 1) {
    const r = await graph(`${c.page_id}/photos`, { method: 'POST', params: { url: media[0], caption: withLink(post) }, token: c.page_token });
    postId = r.post_id || `${c.page_id}_${r.id}`;
  } else {
    const ids = [];
    for (const url of media) {
      const r = await graph(`${c.page_id}/photos`, { method: 'POST', params: { url, published: 'false' }, token: c.page_token });
      ids.push({ media_fbid: r.id });
    }
    const r = await graph(`${c.page_id}/feed`, { method: 'POST', params: { message: withLink(post), attached_media: ids }, token: c.page_token });
    postId = r.id;
  }

  const link = await graph(postId, { params: { fields: 'permalink_url' }, token: c.page_token }).catch(() => ({}));
  return { fb_status: 'published', fb_post_id: postId, fb_permalink: link.permalink_url || null, fb_error: null };
}

async function waitForContainer(id, token) {
  for (let i = 0; i < 12; i += 1) {
    const r = await graph(id, { params: { fields: 'status_code' }, token }).catch(() => ({}));
    if (!r.status_code || r.status_code === 'FINISHED') return;
    if (r.status_code === 'ERROR' || r.status_code === 'EXPIRED') throw new Error('אינסטגרם לא הצליח לעבד את התמונה');
    await sleep(1500);
  }
}

async function publishInstagram(post, c) {
  if (!c.ig_user_id) throw new Error('לעמוד הפייסבוק לא מקושר חשבון אינסטגרם עסקי');
  const media = post.media_urls || [];
  if (!media.length) throw new Error('פוסט אינסטגרם חייב לפחות תמונה אחת');

  let containerId;
  if (media.length === 1) {
    containerId = (await graph(`${c.ig_user_id}/media`, { method: 'POST', params: { image_url: media[0], caption: withLink(post) }, token: c.page_token })).id;
  } else {
    const children = [];
    for (const url of media) {
      children.push((await graph(`${c.ig_user_id}/media`, { method: 'POST', params: { image_url: url, is_carousel_item: 'true' }, token: c.page_token })).id);
    }
    for (const id of children) await waitForContainer(id, c.page_token);
    containerId = (await graph(`${c.ig_user_id}/media`, {
      method: 'POST', params: { media_type: 'CAROUSEL', children: children.join(','), caption: withLink(post) }, token: c.page_token,
    })).id;
  }
  await waitForContainer(containerId, c.page_token);
  const published = await graph(`${c.ig_user_id}/media_publish`, { method: 'POST', params: { creation_id: containerId }, token: c.page_token });
  const link = await graph(published.id, { params: { fields: 'permalink' }, token: c.page_token }).catch(() => ({}));
  return { ig_status: 'published', ig_media_id: published.id, ig_permalink: link.permalink || null, ig_error: null };
}

/** מפרסם את מה שממתין בפוסט. מחזיר patch לשמירה. שגיאה זמנית → נשאר pending לניסיון חוזר. */
async function runPublish(post, c) {
  const patch = { publish_lock: null, attempts: (post.attempts || 0) + 1 };
  if (!c.page_token) {
    if (post.fb_status === 'pending') Object.assign(patch, { fb_status: 'failed', fb_error: 'Meta לא מחובר' });
    if (post.ig_status === 'pending') Object.assign(patch, { ig_status: 'failed', ig_error: 'Meta לא מחובר' });
    return patch;
  }
  const lastTry = patch.attempts >= 5;

  if (post.fb_status === 'pending') {
    try { Object.assign(patch, await publishFacebook(post, c)); } catch (e) {
      Object.assign(patch, e.retryable && !lastTry ? { fb_error: `${e.message} (ניסיון ${patch.attempts})` } : { fb_status: 'failed', fb_error: e.message });
    }
  }
  if (post.ig_status === 'pending') {
    try { Object.assign(patch, await publishInstagram(post, c)); } catch (e) {
      Object.assign(patch, e.retryable && !lastTry ? { ig_error: `${e.message} (ניסיון ${patch.attempts})` } : { ig_status: 'failed', ig_error: e.message });
    }
  }
  if (patch.fb_status === 'published' || patch.ig_status === 'published') patch.published_at = post.published_at || new Date().toISOString();
  return patch;
}

async function publishNow(db, postId) {
  const creds = await rpc(db, 'social_credentials');
  const stale = new Date(Date.now() - 3 * 60 * 1000).toISOString();
  const { data: post, error } = await db.from('social_posts')
    .update({ publish_lock: new Date().toISOString(), is_draft: false, scheduled_at: null })
    .eq('id', postId)
    .or(`publish_lock.is.null,publish_lock.lt."${stale}"`)
    .select().maybeSingle();
  if (error) throw fail(error.message, 500);
  if (!post) throw fail('הפוסט כבר בתהליך פרסום', 409);

  // "פרסם עכשיו" ידני מאפס את מונה הניסיונות ומחזיר כשלונות לתור.
  const ready = {
    ...post,
    attempts: 0,
    fb_status: post.fb_status === 'failed' ? 'pending' : post.fb_status,
    ig_status: post.ig_status === 'failed' ? 'pending' : post.ig_status,
  };
  const patch = await runPublish(ready, creds);
  const { data: saved, error: saveErr } = await db.from('social_posts').update(patch).eq('id', postId).select().single();
  if (saveErr) throw fail(saveErr.message, 500);
  return saved;
}

/* ================================ ביצועים ================================ */

async function fbMetrics(postId, token) {
  const r = await graph(postId, {
    params: { fields: 'reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0),shares' },
    token,
  });
  const m = {
    reactions: r.reactions?.summary?.total_count ?? 0,
    comments: r.comments?.summary?.total_count ?? 0,
    shares: r.shares?.count ?? 0,
  };
  for (const metric of ['post_impressions_unique', 'post_clicks']) {
    try {
      const i = await graph(`${postId}/insights`, { params: { metric }, token });
      const v = i.data?.[0]?.values?.[0]?.value;
      if (typeof v === 'number') m[metric === 'post_clicks' ? 'clicks' : 'reach'] = v;
    } catch { /* מדד לא זמין לפוסט הזה */ }
  }
  return m;
}

async function igMetrics(mediaId, token) {
  const r = await graph(mediaId, { params: { fields: 'like_count,comments_count' }, token });
  const m = { likes: r.like_count ?? 0, comments: r.comments_count ?? 0 };
  for (const metrics of ['reach,saved,views,shares', 'reach,saved']) {
    try {
      const i = await graph(`${mediaId}/insights`, { params: { metric: metrics }, token });
      for (const row of i.data || []) m[row.name] = row.values?.[0]?.value ?? row.total_value?.value ?? 0;
      break;
    } catch { /* ננסה סט מדדים מצומצם */ }
  }
  return m;
}

async function collectMetrics(post, c) {
  const patch = { metrics_updated_at: new Date().toISOString() };
  if (post.fb_post_id) patch.fb_metrics = await fbMetrics(post.fb_post_id, c.page_token).catch(() => post.fb_metrics);
  if (post.ig_media_id) patch.ig_metrics = await igMetrics(post.ig_media_id, c.page_token).catch(() => post.ig_metrics);
  return patch;
}

async function refreshMetrics(db) {
  const creds = await rpc(db, 'social_credentials');
  if (!creds.page_token) return { updated: 0 };
  const since = new Date(Date.now() - 30 * 86400000).toISOString();
  const { data: posts } = await db.from('social_posts').select('*').gt('published_at', since).limit(40);
  let updated = 0;
  for (const post of posts || []) {
    const patch = await collectMetrics(post, creds);
    await db.from('social_posts').update(patch).eq('id', post.id);
    updated += 1;
  }
  return { updated };
}

/* ================================ Autopilot ================================ */

async function cron(body) {
  const db = anonClient();
  const secret = body.secret;
  const creds = await rpc(db, 'social_cron_credentials', { p_secret: secret });
  const due = (await rpc(db, 'social_cron_claim_due', { p_secret: secret })) || [];

  let published = 0;
  for (const post of due) {
    const patch = await runPublish(post, creds);
    await rpc(db, 'social_cron_update', { p_secret: secret, p_id: post.id, p: patch });
    if (patch.published_at) published += 1;
  }

  let metrics = 0;
  if (body.metrics) {
    const recent = (await rpc(db, 'social_cron_recent', { p_secret: secret })) || [];
    for (const post of recent) {
      const patch = await collectMetrics(post, creds);
      await rpc(db, 'social_cron_update', { p_secret: secret, p_id: post.id, p: patch });
      metrics += 1;
    }
  }
  return { due: due.length, published, metrics };
}

/* ================================ קמפיינים ================================ */

const PRESETS = new Set(['today', 'yesterday', 'last_7d', 'last_14d', 'last_30d', 'this_month', 'last_month', 'maximum']);

function leadCount(actions = []) {
  return actions
    .filter((a) => ['lead', 'onsite_conversion.lead_grouped', 'leadgen_grouped', 'offsite_conversion.fb_pixel_lead'].includes(a.action_type))
    .reduce((max, a) => Math.max(max, Number(a.value) || 0), 0);
}

async function campaigns(db, preset = 'last_30d') {
  const c = await rpc(db, 'social_credentials');
  if (!c.ad_account_id || !c.user_token) return { configured: false, campaigns: [], daily: [] };
  const datePreset = PRESETS.has(preset) ? preset : 'last_30d';

  const res = await graph(`act_${c.ad_account_id}/campaigns`, {
    params: {
      fields: `name,objective,status,effective_status,daily_budget,lifetime_budget,start_time,stop_time,created_time,insights.date_preset(${datePreset}){spend,impressions,reach,clicks,ctr,cpc,frequency,actions}`,
      limit: 60,
      filtering: [{ field: 'effective_status', operator: 'IN', value: ['ACTIVE', 'PAUSED', 'IN_PROCESS', 'WITH_ISSUES', 'CAMPAIGN_PAUSED', 'PENDING_REVIEW', 'DISAPPROVED'] }],
    },
    token: c.user_token,
  });

  const list = (res.data || []).map((x) => {
    const i = x.insights?.data?.[0] || {};
    const leads = leadCount(i.actions);
    const spend = Number(i.spend || 0);
    return {
      id: x.id, name: x.name, objective: x.objective,
      status: x.effective_status || x.status, configuredStatus: x.status,
      dailyBudget: x.daily_budget ? Number(x.daily_budget) / 100 : null,
      lifetimeBudget: x.lifetime_budget ? Number(x.lifetime_budget) / 100 : null,
      startTime: x.start_time || null, stopTime: x.stop_time || null, createdTime: x.created_time || null,
      spend, impressions: Number(i.impressions || 0), reach: Number(i.reach || 0), clicks: Number(i.clicks || 0),
      ctr: i.ctr != null ? Number(i.ctr) : null, cpc: i.cpc != null ? Number(i.cpc) : null,
      frequency: i.frequency != null ? Number(i.frequency) : null,
      leads, cpl: leads ? spend / leads : null,
    };
  });

  // מגמה יומית ברמת החשבון — לגרף ההוצאה/לידים.
  let daily = [];
  try {
    const d = await graph(`act_${c.ad_account_id}/insights`, {
      params: { fields: 'spend,impressions,clicks,actions', date_preset: datePreset === 'maximum' ? 'last_90d' : datePreset, time_increment: 1, limit: 100 },
      token: c.user_token,
    });
    daily = (d.data || []).map((r) => ({ date: r.date_start, spend: Number(r.spend || 0), clicks: Number(r.clicks || 0), leads: leadCount(r.actions) }));
  } catch { /* החשבון חדש/בלי נתונים */ }

  return { configured: true, currency: c.currency || 'ILS', accountName: c.ad_account_name, campaigns: list, daily };
}

async function updateCampaign(db, { campaignId, status: next, dailyBudget }) {
  const c = await rpc(db, 'social_credentials');
  if (!c.user_token) throw fail('Meta לא מחובר');
  const params = {};
  if (next) {
    if (!['ACTIVE', 'PAUSED'].includes(next)) throw fail('סטטוס לא חוקי');
    params.status = next;
  }
  if (dailyBudget != null) {
    const amount = Math.round(Number(dailyBudget) * 100);
    if (!(amount > 0)) throw fail('תקציב לא חוקי');
    params.daily_budget = amount;
  }
  await graph(campaignId, { method: 'POST', params, token: c.user_token });
  return { ok: true };
}

/** "קדם פוסט": קמפיין + סט מודעות + קריאייטיב + מודעה, מפוסט פייסבוק שכבר פורסם. */
async function boostPost(db, { postId, dailyBudget, days = 7, ageMin = 24, ageMax = 65, cities = [] }) {
  const c = await rpc(db, 'social_credentials');
  if (!c.ad_account_id) throw fail('לא נבחר חשבון מודעות');
  const { data: post, error } = await db.from('social_posts').select('*').eq('id', postId).single();
  if (error || !post?.fb_post_id) throw fail('אפשר לקדם רק פוסט שכבר פורסם בפייסבוק');

  const budget = Math.round(Number(dailyBudget) * 100);
  if (!(budget >= 500)) throw fail('תקציב יומי מינימלי: 5 ₪');
  const act = `act_${c.ad_account_id}`;
  const title = `ICONAIR · קידום · ${(post.caption || 'פוסט').slice(0, 40)}`;
  const end = new Date(Date.now() + Math.max(1, Math.min(60, Number(days))) * 86400000);

  const campaign = await graph(`${act}/campaigns`, {
    method: 'POST',
    params: {
      name: title, objective: 'OUTCOME_ENGAGEMENT', status: 'ACTIVE', special_ad_categories: [],
      daily_budget: budget, bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
    },
    token: c.user_token,
  });

  try {
    const geo = cities.length ? { cities: cities.map((key) => ({ key, radius: 15, distance_unit: 'kilometer' })) } : { countries: ['IL'] };
    const placements = c.ig_user_id ? ['facebook', 'instagram'] : ['facebook'];
    const adset = await graph(`${act}/adsets`, {
      method: 'POST',
      params: {
        name: `${title} · קהל`, campaign_id: campaign.id, status: 'ACTIVE',
        billing_event: 'IMPRESSIONS', optimization_goal: 'POST_ENGAGEMENT', destination_type: 'ON_POST',
        end_time: end.toISOString(),
        targeting: { geo_locations: geo, age_min: Number(ageMin), age_max: Number(ageMax), publisher_platforms: placements },
      },
      token: c.user_token,
    });

    let creative;
    try {
      creative = await graph(`${act}/adcreatives`, {
        method: 'POST',
        params: { name: title, object_story_id: post.fb_post_id, ...(c.ig_user_id ? { instagram_user_id: c.ig_user_id } : {}) },
        token: c.user_token,
      });
    } catch {
      creative = await graph(`${act}/adcreatives`, { method: 'POST', params: { name: title, object_story_id: post.fb_post_id }, token: c.user_token });
    }

    await graph(`${act}/ads`, {
      method: 'POST',
      params: { name: title, adset_id: adset.id, creative: { creative_id: creative.id }, status: 'ACTIVE' },
      token: c.user_token,
    });
  } catch (e) {
    // לא משאירים קמפיין חצי-בנוי שעלול לחייב כסף.
    await graph(campaign.id, { method: 'DELETE', token: c.user_token }).catch(() => {});
    throw fail(e.message);
  }

  await db.from('social_posts').update({ boosted_campaign_id: campaign.id }).eq('id', postId);
  return { campaignId: campaign.id };
}

/** חיפוש עיר ל-targeting (למשל "חיפה") */
async function searchCities(db, q) {
  const c = await rpc(db, 'social_credentials');
  if (!c.user_token || !q) return { cities: [] };
  const r = await graph('search', { params: { type: 'adgeolocation', location_types: ['city'], country_code: 'IL', q, limit: 8 }, token: c.user_token });
  return { cities: (r.data || []).map((x) => ({ key: x.key, name: x.name, region: x.region })) };
}

/* ================================ handler ================================ */

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      if (req.query?.code || req.query?.error || req.query?.state) return await oauthCallback(req, res);
      res.status(200).json({ ok: true, service: 'iconair-social' });
      return;
    }
    if (req.method !== 'POST') throw fail('Method not allowed', 405);

    const body = req.body ?? {};
    if (body.action === 'cron') {
      res.status(200).json(await cron(body));
      return;
    }

    const db = await authorizeAdmin(req);
    let result;
    switch (body.action) {
      case 'status': result = await status(db); break;
      case 'oauth_start': result = await oauthStart(db, req); break;
      case 'redirect_uri': result = { redirectUri: redirectUri(req) }; break;
      case 'publish': result = { post: await publishNow(db, body.postId) }; break;
      case 'metrics': result = await refreshMetrics(db); break;
      case 'campaigns': result = await campaigns(db, body.preset); break;
      case 'campaign_update': result = await updateCampaign(db, body); break;
      case 'boost': result = await boostPost(db, body); break;
      case 'cities': result = await searchCities(db, body.q); break;
      default: throw fail('Unknown action');
    }
    res.status(200).json(result);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Server error' });
  }
}
