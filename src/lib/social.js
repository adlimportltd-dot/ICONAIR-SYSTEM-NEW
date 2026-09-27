/**
 * ניהול סושיאל וקמפיינים (phase45) — שכבת הנתונים של הטאב.
 *
 * קובץ נפרד מ-queries.js במכוון: כל הפיצ'ר חי בקבצים משלו, בלי לגעת
 * בשאילתות הקיימות של לידים/מלאי/הצעות מחיר.
 *
 *  - social_posts       — ישירות דרך Supabase (RLS: מנהלים בלבד).
 *  - social_settings    — רק דרך RPC (social_status / social_save_app / ...).
 *  - Meta Graph API     — רק דרך /api/social (הטוקנים לעולם לא בדפדפן).
 */
import { supabase } from './supabase';

const unwrap = ({ data, error }) => {
  if (error) throw error;
  return data;
};

export const SOCIAL_BUCKET = 'social-media';
export const SQL_FILE_URL = 'https://raw.githubusercontent.com/adlimportltd-dot/ICONAIR-SYSTEM-NEW/main/iconair_schema_phase45_social.sql';

/** האם השגיאה אומרת "הטבלאות/פונקציות עוד לא הוקמו ב-Supabase" */
export function isSetupMissing(error) {
  const text = String(error?.message || error || '');
  return /social_(posts|settings|status)|PGRST20[25]|42P01|42883|does not exist|Could not find the (table|function)/i.test(text);
}

/* ============================== פוסטים ============================== */

export const listSocialPosts = () =>
  supabase.from('social_posts').select('*').order('created_at', { ascending: false }).limit(500).then(unwrap);

export const createSocialPost = (payload) => supabase.from('social_posts').insert(payload).select().single().then(unwrap);
export const updateSocialPost = (id, patch) => supabase.from('social_posts').update(patch).eq('id', id).select().single().then(unwrap);
export const deleteSocialPost = (id) => supabase.from('social_posts').delete().eq('id', id).then(unwrap);

/* ============================== הגדרות / חיבור ============================== */

export const getSocialSettings = () => supabase.rpc('social_status').then(unwrap);
export const saveMetaApp = (appId, appSecret) => supabase.rpc('social_save_app', { p_app_id: appId, p_app_secret: appSecret }).then(unwrap);
export const selectMetaAssets = (pageId, adAccountId) =>
  supabase.rpc('social_select_assets', { p_page_id: pageId ?? null, p_ad_account_id: adAccountId ?? null }).then(unwrap);
export const disconnectMeta = () => supabase.rpc('social_disconnect').then(unwrap);

/* ============================== /api/social ============================== */

async function api(action, payload = {}) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('ההתחברות פגה — רענן את הדף');

  let res;
  try {
    res = await fetch('/api/social', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action, ...payload }),
    });
  } catch {
    throw new Error('אין חיבור לאינטרנט כרגע');
  }
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error || 'השרת לא זמין כרגע, נסה שוב בעוד רגע');
  return json;
}

export const getMetaLive = () => api('status');
export const startMetaOAuth = () => api('oauth_start').then((r) => r.url);
export const getRedirectUri = () => api('redirect_uri').then((r) => r.redirectUri);
export const publishSocialPost = (postId) => api('publish', { postId }).then((r) => r.post);
export const refreshSocialMetrics = () => api('metrics');
export const listMetaCampaigns = (preset) => api('campaigns', { preset });
export const updateMetaCampaign = (campaignId, patch) => api('campaign_update', { campaignId, ...patch });
export const boostSocialPost = (payload) => api('boost', payload);
export const searchMetaCities = (q) => api('cities', { q }).then((r) => r.cities);

/* ============================== לידים (טבלה קיימת) ============================== */

/** לידים מ-90 הימים האחרונים — לקריאה בלבד, בשביל ניתוח עלות-לליד מול הקמפיינים */
export const listRecentLeads = () => {
  const since = new Date(Date.now() - 90 * 86400000).toISOString();
  return supabase.from('leads').select('id, created_at, status, full_name, city').gte('created_at', since)
    .order('created_at', { ascending: false }).then(unwrap);
};

/* ============================== מדיה ============================== */

/**
 * מכין תמונה לפרסום: JPEG (הפורמט היחיד שאינסטגרם מקבל), עד 1440px,
 * ויחס גובה-רוחב בטווח שאינסטגרם מקבל (4:5 עד 1.91:1) — תמונה שחורגת
 * מקבלת שוליים לבנים במקום להיכשל אצל Meta. כך "שגיאת יחס/פורמט" לא
 * יכולה לקרות בכלל.
 */
export async function prepareImage(fileOrBlob) {
  const url = URL.createObjectURL(fileOrBlob);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('הקובץ שנבחר אינו תמונה תקינה'));
      el.src = url;
    });
    const scale = Math.min(1, 1440 / Math.max(img.naturalWidth, img.naturalHeight));
    let w = Math.round(img.naturalWidth * scale);
    let h = Math.round(img.naturalHeight * scale);
    let cw = w;
    let ch = h;
    const ratio = w / h;
    if (ratio < 0.8) cw = Math.round(h * 0.8);
    if (ratio > 1.91) ch = Math.round(w / 1.91);

    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, cw, ch);
    ctx.drawImage(img, Math.round((cw - w) / 2), Math.round((ch - h) / 2), w, h);
    return await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function uploadSocialImage(fileOrBlob) {
  const blob = await prepareImage(fileOrBlob);
  const path = `${new Date().toISOString().slice(0, 7)}/${crypto.randomUUID()}.jpg`;
  const { error } = await supabase.storage.from(SOCIAL_BUCKET).upload(path, blob, { upsert: false, contentType: 'image/jpeg' });
  if (error) throw error;
  return supabase.storage.from(SOCIAL_BUCKET).getPublicUrl(path).data.publicUrl;
}

/* ============================== עזרי תצוגה ============================== */

export const IG_CAPTION_LIMIT = 2200;

/** מצב כולל של פוסט — נגזר מהסטטוסים של כל פלטפורמה (מקור אמת אחד) */
export function postState(post) {
  if (post.is_draft) return 'draft';
  const statuses = [post.fb_status, post.ig_status].filter(Boolean);
  if (statuses.some((s) => s === 'failed')) return 'failed';
  if (statuses.every((s) => s === 'published')) return 'published';
  if (post.scheduled_at && new Date(post.scheduled_at) > new Date()) return 'scheduled';
  return 'publishing';
}

export const POST_STATE = {
  draft: { label: 'טיוטה', tone: 'neutral' },
  scheduled: { label: 'מתוזמן', tone: 'gold' },
  publishing: { label: 'בתור לפרסום', tone: 'teal' },
  published: { label: 'פורסם', tone: 'ok' },
  failed: { label: 'דורש טיפול', tone: 'crit' },
};

export const PLATFORM_STATUS = {
  pending: { label: 'ממתין', tone: 'gold' },
  published: { label: 'פורסם', tone: 'ok' },
  failed: { label: 'נכשל', tone: 'crit' },
};

/** סך מעורבות של פוסט (לייקים/תגובות/שיתופים/שמירות) משתי הפלטפורמות */
export function engagementOf(post) {
  const fb = post.fb_metrics || {};
  const ig = post.ig_metrics || {};
  return (fb.reactions || 0) + (fb.comments || 0) + (fb.shares || 0)
    + (ig.likes || 0) + (ig.comments || 0) + (ig.saved || 0) + (ig.shares || 0);
}
export const reachOf = (post) => (post.fb_metrics?.reach || 0) + (post.ig_metrics?.reach || 0);

export const CAMPAIGN_STATUS = {
  ACTIVE: { label: 'פעיל', tone: 'ok' },
  PAUSED: { label: 'מושהה', tone: 'neutral' },
  CAMPAIGN_PAUSED: { label: 'מושהה', tone: 'neutral' },
  ADSET_PAUSED: { label: 'מושהה', tone: 'neutral' },
  IN_PROCESS: { label: 'בעיבוד', tone: 'gold' },
  PENDING_REVIEW: { label: 'בבדיקת Meta', tone: 'gold' },
  WITH_ISSUES: { label: 'עם בעיות', tone: 'crit' },
  DISAPPROVED: { label: 'נדחה', tone: 'crit' },
};

export const OBJECTIVE_LABEL = {
  OUTCOME_LEADS: 'לידים', OUTCOME_ENGAGEMENT: 'מעורבות', OUTCOME_TRAFFIC: 'תנועה', OUTCOME_AWARENESS: 'מודעות',
  OUTCOME_SALES: 'מכירות', OUTCOME_APP_PROMOTION: 'אפליקציה', LEAD_GENERATION: 'לידים', LINK_CLICKS: 'תנועה',
  POST_ENGAGEMENT: 'מעורבות', CONVERSIONS: 'המרות', REACH: 'חשיפה', BRAND_AWARENESS: 'מודעות', MESSAGES: 'הודעות',
};

export const HASHTAG_SETS = [
  { label: 'מותג', tags: '#ICONAIR #אייקוןאייר' },
  { label: 'עסקים', tags: '#ריחלעסק #מפיציריח #חווייתלקוח #עסקיםבישראל' },
  { label: 'בית', tags: '#ריחלבית #עיצובהבית #ניחוח' },
  { label: 'רכב', tags: '#ריחלרכב #מפיץריחלרכב' },
];

/** שעות פרסום מומלצות (הרגלי גלישה נפוצים בישראל — הצעה, לא חוק) */
export const SUGGESTED_TIMES = ['09:00', '12:30', '17:00', '20:30'];

export function toLocalInput(value) {
  if (!value) return '';
  const d = new Date(value);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export const money = (v, currency = 'ILS') =>
  v == null ? '—' : new Intl.NumberFormat('he-IL', { style: 'currency', currency, minimumFractionDigits: 0, maximumFractionDigits: v < 100 && v % 1 ? 2 : 0 }).format(v);
export const num = (v) => (v == null ? '—' : Number(v).toLocaleString('he-IL'));
export const compact = (v) => (v == null ? '—' : new Intl.NumberFormat('he-IL', { notation: 'compact', maximumFractionDigits: 1 }).format(v));
