/**
 * סטודיו רילז — שכבת הנתונים בצד הלקוח (phase48).
 *
 *  תמונות → social-media bucket  →  /api/reel-studio (תסריט, כתוביות, קפשן)
 *  → renderReel בדפדפן (MP4 9:16 + סאונד) → social_posts (media_kind='reel')
 *  → שיגור מיידי דרך /api/social או תזמון ל-Autopilot.
 */
import { supabase as client } from './supabase';
import type { SupabaseClient } from '@supabase/supabase-js';
import { publishSocialPost, SOCIAL_BUCKET } from './social';
import { renderReel } from './reelRenderer';
import { buildSoundtrack } from './soundtrack';
import { brandLogoUrl } from './queries';

const supabase = new Proxy({} as SupabaseClient, {
  get(_t, prop) {
    if (!client) throw new Error('Supabase לא מוגדר');
    const value = (client as unknown as Record<string | symbol, unknown>)[prop];
    return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(client) : value;
  },
});

type Result<T> = { data: T | null; error: { message: string } | null };
const unwrap = <T,>({ data, error }: Result<T>): T => {
  if (error) throw error;
  return data as T;
};

/* ================================ טיפוסים ================================ */

export interface ReelScene { image_index: number; seconds: number; subtitle: string }
export interface ReelScript {
  title: string;
  hook: string;
  value: string;
  cta: string;
  scenes: ReelScene[];
  caption: string;
  hashtags: string[];
}
export type ReelTone = 'warm' | 'energetic' | 'luxury';

export interface StudioImage { url: string; name: string; width: number; height: number }

export interface ScentProduct {
  id: string; name: string; active: boolean;
  description: string | null; notes_top: string | null; notes_heart: string | null; notes_base: string | null;
  mood: string | null; best_for: string | null;
}
export interface ModelProduct {
  id: string; name: string; active: boolean; capacity_ml: number | null;
  description: string | null; coverage_m2: number | null; features: string | null; best_for: string | null;
}
export interface Products { scents: ScentProduct[]; models: ModelProduct[] }
export type ScentProfile = Partial<Pick<ScentProduct, 'description' | 'notes_top' | 'notes_heart' | 'notes_base' | 'mood' | 'best_for'>>;
export type ModelProfile = Partial<Pick<ModelProduct, 'description' | 'coverage_m2' | 'features' | 'best_for'>>;

export interface RenderedReel { videoUrl: string; coverUrl: string; seconds: number; localUrl: string }

export const STUDIO_SQL_URL = 'https://raw.githubusercontent.com/adlimportltd-dot/ICONAIR-SYSTEM-NEW/main/iconair_schema_phase48_reel_studio.sql';

export const TONES: { value: ReelTone; label: string }[] = [
  { value: 'warm', label: 'חם ואישי' },
  { value: 'energetic', label: 'אנרגטי' },
  { value: 'luxury', label: 'יוקרתי' },
];

export const END_CARD_SECONDS = 2.2;
export const reelLength = (s: Pick<ReelScript, 'scenes'>) => s.scenes.reduce((a, x) => a + x.seconds, 0) + END_CARD_SECONDS;
export const fullCaption = (s: Pick<ReelScript, 'caption' | 'hashtags'>) => [s.caption.trim(), s.hashtags.join(' ')].filter(Boolean).join('\n\n');

/** פרופיל המוצרים חסר = phase48 עוד לא הורץ */
export function isStudioSetupMissing(error: unknown): boolean {
  const text = String((error as { message?: string })?.message ?? error ?? '');
  return /42703|PGRST204|column .* does not exist|Could not find the '.*' column/i.test(text);
}

/* ================================ העלאה ================================ */

const loadImage = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = () => reject(new Error('לא הצלחתי לקרוא את התמונה'));
  img.src = src;
});

async function putFile(path: string, body: Blob, contentType: string): Promise<string> {
  const { error } = await supabase.storage.from(SOCIAL_BUCKET).upload(path, body, { upsert: false, contentType });
  if (error) throw error;
  return supabase.storage.from(SOCIAL_BUCKET).getPublicUrl(path).data.publicUrl;
}

const month = () => new Date().toISOString().slice(0, 7);

/** תמונה → JPEG עד 2160px (איכות מלאה לרילז) → Storage */
export async function uploadStudioImage(file: File): Promise<StudioImage> {
  if (!file.type.startsWith('image/')) throw new Error('רק תמונות');
  if (file.size > 40 * 1024 * 1024) throw new Error('תמונה גדולה מ-40MB');
  const local = URL.createObjectURL(file);
  try {
    const img = await loadImage(local);
    const scale = Math.min(1, 2160 / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('המרת התמונה נכשלה'))), 'image/jpeg', 0.9));
    const url = await putFile(`reels/src/${month()}/${crypto.randomUUID()}.jpg`, blob, 'image/jpeg');
    return { url, name: file.name, width: canvas.width, height: canvas.height };
  } finally {
    URL.revokeObjectURL(local);
  }
}

const AUDIO_EXT = /\.(mp3|m4a|aac|wav|ogg)$/i;

/** קובץ מוזיקה (עד 15MB) → URL ציבורי לפסקול */
export async function uploadMusic(file: File): Promise<string> {
  if (!file.type.startsWith('audio/') && !AUDIO_EXT.test(file.name)) throw new Error('צריך קובץ שמע (MP3, M4A, WAV)');
  if (file.size > 15 * 1024 * 1024) throw new Error('קובץ המוזיקה גדול מ-15MB');
  const ext = (file.name.match(AUDIO_EXT)?.[1] || 'mp3').toLowerCase();
  return putFile(`reels/music/${crypto.randomUUID()}.${ext}`, file, file.type || 'audio/mpeg');
}

/* ================================ קטלוג ================================ */

const SCENT_COLS = 'id, name, active, description, notes_top, notes_heart, notes_base, mood, best_for';
const MODEL_COLS = 'id, name, active, capacity_ml, description, coverage_m2, features, best_for';

export async function listProducts(): Promise<Products> {
  const [scents, models] = await Promise.all([
    supabase.from('scents').select(SCENT_COLS).eq('active', true).order('name').then(unwrap<ScentProduct[]>),
    supabase.from('device_models').select(MODEL_COLS).eq('active', true).order('name').then(unwrap<ModelProduct[]>),
  ]);
  return { scents: scents ?? [], models: models ?? [] };
}

const clean = (p: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(p).map(([k, v]) => [k, typeof v === 'string' ? (v.trim() || null) : v]));

export const saveScentProfile = (id: string, p: ScentProfile) =>
  supabase.from('scents').update(clean(p)).eq('id', id).select(SCENT_COLS).single().then(unwrap<ScentProduct>);

export const saveModelProfile = (id: string, p: ModelProfile) =>
  supabase.from('device_models').update(clean(p)).eq('id', id).select(MODEL_COLS).single().then(unwrap<ModelProduct>);

export const hasProfile = (p: ScentProduct | ModelProduct) =>
  'notes_top' in p ? Boolean(p.description || p.notes_top || p.notes_heart || p.notes_base) : Boolean(p.description || p.features || p.coverage_m2);

/* ================================ מחולל (שרת) ================================ */

export interface GenerateInput {
  images: string[];
  scentIds: string[];
  modelIds: string[];
  notes: string;
  tone: ReelTone;
  /** שכתוב: הגרסה הנוכחית + מה לשנות */
  previous?: ReelScript;
  instructions?: string;
}

export async function generateScript(input: GenerateInput): Promise<ReelScript> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('ההתחברות פגה — רענן את הדף');
  let res: Response;
  try {
    res = await fetch('/api/reel-studio', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action: 'generate', ...input }),
    });
  } catch {
    throw new Error('אין חיבור לאינטרנט כרגע');
  }
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error || 'השרת לא זמין כרגע, נסה שוב בעוד רגע');
  return json as ReelScript;
}

/* ================================ רינדור ================================ */

export async function renderStudioReel(opts: {
  script: ReelScript;
  images: StudioImage[];
  soundtrack: string;
  onProgress: (p: number) => void;
}): Promise<RenderedReel> {
  const scenes = opts.script.scenes
    .filter((s) => opts.images[s.image_index])
    .map((s) => ({ url: opts.images[s.image_index].url, type: 'image' as const, seconds: s.seconds, onScreen: s.subtitle }));
  if (!scenes.length) throw new Error('אין סצנות לרינדור');
  const seconds = scenes.reduce((a, s) => a + s.seconds, 0) + END_CARD_SECONDS;
  // סאונד שנכשל (קובץ פגום/חסום) לא מפיל את הסרטון — ממשיכים בשקט
  const audio = await buildSoundtrack(opts.soundtrack, seconds + 0.5).catch(() => null);
  const out = await renderReel({ scenes, cta: opts.script.cta, logoUrl: brandLogoUrl('png'), audio, onProgress: opts.onProgress });
  const id = crypto.randomUUID();
  const [videoUrl, coverUrl] = await Promise.all([
    putFile(`reels/${month()}/${id}.mp4`, out.video, 'video/mp4'),
    putFile(`reels/${month()}/${id}.jpg`, out.cover, 'image/jpeg'),
  ]);
  return { videoUrl, coverUrl, seconds: out.seconds, localUrl: URL.createObjectURL(out.video) };
}

/* ================================ שיגור ================================ */

interface PublishedPost { id: string; fb_status: string | null; ig_status: string | null; fb_error: string | null; ig_error: string | null }

export interface LaunchInput {
  reel: RenderedReel;
  caption: string;
  facebook: boolean;
  instagram: boolean;
  /** null = עכשיו */
  scheduledAt: string | null;
}

export type LaunchResult = 'published' | 'processing' | 'scheduled';

/**
 * שגר לרשתות: שורה ב-social_posts + פרסום מיידי דרך /api/social.
 * עם מועד — נכנס לתור ה-Autopilot. רילז באינסטגרם: Meta מעבדת את הסרטון,
 * וה-Autopilot משלים את הפרסום כשהעיבוד מסתיים (בד"כ 1–3 דקות).
 */
export async function launchReel(input: LaunchInput): Promise<LaunchResult> {
  if (!input.facebook && !input.instagram) throw new Error('בחר לפחות רשת אחת');
  const now = input.scheduledAt === null;
  const row = await supabase.from('social_posts').insert({
    caption: input.caption,
    media_urls: [],
    media_kind: 'reel',
    video_url: input.reel.videoUrl,
    cover_url: input.reel.coverUrl,
    source: 'studio',
    // "עכשיו" נשמר כטיוטה ומפורסם מיד מכאן — כך ה-Autopilot לא תופס אותו במקביל
    is_draft: now,
    scheduled_at: input.scheduledAt,
    fb_status: input.facebook ? 'pending' : null,
    ig_status: input.instagram ? 'pending' : null,
  }).select('id').single().then(unwrap<{ id: string }>);

  if (!now) return 'scheduled';
  const post: PublishedPost = await publishSocialPost(row.id);
  if ((!post.fb_status || post.fb_status === 'failed') && (!post.ig_status || post.ig_status === 'failed')) {
    throw new Error([post.fb_error, post.ig_error].filter(Boolean).join(' · ') || 'הפרסום נכשל');
  }
  return post.fb_status === 'pending' || post.ig_status === 'pending' ? 'processing' : 'published';
}
