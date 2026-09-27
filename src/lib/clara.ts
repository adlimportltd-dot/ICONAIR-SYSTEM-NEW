/**
 * קלרה — שכבת הנתונים בצד הלקוח (phase46).
 *
 *  - clara_assets / clara_batches / clara_content / clara_messages → Supabase ישירות (RLS).
 *  - clara_settings → רק דרך RPC (clara_status / clara_save_settings). המפתח לא חוזר לדפדפן.
 *  - "מוח" (Claude), אישורים ותזמון → /api/clara (שרת, בשם מנהל מחובר).
 */
import { supabase as client } from './supabase';
import type { SupabaseClient } from '@supabase/supabase-js';

/** הלקוח המשותף יכול להיות null כש-Supabase לא מוגדר — כאן זה שגיאה ברורה */
const supabase = new Proxy({} as SupabaseClient, {
  get(_t, prop) {
    if (!client) throw new Error('Supabase לא מוגדר');
    const value = (client as unknown as Record<string | symbol, unknown>)[prop];
    return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(client) : value;
  },
});

/* ================================ טיפוסים ================================ */

export type ContentKind = 'reel' | 'post' | 'carousel';
export type ContentStatus = 'draft' | 'pending_approval' | 'approved' | 'scheduled' | 'published' | 'rejected' | 'failed';
export type ApproveWhen = 'best' | 'today' | 'now' | 'custom';

export interface ClaraAsset {
  id: string;
  created_at: string;
  created_by: string | null;
  storage_path: string;
  public_url: string;
  thumb_url: string | null;
  media_type: 'image' | 'video';
  mime_type: string | null;
  width: number | null;
  height: number | null;
  duration_sec: number | null;
  size_bytes: number | null;
  taken_at: string | null;
  customer_site_id: string | null;
  location_label: string | null;
  notes: string | null;
  tags: string[];
  analysis: { description?: string } | null;
  archived: boolean;
}

export interface Scene {
  asset_id: string;
  seconds: number;
  on_screen: string;
  voiceover: string;
}

export interface ClaraContent {
  id: string;
  created_at: string;
  updated_at: string;
  batch_id: string | null;
  kind: ContentKind;
  status: ContentStatus;
  title: string;
  hook: string;
  value_prop: string;
  cta: string;
  scenes: Scene[];
  voiceover: string;
  caption: string;
  hashtags: string[];
  asset_ids: string[];
  media_urls: string[];
  video_url: string | null;
  cover_url: string | null;
  render_error: string | null;
  platforms: string[];
  revision: number;
  change_request: string | null;
  scheduled_at: string | null;
  social_post_id: string | null;
  published_at: string | null;
}

export interface ClaraAction { id: string; label: string; kind?: 'primary' | 'secondary' }

export interface ClaraMessage {
  id: string;
  created_at: string;
  role: 'clara' | 'user';
  body: string;
  batch_id: string | null;
  content_ids: string[];
  actions: ClaraAction[];
  action_taken: string | null;
}

export interface ClaraBatch {
  id: string;
  created_at: string;
  asset_ids: string[];
  brief: string;
  status: 'queued' | 'generating' | 'ready' | 'failed';
  error: string | null;
}

export interface ClaraSettings {
  ai_configured: boolean;
  key_hint: string | null;
  model: string;
  brand_notes: string;
  max_posts_per_day: number;
  min_gap_hours: number;
}

export interface Site { id: string; label: string | null; city: string | null; customer?: { name: string } | null }

type Result<T> = { data: T | null; error: { message: string } | null };
const unwrap = <T,>({ data, error }: Result<T>): T => {
  if (error) throw error;
  return data as T;
};

/* ================================ קריאות ================================ */

export const CLARA_BUCKET = 'clara-assets';
export const CLARA_SQL_URL = 'https://raw.githubusercontent.com/adlimportltd-dot/ICONAIR-SYSTEM-NEW/main/iconair_schema_phase46_clara.sql';

export function isClaraSetupMissing(error: unknown): boolean {
  const text = String((error as { message?: string })?.message ?? error ?? '');
  return /clara_|PGRST20[25]|42P01|42883|Could not find the (table|function)/i.test(text);
}

export const getClaraSettings = () => supabase.rpc('clara_status').then(unwrap<ClaraSettings>);

export const saveClaraSettings = (s: { key?: string; model?: string; brandNotes?: string; maxPerDay?: number; minGap?: number }) =>
  supabase.rpc('clara_save_settings', {
    p_key: s.key ?? null,
    p_model: s.model ?? null,
    p_brand_notes: s.brandNotes ?? null,
    p_max_per_day: s.maxPerDay ?? null,
    p_min_gap: s.minGap ?? null,
  }).then(unwrap<null>);

export const listAssets = () =>
  supabase.from('clara_assets').select('*').eq('archived', false).order('created_at', { ascending: false }).limit(200).then(unwrap<ClaraAsset[]>);

export const updateAsset = (id: string, patch: Partial<Pick<ClaraAsset, 'notes' | 'location_label' | 'customer_site_id' | 'archived'>>) =>
  supabase.from('clara_assets').update(patch).eq('id', id).select().single().then(unwrap<ClaraAsset>);

export const listContent = () =>
  supabase.from('clara_content').select('*').neq('status', 'rejected').order('created_at', { ascending: false }).limit(120).then(unwrap<ClaraContent[]>);

export const listMessages = () =>
  supabase.from('clara_messages').select('*').order('created_at', { ascending: true }).limit(300).then(unwrap<ClaraMessage[]>);

export const listBatches = () =>
  supabase.from('clara_batches').select('id, created_at, asset_ids, brief, status, error').order('created_at', { ascending: false }).limit(30).then(unwrap<ClaraBatch[]>);

export const listSites = () =>
  supabase.from('customer_sites').select('id, label, city, customer:customers(name)').order('label').limit(1000)
    .then((r) => unwrap(r as unknown as Result<Site[]>));

export const markActionTaken = (messageId: string, actionId: string) =>
  supabase.from('clara_messages').update({ action_taken: actionId }).eq('id', messageId).then(unwrap<null>);

export const clearRenderError = (id: string) =>
  supabase.from('clara_content').update({ render_error: null }).eq('id', id).then(unwrap<null>);

export const sayToClara = (body: string, contentIds: string[] = []) =>
  supabase.from('clara_messages').insert({ role: 'user', body, content_ids: contentIds }).then(unwrap<null>);

/* ================================ העלאת נכסים ================================ */

export interface UploadMeta { takenAt?: string | null; siteId?: string | null; locationLabel?: string | null; notes?: string | null }

const loadImage = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = () => reject(new Error('לא הצלחתי לקרוא את התמונה'));
  img.src = src;
});

const toBlob = (canvas: HTMLCanvasElement, type = 'image/jpeg', q = 0.9) =>
  new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('שגיאת קידוד תמונה'))), type, q));

/** תמונה → JPEG עד 2160px (בלי חיתוך; הרינדור קובע את הפורמט הסופי) */
async function normalizeImage(file: File) {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const scale = Math.min(1, 2160 / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return { blob: await toBlob(canvas), width: canvas.width, height: canvas.height };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** סרטון → מטא-דאטה + פריים ראשון (Claude רואה תמונות, לא וידאו) */
async function videoInfo(file: File) {
  const url = URL.createObjectURL(file);
  try {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.src = url;
    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve();
      video.onerror = () => reject(new Error('לא הצלחתי לקרוא את הסרטון'));
    });
    video.currentTime = Math.min(0.5, (video.duration || 1) / 2);
    await new Promise<void>((resolve) => { video.onseeked = () => resolve(); });
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, 1280 / Math.max(video.videoWidth, video.videoHeight));
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    canvas.getContext('2d')!.drawImage(video, 0, 0, canvas.width, canvas.height);
    return { thumb: await toBlob(canvas, 'image/jpeg', 0.85), width: video.videoWidth, height: video.videoHeight, duration: video.duration };
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function putFile(path: string, body: Blob, contentType: string) {
  const { error } = await supabase.storage.from(CLARA_BUCKET).upload(path, body, { upsert: false, contentType });
  if (error) throw error;
  return supabase.storage.from(CLARA_BUCKET).getPublicUrl(path).data.publicUrl;
}

export async function uploadAsset(file: File, meta: UploadMeta = {}): Promise<ClaraAsset> {
  const { data: session } = await supabase.auth.getSession();
  const uid = session.session?.user.id;
  if (!uid) throw new Error('ההתחברות פגה — רענן את הדף');
  const month = new Date().toISOString().slice(0, 7);
  const id = crypto.randomUUID();
  const isVideo = file.type.startsWith('video/');
  if (!isVideo && !file.type.startsWith('image/')) throw new Error(`${file.name}: רק תמונות או סרטונים`);
  if (isVideo && file.size > 250 * 1024 * 1024) throw new Error(`${file.name}: סרטון גדול מ-250MB`);

  let row: Partial<ClaraAsset>;
  if (isVideo) {
    const info = await videoInfo(file);
    const ext = (file.name.split('.').pop() || 'mp4').toLowerCase();
    const path = `${uid}/${month}/${id}.${ext}`;
    const [publicUrl, thumbUrl] = await Promise.all([
      putFile(path, file, file.type || 'video/mp4'),
      putFile(`${uid}/${month}/${id}.thumb.jpg`, info.thumb, 'image/jpeg'),
    ]);
    row = { storage_path: path, public_url: publicUrl, thumb_url: thumbUrl, media_type: 'video', mime_type: file.type, width: info.width, height: info.height, duration_sec: Math.round(info.duration * 100) / 100, size_bytes: file.size };
  } else {
    const img = await normalizeImage(file);
    const path = `${uid}/${month}/${id}.jpg`;
    const publicUrl = await putFile(path, img.blob, 'image/jpeg');
    row = { storage_path: path, public_url: publicUrl, media_type: 'image', mime_type: 'image/jpeg', width: img.width, height: img.height, size_bytes: img.blob.size };
  }

  return supabase.from('clara_assets').insert({
    ...row,
    taken_at: meta.takenAt ?? new Date(file.lastModified || Date.now()).toISOString(),
    customer_site_id: meta.siteId ?? null,
    location_label: meta.locationLabel ?? null,
    notes: meta.notes ?? null,
  }).select().single().then(unwrap<ClaraAsset>);
}

/* ================================ /api/clara ================================ */

async function api<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('ההתחברות פגה — רענן את הדף');
  let res: Response;
  try {
    res = await fetch('/api/clara', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action, ...payload }),
    });
  } catch {
    throw new Error('אין חיבור לאינטרנט כרגע');
  }
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error || 'השרת לא זמין כרגע, נסה שוב בעוד רגע');
  return json as T;
}

export async function startBatch(assetIds: string[], brief: string, wanted = { reels: 2, posts: 1 }) {
  const batch = await supabase.from('clara_batches').insert({ asset_ids: assetIds, brief, wanted }).select('id').single().then(unwrap<{ id: string }>);
  await supabase.from('clara_messages').insert({
    role: 'user', batch_id: batch.id,
    body: `שלחתי ${assetIds.length} ${assetIds.length === 1 ? 'קובץ' : 'קבצים'}${brief ? ` — ${brief}` : ''}`,
  });
  await api('generate', { batchId: batch.id });
  return batch.id;
}

export const retryBatch = (batchId: string) => api('generate', { batchId });
export const reportRendered = (p: { contentId: string; videoUrl?: string; coverUrl?: string; mediaUrls?: string[]; error?: string }) => api('rendered', p);
export const reviseContent = (contentId: string, instructions: string) => api<{ visualChanged: boolean }>('revise', { contentId, instructions });
export const approveContent = (contentId: string, when: ApproveWhen, at?: string) => api<{ scheduledAt: string | null }>('approve', { contentId, when, at });
export const approveBatch = (batchId: string, when: 'best' | 'today') => api<{ approved: number }>('approve_batch', { batchId, when });
export const unscheduleContent = (contentId: string) => api('unschedule', { contentId });
export const rejectContent = (contentId: string) => api('reject', { contentId });
export const retryContent = (contentId: string) => api('retry', { contentId });

/* ================================ תצוגה ================================ */

export const STATUS_META: Record<ContentStatus, { label: string; tone: 'neutral' | 'gold' | 'teal' | 'ok' | 'crit' }> = {
  draft: { label: 'בהכנה', tone: 'neutral' },
  pending_approval: { label: 'ממתין לאישור', tone: 'gold' },
  approved: { label: 'אושר', tone: 'teal' },
  scheduled: { label: 'מתוזמן', tone: 'teal' },
  published: { label: 'פורסם', tone: 'ok' },
  rejected: { label: 'נדחה', tone: 'neutral' },
  failed: { label: 'נכשל', tone: 'crit' },
};

export const KIND_LABEL: Record<ContentKind, string> = { reel: 'רילז', post: 'פוסט', carousel: 'קרוסלה' };

export const reelSeconds = (c: Pick<ClaraContent, 'scenes'>) => Math.round(c.scenes.reduce((a, s) => a + s.seconds, 0) + 2);

export function toLocalDateTime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export const CLARA_MODELS = [
  { value: 'claude-sonnet-5', label: 'Claude Sonnet 5 — מהיר ומשתלם (מומלץ)' },
  { value: 'claude-opus-5-5', label: 'Claude Opus 5.5 — האיכות הגבוהה ביותר' },
  { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5 — הכי מהיר וזול' },
];
