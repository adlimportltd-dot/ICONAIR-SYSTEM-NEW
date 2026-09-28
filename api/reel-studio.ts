// /api/reel-studio — מחולל תסריט רילז, כתוביות וקפשן (Vercel Serverless, TypeScript).
//
// קלט: תמונות (URL ציבורי מ-Supabase Storage) + מוצרים מהקטלוג + הערות.
// פלט: הוק, סצנות (תמונה + כתובית + שניות), הנעה לפעולה, קפשן והאשטגים.
// אין שמירה ב-DB — הדפדפן מרנדר את הרילז ושומר אותו ב-social_posts.
//
// הרשאות: מנהל מחובר בלבד (JWT של Supabase + is_admin()).
// מודל: ANTHROPIC_API_KEY במשתני הסביבה של Vercel (לא בדפדפן ולא ב-DB).
// REEL_STUDIO_MODEL אופציונלי (ברירת מחדל claude-sonnet-5).

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const config = { maxDuration: 60 };

/* ================================ טיפוסים ================================ */

interface Req { method?: string; headers: Record<string, string | string[] | undefined>; body?: Record<string, unknown> }
interface Res { status(code: number): Res; json(body: unknown): void }

class HttpError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

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

interface GenerateInput {
  images: string[];
  scentIds?: string[];
  modelIds?: string[];
  notes?: string;
  tone?: 'warm' | 'energetic' | 'luxury';
  instructions?: string;
  previous?: ReelScript;
}

interface ScentProfile { name: string; description: string | null; notes_top: string | null; notes_heart: string | null; notes_base: string | null; mood: string | null; best_for: string | null }
interface ModelProfile { name: string; description: string | null; coverage_m2: number | null; features: string | null; best_for: string | null }

/* ================================ סביבה והרשאות ================================ */

const env = (k: string): string => (process.env[k] || '').trim();

async function authorizeAdmin(req: Req): Promise<SupabaseClient> {
  const url = env('VITE_SUPABASE_URL') || env('SUPABASE_URL');
  const anon = env('VITE_SUPABASE_ANON_KEY') || env('SUPABASE_ANON_KEY');
  if (!url || !anon) throw new HttpError('Supabase לא מוגדר בשרת', 500);
  const header = req.headers.authorization;
  const jwt = String(Array.isArray(header) ? header[0] : header || '').replace(/^Bearer\s+/i, '');
  if (!jwt) throw new HttpError('לא מחובר', 401);
  const db = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const [{ data: isAdmin, error }, { data: user }] = await Promise.all([db.rpc('is_admin'), db.auth.getUser(jwt)]);
  if (error || !user?.user) throw new HttpError('ההתחברות פגה — רענן את הדף', 401);
  if (!isAdmin) throw new HttpError('פעולה למנהלים בלבד', 403);
  return db;
}

/** רק תמונות מה-Storage שלנו — לא שולחים למודל כתובות שרירותיות */
function assertOwnImages(images: unknown): string[] {
  const host = (() => { try { return new URL(env('VITE_SUPABASE_URL') || env('SUPABASE_URL')).host; } catch { return ''; } })();
  if (!Array.isArray(images) || images.length === 0) throw new HttpError('צריך לפחות תמונה אחת');
  if (images.length > 10) throw new HttpError('עד 10 תמונות לרילז');
  return images.map((u) => {
    let parsed: URL;
    try { parsed = new URL(String(u)); } catch { throw new HttpError('כתובת תמונה לא תקינה'); }
    if (parsed.protocol !== 'https:' || parsed.host !== host || !parsed.pathname.startsWith('/storage/v1/object/public/')) {
      throw new HttpError('התמונות חייבות להיות מהאחסון של המערכת');
    }
    return parsed.href;
  });
}

/* ================================ Sentry (בלי SDK) ================================ */

async function reportToSentry(error: unknown, extra: Record<string, unknown>): Promise<void> {
  const dsn = env('VITE_SENTRY_DSN') || env('SENTRY_DSN');
  if (!dsn) return;
  try {
    const u = new URL(dsn);
    const eventId = crypto.randomUUID().replace(/-/g, '');
    const err = error instanceof Error ? error : new Error(String(error));
    const event = {
      event_id: eventId, timestamp: Date.now() / 1000, platform: 'node', level: 'error',
      server_name: 'vercel:/api/reel-studio', tags: { area: 'reel-studio' }, extra,
      exception: { values: [{ type: err.name, value: err.message }] },
    };
    await fetch(`${u.protocol}//${u.host}/api/${u.pathname.replace(/\//g, '')}/envelope/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-sentry-envelope',
        'X-Sentry-Auth': `Sentry sentry_version=7, sentry_key=${u.username}, sentry_client=iconair-reel-studio/1.0`,
      },
      body: `${JSON.stringify({ event_id: eventId, dsn })}\n${JSON.stringify({ type: 'event' })}\n${JSON.stringify(event)}`,
    });
  } catch { /* ניטור לא מפיל את הבקשה */ }
}

/* ================================ קטלוג ================================ */

async function loadProducts(db: SupabaseClient, scentIds: string[], modelIds: string[]) {
  const [s, m] = await Promise.all([
    scentIds.length
      ? db.from('scents').select('name, description, notes_top, notes_heart, notes_base, mood, best_for').in('id', scentIds)
      : Promise.resolve({ data: [], error: null }),
    modelIds.length
      ? db.from('device_models').select('name, description, coverage_m2, features, best_for').in('id', modelIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (s.error || m.error) throw new HttpError('פרופיל המוצרים לא זמין — הרץ את קוד ה-SQL של סטודיו הרילז (phase48)', 500);
  return { scents: (s.data ?? []) as ScentProfile[], models: (m.data ?? []) as ModelProfile[] };
}

function productText(p: { scents: ScentProfile[]; models: ModelProfile[] }): string {
  if (!p.scents.length && !p.models.length) return '';
  const line = (label: string, v: string | number | null) => (v ? `  - ${label}: ${v}` : '');
  const out = ['מוצרים מהקטלוג — העובדות היחידות שמותר לכתוב עליהם (שדה חסר = לא להזכיר):'];
  for (const s of p.scents) {
    out.push(`• ריח "${s.name}"`, line('תיאור', s.description), line('תווי ראש', s.notes_top), line('תווי לב', s.notes_heart),
      line('תווי בסיס', s.notes_base), line('אווירה', s.mood), line('מתאים ל', s.best_for));
  }
  for (const m of p.models) {
    out.push(`• מכשיר ${m.name}`, line('תיאור', m.description), line('כיסוי עד', m.coverage_m2 ? `${m.coverage_m2} מ"ר` : null),
      line('יכולות', m.features), line('מתאים ל', m.best_for));
  }
  out.push('שלב את שם הריח/הדגם בכתובית אחת לפחות ובקפשן.');
  return out.filter(Boolean).join('\n');
}

/* ================================ המודל ================================ */

const SYSTEM = `
אתה קופירייטר סושיאל בכיר של ICONAIR (אייקון אייר בע"מ) — מפיצי ריח חכמים לעסקים ולבית בישראל.
המותג נכתב תמיד ICONAIR.

עובדות קבועות: מפיצי ריח חשמליים ותמציות ריח; התקנה, מילוי ותחזוקה ע"י טכנאים; משלוחים לכל הארץ (3–7 ימי עסקים);
אתר iconair.co.il; טלפון/וואטסאפ 055-915-8248.

כללים:
- עברית ישראלית טבעית ומדוברת, לא תרגומית. בלי קלישאות.
- אסור להמציא מחירים, הנחות, לקוחות, נתונים או תכונות מוצר שלא הופיעו בקלט.
- תאר רק מה שבאמת רואים בתמונות.
- רילז 8–18 שניות: הוק חזק בסצנה הראשונה → ערך אחד ברור → הנעה לפעולה אחת.
- כתוביות: עד 6 מילים לסצנה, נקראות מהר.
- 6–12 האשטגים רלוונטיים; תמיד לכלול #אייקוןאייר #מפיציריח #בישוםחלל.
- 0–3 אימוג'ים בקפשן.
`.trim();

const TONES: Record<NonNullable<GenerateInput['tone']>, string> = {
  warm: 'טון חם ואישי',
  energetic: 'טון אנרגטי וקליל',
  luxury: 'טון יוקרתי ומאופק',
};

const TOOL = {
  name: 'deliver_reel',
  description: 'החזרת תסריט הרילז, הכתוביות והקפשן',
  input_schema: {
    type: 'object',
    required: ['title', 'hook', 'value', 'cta', 'scenes', 'caption', 'hashtags'],
    properties: {
      title: { type: 'string', description: 'שם פנימי קצר (עד 5 מילים)' },
      hook: { type: 'string', description: 'משפט הפתיחה (עד 8 מילים)' },
      value: { type: 'string', description: 'הערך המרכזי במשפט אחד' },
      cta: { type: 'string', description: 'הנעה לפעולה למסך הסיום (עד 6 מילים)' },
      scenes: {
        type: 'array',
        minItems: 2,
        maxItems: 7,
        items: {
          type: 'object',
          required: ['image_index', 'seconds', 'subtitle'],
          properties: {
            image_index: { type: 'integer', description: 'אינדקס התמונה (מתחיל ב-0)' },
            seconds: { type: 'number', minimum: 1.5, maximum: 4.5 },
            subtitle: { type: 'string', description: 'כתובית על המסך, עד 6 מילים. הראשונה = ההוק' },
          },
        },
      },
      caption: { type: 'string', description: 'קפשן לפוסט, עם שורות, בלי האשטגים' },
      hashtags: { type: 'array', items: { type: 'string' } },
    },
  },
} as const;

function friendlyModelError(status: number, body: { error?: { type?: string; message?: string } }): string {
  if (status === 401) return 'מפתח המודל בשרת לא תקין (ANTHROPIC_API_KEY ב-Vercel)';
  if (status === 404) return 'המודל שהוגדר בשרת לא קיים (REEL_STUDIO_MODEL)';
  if (status === 400 && /credit|balance|billing/i.test(body?.error?.message || '')) return 'נגמרה היתרה בחשבון המודל — יש לטעון קרדיט';
  if (status === 429) return 'יותר מדי בקשות כרגע — נסה שוב בעוד דקה';
  if (status >= 500) return 'שירות המודל עמוס כרגע — נסה שוב בעוד רגע';
  return body?.error?.message || `שגיאה מהמודל (${status})`;
}

async function callModel(content: unknown[]): Promise<ReelScript> {
  const key = env('ANTHROPIC_API_KEY');
  if (!key) throw new HttpError('מחולל הרילז עוד לא הופעל בשרת — חסר ANTHROPIC_API_KEY במשתני הסביבה של Vercel', 503);
  const payload = {
    model: env('REEL_STUDIO_MODEL') || 'claude-sonnet-5',
    max_tokens: 2048,
    system: SYSTEM,
    tools: [TOOL],
    tool_choice: { type: 'tool', name: TOOL.name },
    messages: [{ role: 'user', content }],
  };
  let last = '';
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok) {
      const block = (body.content || []).find((b: { type: string }) => b.type === 'tool_use');
      if (!block) throw new Error('המודל לא החזיר תוצאה מובנית');
      return block.input as ReelScript;
    }
    last = friendlyModelError(res.status, body);
    if (![429, 500, 502, 503, 529].includes(res.status)) break;
    await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
  }
  throw new HttpError(last, 502);
}

/* ================================ ניקוי פלט ================================ */

const BASE_TAGS = ['#אייקוןאייר', '#מפיציריח', '#בישוםחלל'];

function sanitize(raw: ReelScript, imageCount: number): ReelScript {
  const scenes = (raw.scenes || [])
    .filter((s) => Number.isInteger(Math.round(s.image_index)) && s.image_index >= 0 && s.image_index < imageCount)
    .slice(0, 7)
    .map((s) => ({
      image_index: Math.round(s.image_index),
      seconds: Math.max(1.5, Math.min(4.5, Number(s.seconds) || 2.5)),
      subtitle: String(s.subtitle || '').trim().slice(0, 60),
    }));
  if (!scenes.length) throw new HttpError('המודל לא החזיר סצנות תקינות — נסה שוב', 502);
  const tags = [...BASE_TAGS, ...(raw.hashtags || [])]
    .map((t) => `#${String(t).replace(/^#+/, '').replace(/\s+/g, '')}`)
    .filter((t) => t.length > 1);
  return {
    title: String(raw.title || '').slice(0, 60),
    hook: String(raw.hook || ''),
    value: String(raw.value || ''),
    cta: String(raw.cta || '').slice(0, 60),
    scenes,
    caption: String(raw.caption || '').trim(),
    hashtags: [...new Set(tags)].slice(0, 14),
  };
}

/* ================================ generate ================================ */

async function generate(db: SupabaseClient, input: GenerateInput): Promise<ReelScript> {
  const images = assertOwnImages(input.images);
  const products = await loadProducts(db, (input.scentIds ?? []).slice(0, 4), (input.modelIds ?? []).slice(0, 4));

  const content: unknown[] = [];
  images.forEach((url, i) => {
    content.push({ type: 'text', text: `תמונה #${i}` });
    content.push({ type: 'image', source: { type: 'url', url } });
  });
  const lines = [
    `כתוב רילז אחד מהתמונות למעלה (${images.length} תמונות). מותר לחזור על תמונה בשתי סצנות.`,
    TONES[input.tone ?? 'warm'],
    productText(products),
    input.notes?.trim() && `הערות מהשטח: ${input.notes.trim()}`,
    input.previous && `הגרסה הקודמת:\n${JSON.stringify(input.previous)}`,
    input.instructions?.trim() && `שינויים שהמנהל ביקש: ${input.instructions.trim()}`,
  ].filter(Boolean) as string[];
  content.push({ type: 'text', text: lines.join('\n\n') });

  return sanitize(await callModel(content), images.length);
}

/* ================================ handler ================================ */

export default async function handler(req: Req, res: Res): Promise<void> {
  const body = (req.body ?? {}) as Record<string, unknown>;
  try {
    if (req.method !== 'POST') throw new HttpError('Method not allowed', 405);
    const db = await authorizeAdmin(req);
    if (body.action !== 'generate') throw new HttpError('Unknown action');
    res.status(200).json(await generate(db, body as unknown as GenerateInput));
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    if (status >= 500 && status !== 503) await reportToSentry(error, { action: body.action });
    res.status(status).json({ error: error instanceof Error ? error.message : 'Server error' });
  }
}
