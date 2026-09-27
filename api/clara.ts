// /api/clara — המוח של קלרה (Vercel Serverless, Node.js, TypeScript).
//
// קלרה לוקחת נכסים גולמיים מהשטח (clara_assets), שולחת אותם ל-Claude עם
// ראייה, ומקבלת בחזרה תוכן שיווקי מובנה: רילז (הוק → ערך → הנעה לפעולה,
// סצנות, קריינות, כתוביות) ופוסטים (כיתוב + האשטגים). משם — תהליך אישור
// בשיחה, ותזמון לתור הפרסום של phase45 (social_posts + Autopilot).
//
// הרשאות: רק מנהל מחובר (JWT של Supabase + is_admin()). מפתח Anthropic
// יושב ב-clara_settings (סגורה ב-RLS) ונשלף דרך clara_credentials().
// שגיאות לא צפויות מדווחות ל-Sentry (VITE_SENTRY_DSN, כבר מוגדר ב-Vercel).

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const config = { maxDuration: 60 };

/* ================================ טיפוסים ================================ */

type ContentKind = 'reel' | 'post' | 'carousel';
type ContentStatus = 'draft' | 'pending_approval' | 'approved' | 'scheduled' | 'published' | 'rejected' | 'failed';

interface Asset {
  id: string;
  public_url: string;
  thumb_url: string | null;
  media_type: 'image' | 'video';
  duration_sec: number | null;
  taken_at: string | null;
  location_label: string | null;
  notes: string | null;
  analysis: { description?: string } | null;
}

interface Scene {
  asset_id: string;
  seconds: number;
  on_screen: string;
  voiceover: string;
}

interface ContentRow {
  id: string;
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
  platforms: string[];
  revision: number;
  scheduled_at: string | null;
  social_post_id: string | null;
}

interface GeneratedItem {
  kind: ContentKind;
  title: string;
  hook: string;
  value_prop: string;
  cta: string;
  scenes: { asset_index: number; seconds: number; on_screen: string; voiceover: string }[];
  voiceover: string;
  caption: string;
  hashtags: string[];
  asset_indexes: number[];
}

interface Req {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: Record<string, unknown>;
}
interface Res {
  status(code: number): Res;
  json(body: unknown): void;
}

class HttpError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

/* ================================ Sentry (בלי SDK) ================================ */
// שליחת envelope ישירה ל-Sentry — בלי תלות נוספת בצד השרת. בלי DSN: לא עושה כלום.

async function reportToSentry(error: unknown, context: Record<string, unknown> = {}): Promise<void> {
  const dsn = (process.env.VITE_SENTRY_DSN || process.env.SENTRY_DSN || '').trim();
  if (!dsn) return;
  try {
    const u = new URL(dsn);
    const projectId = u.pathname.replace(/\//g, '');
    const eventId = crypto.randomUUID().replace(/-/g, '');
    const err = error instanceof Error ? error : new Error(String(error));
    const event = {
      event_id: eventId,
      timestamp: Date.now() / 1000,
      platform: 'node',
      level: 'error',
      environment: 'production',
      server_name: 'vercel:/api/clara',
      tags: { area: 'clara' },
      extra: context,
      exception: { values: [{ type: err.name, value: err.message, stacktrace: undefined }] },
    };
    const envelope = `${JSON.stringify({ event_id: eventId, dsn, sent_at: new Date().toISOString() })}\n${JSON.stringify({ type: 'event' })}\n${JSON.stringify(event)}`;
    await fetch(`${u.protocol}//${u.host}/api/${projectId}/envelope/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-sentry-envelope',
        'X-Sentry-Auth': `Sentry sentry_version=7, sentry_key=${u.username}, sentry_client=iconair-clara/1.0`,
      },
      body: envelope,
    });
  } catch {
    /* ניטור לעולם לא מפיל את הבקשה עצמה */
  }
}

/* ================================ Supabase ================================ */

const env = (k: string): string => (process.env[k] || '').trim();

async function authorizeAdmin(req: Req): Promise<{ db: SupabaseClient; userId: string }> {
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
  return { db, userId: user.user.id };
}

async function must<T>(p: PromiseLike<{ data: T | null; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return data as T;
}

async function say(db: SupabaseClient, msg: {
  body: string; batch_id?: string | null; content_ids?: string[]; actions?: unknown[]; notify?: boolean; role?: 'clara' | 'user';
}): Promise<void> {
  await must(db.from('clara_messages').insert({
    role: msg.role ?? 'clara',
    body: msg.body,
    batch_id: msg.batch_id ?? null,
    content_ids: msg.content_ids ?? [],
    actions: msg.actions ?? [],
    notify: msg.notify ?? false,
  }));
}

/* ================================ Claude ================================ */

interface ClaudeSettings { anthropic_key: string | null; model: string; brand_notes: string }

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

function friendlyAnthropicError(status: number, body: { error?: { type?: string; message?: string } }): string {
  const type = body?.error?.type || '';
  if (status === 401 || type === 'authentication_error') return 'מפתח ה-API של Anthropic לא תקין — עדכן אותו בהגדרות קלרה';
  if (status === 403 || type === 'permission_error') return 'למפתח של Anthropic אין הרשאה למודל שנבחר — בחר מודל אחר בהגדרות';
  if (status === 404 || type === 'not_found_error') return 'המודל שנבחר לא קיים — בחר מודל אחר בהגדרות קלרה';
  if (status === 400 && /credit|balance|billing/i.test(body?.error?.message || '')) return 'נגמרה היתרה בחשבון Anthropic — יש לטעון קרדיט';
  if (status === 429) return 'Anthropic מגבילה כרגע את קצב הבקשות — נסה שוב בעוד דקה';
  if (status === 529 || status >= 500) return 'השירות של Anthropic עמוס כרגע — נסה שוב בעוד רגע';
  return body?.error?.message || `שגיאה מ-Anthropic (${status})`;
}

async function callClaude<T>(s: ClaudeSettings, opts: {
  system: string;
  content: unknown[];
  tool: { name: string; description: string; input_schema: Record<string, unknown> };
  maxTokens?: number;
}): Promise<{ data: T; usage: unknown }> {
  if (!s.anthropic_key) throw new HttpError('קלרה עוד לא מחוברת ל-AI — הזן מפתח Anthropic בהגדרות קלרה');

  const payload = {
    model: s.model,
    max_tokens: opts.maxTokens ?? 4096,
    system: opts.system,
    tools: [opts.tool],
    tool_choice: { type: 'tool', name: opts.tool.name },
    messages: [{ role: 'user', content: opts.content }],
  };

  let last = '';
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': s.anthropic_key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok) {
      const block = (body.content || []).find((b: { type: string }) => b.type === 'tool_use');
      if (!block) throw new Error('Claude לא החזיר תוצאה מובנית');
      return { data: block.input as T, usage: body.usage };
    }
    last = friendlyAnthropicError(res.status, body);
    if (![429, 500, 502, 503, 529].includes(res.status)) break;
    await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
  }
  throw new HttpError(last, 502);
}

const BRAND_CONTEXT = `
את "קלרה", מנהלת השיווק הדיגיטלי של ICONAIR (אייקון אייר בע"מ) — מפיצי ריח חכמים
לעסקים ולבית בישראל. המותג נכתב תמיד ICONAIR (מילה אחת, אותיות גדולות).

עובדות שמותר להשתמש בהן:
- מוצרים: מפיצי ריח חשמליים (דגמי Icon 70 / 90 / 400 / 700, דגמים לרכב) ותמציות ריח.
- לקוחות: עסקים (חנויות, משרדים, מלונות, קליניקות, אולמות) ובתים פרטיים.
- שירות: התקנה, מילוי ותחזוקה ע"י טכנאים; משלוחים לכל הארץ (3–7 ימי עסקים).
- אתר: iconair.co.il · טלפון/וואטסאפ: 055-915-8248.

כללים:
- עברית טבעית, חמה ומדוברת, מותאמת לקהל הישראלי. בלי תרגומית, בלי קלישאות.
- לעולם אל תמציאי מחירים, הנחות, קופונים, לקוחות או נתונים שלא הופיעו בהנחיה.
- תארי רק מה שבאמת רואים בתמונות. אם יש סניף/מיקום בהערות — מותר לציין.
- רילז: 7–20 שניות. הוק חזק ב-2 השניות הראשונות, ערך אחד ברור, הנעה לפעולה אחת.
- כתוביות על המסך: קצרות (עד 6 מילים לסצנה), קריאות מהר.
- האשטגים: 6–12, מקומיים ורלוונטיים. תמיד לכלול #אייקוןאייר #מפיציריח #בישוםחלל.
- אימוג'ים במידה (0–3 לכיתוב).
`.trim();

const ITEM_SCHEMA = {
  type: 'object',
  required: ['kind', 'title', 'hook', 'value_prop', 'cta', 'scenes', 'voiceover', 'caption', 'hashtags', 'asset_indexes'],
  properties: {
    kind: { type: 'string', enum: ['reel', 'post', 'carousel'] },
    title: { type: 'string', description: 'שם פנימי קצר לתוכן (עד 6 מילים)' },
    hook: { type: 'string', description: 'משפט פתיחה/הוק (עד 8 מילים)' },
    value_prop: { type: 'string', description: 'הערך המרכזי במשפט אחד' },
    cta: { type: 'string', description: 'הנעה לפעולה קצרה' },
    scenes: {
      type: 'array',
      description: 'לרילז בלבד: 3–7 סצנות לפי הסדר. לפוסט/קרוסלה — מערך ריק.',
      items: {
        type: 'object',
        required: ['asset_index', 'seconds', 'on_screen', 'voiceover'],
        properties: {
          asset_index: { type: 'integer', description: 'אינדקס הנכס מהרשימה (מתחיל ב-0)' },
          seconds: { type: 'number', minimum: 1.5, maximum: 5 },
          on_screen: { type: 'string', description: 'כתובית על המסך, עד 6 מילים' },
          voiceover: { type: 'string', description: 'משפט הקריינות לסצנה' },
        },
      },
    },
    voiceover: { type: 'string', description: 'טקסט הקריינות המלא, בעברית טבעית (לרילז; לפוסט — ריק)' },
    caption: { type: 'string', description: 'כיתוב לפוסט, עם שורות, בלי האשטגים' },
    hashtags: { type: 'array', items: { type: 'string' }, description: 'כל אחד מתחיל ב-#' },
    asset_indexes: { type: 'array', items: { type: 'integer' }, description: 'הנכסים שבשימוש (לפוסט: תמונות בלבד, 1–10)' },
  },
} as const;

/* ================================ עזרים ================================ */

const cleanTags = (tags: string[]): string[] => {
  const base = ['#אייקוןאייר', '#מפיציריח', '#בישוםחלל'];
  const all = [...base, ...tags].map((t) => `#${String(t).replace(/^#+/, '').replace(/\s+/g, '')}`).filter((t) => t.length > 1);
  return [...new Set(all)].slice(0, 14);
};

function assetBlocks(assets: Asset[]): unknown[] {
  const blocks: unknown[] = [];
  assets.forEach((a, i) => {
    const img = a.media_type === 'image' ? a.public_url : a.thumb_url;
    const meta = [
      `נכס #${i} — ${a.media_type === 'video' ? `סרטון (${a.duration_sec ?? '?'} שנ׳, מוצג הפריים הראשון)` : 'תמונה'}`,
      a.location_label && `מיקום/סניף: ${a.location_label}`,
      a.taken_at && `צולם: ${new Date(a.taken_at).toLocaleDateString('he-IL')}`,
      a.notes && `הערות מהשטח: ${a.notes}`,
      a.analysis?.description && `תיאור קודם: ${a.analysis.description}`,
    ].filter(Boolean).join(' · ');
    blocks.push({ type: 'text', text: meta });
    if (img) blocks.push({ type: 'image', source: { type: 'url', url: img } });
  });
  return blocks;
}

function toContentRow(item: GeneratedItem, assets: Asset[], batchId: string) {
  const at = (i: number) => assets[Math.max(0, Math.min(assets.length - 1, Math.round(i)))];
  const isReel = item.kind === 'reel';
  // סצנה שמצביעה על נכס שלא קיים (Claude טעה באינדקס) — נזרקת, לא "מתוקנת" לנכס אקראי.
  const validIndex = (i: number) => Number.isInteger(Math.round(i)) && Math.round(i) >= 0 && Math.round(i) < assets.length;
  const scenes: Scene[] = isReel
    ? (item.scenes || []).filter((s) => validIndex(s.asset_index)).slice(0, 8).map((s) => ({
        asset_id: at(s.asset_index).id,
        seconds: Math.max(1.5, Math.min(5, Number(s.seconds) || 2.5)),
        on_screen: String(s.on_screen || '').slice(0, 60),
        voiceover: String(s.voiceover || ''),
      }))
    : [];
  const assetIds = isReel
    ? [...new Set(scenes.map((s) => s.asset_id))]
    : [...new Set((item.asset_indexes || []).filter(validIndex).map((i) => at(i)).filter((a) => a.media_type === 'image').map((a) => a.id))].slice(0, 10);
  return {
    batch_id: batchId,
    kind: isReel ? 'reel' : assetIds.length > 1 ? 'carousel' : 'post',
    status: 'draft' as ContentStatus,
    title: item.title,
    hook: item.hook,
    value_prop: item.value_prop,
    cta: item.cta,
    scenes,
    voiceover: item.voiceover || scenes.map((s) => s.voiceover).join(' '),
    caption: item.caption,
    hashtags: cleanTags(item.hashtags || []),
    asset_ids: assetIds.length ? assetIds : [assets.find((a) => a.media_type === 'image')?.id ?? assets[0].id],
    platforms: ['facebook', 'instagram'],
    revision: 1,
  };
}

/* ================================ פעולות ================================ */

async function generate(db: SupabaseClient, batchId: string) {
  const creds = await must<ClaudeSettings>(db.rpc('clara_credentials'));
  const batch = await must<{ id: string; asset_ids: string[]; brief: string; wanted: { reels?: number; posts?: number }; status: string }>(
    db.from('clara_batches').select('*').eq('id', batchId).single(),
  );
  if (batch.status === 'generating') throw new HttpError('קלרה כבר עובדת על המשימה הזו', 409);
  await must(db.from('clara_batches').update({ status: 'generating', error: null, model: creds.model }).eq('id', batchId));

  try {
    const assets = await must<Asset[]>(db.from('clara_assets').select('*').in('id', batch.asset_ids));
    const ordered = batch.asset_ids.map((id) => assets.find((a) => a.id === id)).filter(Boolean) as Asset[];
    if (!ordered.length) throw new HttpError('הנכסים של המשימה לא נמצאו');
    const hasImage = ordered.some((a) => a.media_type === 'image');
    const reels = Math.max(0, Math.min(3, batch.wanted?.reels ?? 2));
    const posts = hasImage ? Math.max(0, Math.min(3, batch.wanted?.posts ?? 1)) : 0;

    const { data, usage } = await callClaude<{ items: GeneratedItem[]; asset_descriptions: string[] }>(creds, {
      system: `${BRAND_CONTEXT}\n\n${creds.brand_notes ? `הנחיות מותג נוספות מהמנהל:\n${creds.brand_notes}` : ''}`,
      maxTokens: 6000,
      tool: {
        name: 'deliver_content',
        description: 'מסירת חבילת התוכן המוכנה לאישור',
        input_schema: {
          type: 'object',
          required: ['items', 'asset_descriptions'],
          properties: {
            items: { type: 'array', items: ITEM_SCHEMA },
            asset_descriptions: { type: 'array', items: { type: 'string' }, description: 'תיאור קצר של כל נכס לפי הסדר' },
          },
        },
      },
      content: [
        ...assetBlocks(ordered),
        {
          type: 'text',
          text: [
            `צרי ${reels} רילז ו-${posts} פוסטים (פוסט עם כמה תמונות = קרוסלה) מהנכסים למעלה.`,
            'כל רילז בזווית אחרת (למשל: לפני/אחרי, תהליך התקנה, חוויית לקוח, מוצר מקרוב).',
            batch.brief ? `הנחיה מהמנהל: ${batch.brief}` : '',
          ].filter(Boolean).join('\n'),
        },
      ],
    });

    const items = (data.items || []).filter((i) => i && i.title);
    if (!items.length) throw new Error('Claude לא החזיר תוכן');

    // שמירת התיאורים לשימוש חוזר (זול יותר בפעם הבאה)
    await Promise.all(ordered.map((a, i) => (data.asset_descriptions?.[i]
      ? db.from('clara_assets').update({ analysis: { description: data.asset_descriptions[i] } }).eq('id', a.id)
      : Promise.resolve())));

    const rows = items.map((it) => toContentRow(it, ordered, batchId));
    const created = await must<{ id: string; kind: string }[]>(db.from('clara_content').insert(rows).select('id, kind'));
    await must(db.from('clara_batches').update({ status: 'ready', usage }).eq('id', batchId));

    const nReels = created.filter((c) => c.kind === 'reel').length;
    await say(db, {
      batch_id: batchId,
      content_ids: created.map((c) => c.id),
      body: `קיבלתי ${ordered.length} ${ordered.length === 1 ? 'קובץ' : 'קבצים'}. כתבתי ${created.length} ${created.length === 1 ? 'תוכן' : 'תכנים'}${nReels ? `, ואני מרנדרת עכשיו ${nReels === 1 ? 'את הסרטון' : `${nReels} סרטונים`}` : ''} — אעדכן כשהכל מוכן לאישור.`,
    });
    return { contentIds: created.map((c) => c.id) };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await db.from('clara_batches').update({ status: 'failed', error: message }).eq('id', batchId);
    await say(db, { batch_id: batchId, body: `לא הצלחתי להכין את התוכן: ${message}`, actions: [{ id: 'retry_batch', label: 'לנסות שוב', kind: 'primary' }] });
    throw e;
  }
}

/** אחרי שהדפדפן רינדר את הסרטון / הכין את תמונות הפיד */
async function rendered(db: SupabaseClient, body: { contentId: string; videoUrl?: string; coverUrl?: string; mediaUrls?: string[]; error?: string }) {
  const c = await must<ContentRow>(db.from('clara_content').select('*').eq('id', body.contentId).single());
  if (body.error) {
    await must(db.from('clara_content').update({ render_error: body.error }).eq('id', c.id));
    return { ok: false };
  }
  await must(db.from('clara_content').update({
    video_url: body.videoUrl ?? c.video_url,
    cover_url: body.coverUrl ?? c.cover_url,
    media_urls: body.mediaUrls ?? c.media_urls,
    render_error: null,
    status: 'pending_approval',
  }).eq('id', c.id));

  // כשכל התכנים של המשימה מוכנים — הודעה אחת מסכמת (+ Push לטלפון)
  if (c.batch_id) {
    const siblings = await must<{ id: string; kind: string; status: string; title: string }[]>(
      db.from('clara_content').select('id, kind, status, title').eq('batch_id', c.batch_id),
    );
    if (siblings.every((s) => s.status !== 'draft')) {
      const ready = siblings.filter((s) => s.status === 'pending_approval');
      const reels = ready.filter((s) => s.kind === 'reel').length;
      const posts = ready.length - reels;
      const parts = [reels && `${reels === 1 ? 'רילז אחד' : `${reels} סרטונים`}`, posts && `${posts === 1 ? 'פוסט אחד' : `${posts} פוסטים`}`].filter(Boolean);
      await say(db, {
        batch_id: c.batch_id,
        content_ids: ready.map((s) => s.id),
        notify: true,
        body: `הכנתי ${parts.join(' ו')} מהתמונות ששלחת 🎬 מוכנים לאישור — לפרסם היום?`,
        actions: [
          { id: 'approve_all_best', label: 'לתזמן הכל בזמנים הכי טובים', kind: 'primary' },
          { id: 'approve_all_today', label: 'לפרסם היום', kind: 'secondary' },
        ],
      });
    }
  }
  return { ok: true };
}

async function revise(db: SupabaseClient, body: { contentId: string; instructions: string }) {
  const instructions = String(body.instructions || '').trim();
  if (!instructions) throw new HttpError('כתוב מה לשנות');
  const creds = await must<ClaudeSettings>(db.rpc('clara_credentials'));
  const c = await must<ContentRow>(db.from('clara_content').select('*').eq('id', body.contentId).single());
  if (['scheduled', 'published'].includes(c.status)) throw new HttpError('אי אפשר לשנות תוכן שכבר תוזמן/פורסם — בטל תזמון קודם');

  const assets = await must<Asset[]>(db.from('clara_assets').select('*').in('id', c.asset_ids.length ? c.asset_ids : ['00000000-0000-0000-0000-000000000000']));
  const pool = c.kind === 'reel' ? [...new Set(c.scenes.map((s) => s.asset_id))].map((id) => assets.find((a) => a.id === id)).filter(Boolean) as Asset[] : assets;
  const indexOf = (id: string) => Math.max(0, pool.findIndex((a) => a.id === id));

  await say(db, { role: 'user', body: `שינוי ל"${c.title}": ${instructions}`, content_ids: [c.id], batch_id: c.batch_id });

  const current: GeneratedItem = {
    kind: c.kind, title: c.title, hook: c.hook, value_prop: c.value_prop, cta: c.cta,
    scenes: c.scenes.map((s) => ({ asset_index: indexOf(s.asset_id), seconds: s.seconds, on_screen: s.on_screen, voiceover: s.voiceover })),
    voiceover: c.voiceover, caption: c.caption, hashtags: c.hashtags, asset_indexes: c.asset_ids.map(indexOf),
  };

  const { data } = await callClaude<GeneratedItem>(creds, {
    system: `${BRAND_CONTEXT}\n\n${creds.brand_notes || ''}`,
    tool: { name: 'deliver_revision', description: 'גרסה מעודכנת של התוכן', input_schema: ITEM_SCHEMA as unknown as Record<string, unknown> },
    content: [
      ...assetBlocks(pool.length ? pool : assets),
      { type: 'text', text: `זו הגרסה הנוכחית (JSON):\n${JSON.stringify(current)}\n\nבקשת השינוי מהמנהל: ${instructions}\n\nשני רק את מה שהתבקש, ושמרי על אותו kind (${c.kind}).` },
    ],
  });

  const next = toContentRow({ ...data, kind: c.kind }, pool.length ? pool : assets, c.batch_id ?? '');
  const visualChanged = c.kind === 'reel'
    ? JSON.stringify(next.scenes.map((s) => [s.asset_id, s.on_screen, s.seconds])) !== JSON.stringify(c.scenes.map((s) => [s.asset_id, s.on_screen, s.seconds]))
      || next.cta !== c.cta || next.hook !== c.hook
    : JSON.stringify(next.asset_ids) !== JSON.stringify(c.asset_ids);

  await must(db.from('clara_content').update({
    title: next.title, hook: next.hook, value_prop: next.value_prop, cta: next.cta,
    scenes: next.scenes, voiceover: next.voiceover, caption: next.caption, hashtags: next.hashtags,
    asset_ids: next.asset_ids, revision: (c.revision ?? 1) + 1, change_request: instructions,
    ...(visualChanged ? { status: 'draft', video_url: null, cover_url: null, media_urls: [] } : {}),
  }).eq('id', c.id));

  await say(db, {
    content_ids: [c.id], batch_id: c.batch_id,
    body: visualChanged
      ? `עדכנתי את "${next.title}" (גרסה ${(c.revision ?? 1) + 1}) ומרנדרת מחדש — אשלח כשמוכן.`
      : `עדכנתי את הטקסט של "${next.title}" (גרסה ${(c.revision ?? 1) + 1}). מה דעתך?`,
    actions: visualChanged ? [] : [{ id: `approve:${c.id}:best`, label: 'מאשר — לזמן הכי טוב', kind: 'primary' }],
  });
  return { visualChanged };
}

async function approve(db: SupabaseClient, userId: string, body: { contentId: string; when: 'best' | 'today' | 'now' | 'custom'; at?: string }) {
  const c = await must<ContentRow>(db.from('clara_content').select('*').eq('id', body.contentId).single());
  if (!['pending_approval', 'approved', 'failed'].includes(c.status)) throw new HttpError('התוכן הזה לא ממתין לאישור');
  if (c.kind === 'reel' && !c.video_url) throw new HttpError('הסרטון עוד לא מרונדר');
  if (c.kind !== 'reel' && !c.media_urls.length) throw new HttpError('התמונות עוד לא מוכנות');

  // חיבור Meta — בלעדיו אין לאן לפרסם
  const { data: social } = await db.rpc('social_status');
  if (!social?.connected) throw new HttpError('Meta לא מחובר — חבר בלשונית "חיבור" ואז אשר שוב');
  const hasIg = Boolean(social?.ig_user_id);

  let scheduledAt: string | null = null;
  const nowIso = new Date().toISOString();
  if (body.when === 'now') scheduledAt = null;
  else if (body.when === 'custom') {
    if (!body.at || Number.isNaN(Date.parse(body.at)) || Date.parse(body.at) < Date.now() + 60_000) throw new HttpError('בחר מועד עתידי');
    scheduledAt = new Date(body.at).toISOString();
  } else {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
    const { data: slot, error } = await db.rpc('clara_next_slot', { p_after: nowIso, p_only_day: body.when === 'today' ? today : null });
    if (error) throw new Error(error.message);
    scheduledAt = slot as string;
    if (body.when === 'today' && new Date(slot as string).toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' }) !== today) {
      // אין חלון פנוי היום — ננסה את הכי קרוב מחר, ונגיד את זה
      const { data: next } = await db.rpc('clara_next_slot', { p_after: nowIso, p_only_day: null });
      scheduledAt = next as string;
    }
  }

  const caption = [c.caption.trim(), c.hashtags.join(' ')].filter(Boolean).join('\n\n');
  const platforms = c.platforms?.length ? c.platforms : ['facebook', 'instagram'];
  const wantIg = platforms.includes('instagram') && hasIg;
  const wantFb = platforms.includes('facebook');
  const post = await must<{ id: string }>(db.from('social_posts').insert({
    caption,
    media_urls: c.kind === 'reel' ? [] : c.media_urls,
    media_kind: c.kind === 'reel' ? 'reel' : 'image',
    video_url: c.kind === 'reel' ? c.video_url : null,
    cover_url: c.kind === 'reel' ? c.cover_url : null,
    is_draft: false,
    scheduled_at: scheduledAt,
    fb_status: wantFb ? 'pending' : null,
    ig_status: wantIg ? 'pending' : null,
    source: 'clara',
    clara_content_id: c.id,
  }).select('id').single());

  await must(db.from('clara_content').update({
    status: 'scheduled', scheduled_at: scheduledAt ?? nowIso, approved_by: userId, approved_at: nowIso, social_post_id: post.id,
  }).eq('id', c.id));

  const whenText = scheduledAt
    ? new Date(scheduledAt).toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem', weekday: 'long', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' })
    : 'בדקה הקרובה';
  await say(db, {
    content_ids: [c.id], batch_id: c.batch_id,
    body: `מעולה ✅ "${c.title}" ${scheduledAt ? `מתוזמן ל${whenText}` : 'עולה עכשיו'} — ${[wantFb && 'פייסבוק', wantIg && 'אינסטגרם'].filter(Boolean).join(' + ')}.${platforms.includes('instagram') && !hasIg ? ' (אינסטגרם לא מחובר, אז רק פייסבוק.)' : ''}`,
  });
  return { scheduledAt, socialPostId: post.id };
}

async function approveBatch(db: SupabaseClient, userId: string, body: { batchId: string; when: 'best' | 'today' }) {
  const items = await must<{ id: string }[]>(db.from('clara_content').select('id').eq('batch_id', body.batchId).eq('status', 'pending_approval').order('created_at'));
  const results = [];
  for (const it of items) results.push(await approve(db, userId, { contentId: it.id, when: body.when }));
  return { approved: results.length };
}

async function unschedule(db: SupabaseClient, body: { contentId: string }) {
  const c = await must<ContentRow>(db.from('clara_content').select('*').eq('id', body.contentId).single());
  if (c.status !== 'scheduled') throw new HttpError('התוכן לא מתוזמן');
  if (c.social_post_id) {
    const sp = await must<{ fb_status: string | null; ig_status: string | null }>(db.from('social_posts').select('fb_status, ig_status').eq('id', c.social_post_id).single());
    if (sp.fb_status === 'published' || sp.ig_status === 'published') throw new HttpError('כבר התחיל להתפרסם — אי אפשר לבטל');
    await must(db.from('social_posts').delete().eq('id', c.social_post_id));
  }
  await must(db.from('clara_content').update({ status: 'pending_approval', social_post_id: null, scheduled_at: null }).eq('id', c.id));
  await say(db, { content_ids: [c.id], body: `ביטלתי את התזמון של "${c.title}". הוא מחכה שוב לאישור.` });
  return { ok: true };
}

async function reject(db: SupabaseClient, body: { contentId: string }) {
  const c = await must<ContentRow>(db.from('clara_content').select('id, title, status').eq('id', body.contentId).single());
  if (c.status === 'scheduled') throw new HttpError('התוכן מתוזמן — בטל את התזמון קודם');
  if (c.status === 'published') throw new HttpError('התוכן כבר פורסם');
  await must(db.from('clara_content').update({ status: 'rejected' }).eq('id', c.id));
  await say(db, { content_ids: [c.id], body: `הבנתי, "${c.title}" ירד מהשולחן.` });
  return { ok: true };
}

async function retry(db: SupabaseClient, body: { contentId: string }) {
  const c = await must<ContentRow>(db.from('clara_content').select('*').eq('id', body.contentId).single());
  if (c.status !== 'failed' || !c.social_post_id) throw new HttpError('אין מה לנסות שוב');
  await must(db.from('social_posts').update({
    fb_status: 'pending', ig_status: 'pending', fb_error: null, ig_error: null, attempts: 0, ig_container_id: null, scheduled_at: null,
  }).eq('id', c.social_post_id));
  await must(db.from('clara_content').update({ status: 'scheduled' }).eq('id', c.id));
  await say(db, { content_ids: [c.id], body: `מנסה שוב לפרסם את "${c.title}" עכשיו.` });
  return { ok: true };
}

/* ================================ handler ================================ */

export default async function handler(req: Req, res: Res): Promise<void> {
  const body = (req.body ?? {}) as Record<string, any>;
  try {
    if (req.method !== 'POST') throw new HttpError('Method not allowed', 405);
    const { db, userId } = await authorizeAdmin(req);
    let result: unknown;
    switch (body.action) {
      case 'generate': result = await generate(db, String(body.batchId)); break;
      case 'rendered': result = await rendered(db, body as any); break;
      case 'revise': result = await revise(db, body as any); break;
      case 'approve': result = await approve(db, userId, body as any); break;
      case 'approve_batch': result = await approveBatch(db, userId, body as any); break;
      case 'unschedule': result = await unschedule(db, body as any); break;
      case 'reject': result = await reject(db, body as any); break;
      case 'retry': result = await retry(db, body as any); break;
      default: throw new HttpError('Unknown action');
    }
    res.status(200).json(result);
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    if (status >= 500) await reportToSentry(error, { action: body.action });
    res.status(status).json({ error: error instanceof Error ? error.message : 'Server error' });
  }
}
