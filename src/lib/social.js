/**
 * ניהול סושיאל (phase45) — שאילתות social_posts + קריאות ל-/api/social.
 *
 * קובץ נפרד מ-queries.js במכוון: כל הפיצ'ר יושב בקבצים משלו, בלי לגעת
 * בשאילתות הקיימות של לידים/מלאי/הצעות מחיר.
 *
 * הפרסום בפועל ל-Meta קורה רק דרך /api/social (Vercel), שמחזיק את הטוקן.
 * הדפדפן שולח רק את ה-JWT של המשתמש המחובר; השרת בודק is_admin().
 */
import { supabase } from './supabase';

const unwrap = ({ data, error }) => {
  if (error) throw error;
  return data;
};

export const SOCIAL_BUCKET = 'social-media';

export const listSocialPosts = () =>
  supabase.from('social_posts').select('*').order('created_at', { ascending: false }).limit(300).then(unwrap);

export const createSocialPost = (payload) =>
  supabase.from('social_posts').insert(payload).select().single().then(unwrap);

export const updateSocialPost = (id, patch) =>
  supabase.from('social_posts').update(patch).eq('id', id).select().single().then(unwrap);

export const deleteSocialPost = (id) => supabase.from('social_posts').delete().eq('id', id).then(unwrap);

/** מעלה תמונה ל-bucket הציבורי (Meta מושכת אותה מ-URL ציבורי) ומחזיר את הכתובת */
export async function uploadSocialImage(file) {
  const ext = ((file.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg')).toLowerCase();
  const path = `${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(SOCIAL_BUCKET).upload(path, file, { upsert: false, contentType: file.type });
  if (error) throw error;
  return supabase.storage.from(SOCIAL_BUCKET).getPublicUrl(path).data.publicUrl;
}

async function callSocialApi(action, payload = {}) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('לא מחובר');

  let res;
  try {
    res = await fetch('/api/social', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action, ...payload }),
    });
  } catch {
    throw new Error('אין חיבור לשרת הפרסום');
  }

  const json = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 404 || !json) throw new Error('שרת הפרסום (/api/social) לא זמין — הוא רץ רק בגרסה שעלתה ל-Vercel');
    throw new Error(json.error || `שגיאה ${res.status}`);
  }
  return json;
}

export const getSocialStatus = () => callSocialApi('status');
export const publishSocialPost = (postId) => callSocialApi('publish', { postId }).then((r) => r.post);
export const unscheduleSocialPost = (postId) => callSocialApi('unschedule', { postId }).then((r) => r.post);
export const listMetaCampaigns = () => callSocialApi('campaigns');

/* ---------------------------- עזרי תצוגה ---------------------------- */

export const PLATFORM_LABEL = { facebook: 'פייסבוק', instagram: 'אינסטגרם' };

/**
 * מצב כולל של פוסט — מחושב מהסטטוסים של כל פלטפורמה, לא עמודה נפרדת
 * (כדי שלא יהיו שני מקורות אמת שיכולים לסתור).
 */
export function postState(post) {
  const statuses = [post.fb_status, post.ig_status].filter(Boolean);
  if (post.is_draft) return 'draft';
  if (statuses.some((s) => s === 'failed')) return 'failed';
  if (statuses.every((s) => s === 'published')) return 'published';
  return 'scheduled';
}

export const POST_STATE = {
  draft: { label: 'טיוטה', tone: 'neutral' },
  scheduled: { label: 'מתוזמן', tone: 'gold' },
  published: { label: 'פורסם', tone: 'ok' },
  failed: { label: 'נכשל', tone: 'crit' },
};

export const PLATFORM_STATUS = {
  pending: { label: 'ממתין', tone: 'gold' },
  scheduled: { label: 'מתוזמן אצל Meta', tone: 'teal' },
  published: { label: 'פורסם', tone: 'ok' },
  failed: { label: 'נכשל', tone: 'crit' },
};

/** פוסט שהגיע זמנו ועדיין לא פורסם בפלטפורמה כלשהי (ממתין אצלנו, לא אצל Meta) */
export function isDue(post, now = Date.now()) {
  if (post.is_draft) return false;
  const waiting = post.fb_status === 'pending' || post.ig_status === 'pending';
  if (!waiting) return false;
  return !post.scheduled_at || new Date(post.scheduled_at).getTime() <= now;
}

/** Date → ערך ל-<input type="datetime-local"> בזמן המקומי */
export function toLocalInput(value) {
  if (!value) return '';
  const d = new Date(value);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export const CAMPAIGN_STATUS = {
  ACTIVE: { label: 'פעיל', tone: 'ok' },
  PAUSED: { label: 'מושהה', tone: 'neutral' },
  CAMPAIGN_PAUSED: { label: 'מושהה', tone: 'neutral' },
  IN_PROCESS: { label: 'בעיבוד', tone: 'gold' },
  WITH_ISSUES: { label: 'עם בעיות', tone: 'crit' },
  ARCHIVED: { label: 'בארכיון', tone: 'neutral' },
  DELETED: { label: 'נמחק', tone: 'neutral' },
};
