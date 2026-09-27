import { useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { renderReel, reelSupport } from '../../lib/reelRenderer';
import { reportRendered, type ClaraAsset, type ClaraContent } from '../../lib/clara';
import { uploadSocialImage } from '../../lib/social';
import { brandLogoUrl } from '../../lib/queries';
import { buildSoundtrack } from '../../lib/soundtrack';

/**
 * תור רינדור: כל תוכן בסטטוס draft שחסר לו סרטון (רילז) או תמונות-פיד
 * (פוסט/קרוסלה) מרונדר כאן, בדפדפן של המנהל, אחד-אחד.
 *
 * נעילה אופטימית ב-render_error ("rendering@<ms>") — כששני מנהלים/לשוניות
 * פתוחים, רק אחד מרנדר. נעילה בת יותר מ-6 דקות נחשבת נטושה.
 */
const LOCK_PREFIX = 'rendering@';
const LOCK_STALE_MS = 6 * 60 * 1000;

export interface RenderState { contentId: string; title: string; progress: number }

const needsRender = (c: ClaraContent) =>
  c.status === 'draft' && (c.kind === 'reel' ? !c.video_url : !c.media_urls.length);

async function claim(c: ClaraContent): Promise<boolean> {
  const prev = c.render_error;
  if (prev?.startsWith(LOCK_PREFIX) && Date.now() - Number(prev.slice(LOCK_PREFIX.length)) < LOCK_STALE_MS) return false;
  let q = supabase!.from('clara_content').update({ render_error: `${LOCK_PREFIX}${Date.now()}` }).eq('id', c.id).eq('status', 'draft');
  q = prev === null ? q.is('render_error', null) : q.eq('render_error', prev);
  const { data } = await q.select('id');
  return Boolean(data?.length);
}

async function uploadRendered(path: string, blob: Blob, contentType: string): Promise<string> {
  const { error } = await supabase!.storage.from('social-media').upload(path, blob, { upsert: true, contentType });
  if (error) throw error;
  return supabase!.storage.from('social-media').getPublicUrl(path).data.publicUrl;
}

export function useClaraRenderer(content: ClaraContent[] | null, assets: ClaraAsset[] | null, enabled: boolean) {
  const [current, setCurrent] = useState<RenderState | null>(null);
  const busy = useRef(false);
  const failedLocally = useRef(new Set<string>());
  const support = reelSupport();

  useEffect(() => {
    if (!enabled || busy.current || !content || !assets) return;
    const next = content.find((c) => needsRender(c) && !failedLocally.current.has(`${c.id}:${c.revision}`)
      && (c.kind !== 'reel' || support.ok));
    if (!next) return;

    busy.current = true;
    (async () => {
      try {
        if (!(await claim(next))) return;
        setCurrent({ contentId: next.id, title: next.title, progress: 0 });
        const byId = new Map(assets.map((a) => [a.id, a]));

        if (next.kind === 'reel') {
          const scenes = next.scenes
            .map((s) => ({ s, a: byId.get(s.asset_id) }))
            .filter((x): x is { s: typeof x.s; a: ClaraAsset } => Boolean(x.a))
            .map(({ s, a }) => ({ url: a.public_url, type: a.media_type, seconds: s.seconds, onScreen: s.on_screen }));
          if (!scenes.length) throw new Error('החומרים של הסרטון נמחקו מהספרייה');
          const seconds = scenes.reduce((sum, s) => sum + s.seconds, 0) + 2.2;
          // סאונד שנכשל (קובץ פגום/חסום) לא מפיל את הסרטון — ממשיכים בשקט
          const audio = await buildSoundtrack(next.soundtrack, seconds + 0.5).catch(() => null);
          const out = await renderReel({
            scenes,
            audio,
            cta: next.cta,
            logoUrl: brandLogoUrl('png'),
            onProgress: (p) => setCurrent((cur) => (cur ? { ...cur, progress: p } : cur)),
          });
          const base = `clara/${next.id}-v${next.revision}`;
          const [videoUrl, coverUrl] = await Promise.all([
            uploadRendered(`${base}.mp4`, out.video, 'video/mp4'),
            uploadRendered(`${base}.jpg`, out.cover, 'image/jpeg'),
          ]);
          await reportRendered({ contentId: next.id, videoUrl, coverUrl });
        } else {
          const urls: string[] = [];
          const ids = next.asset_ids.filter((id) => byId.get(id)?.media_type === 'image');
          for (let i = 0; i < ids.length; i += 1) {
            const blob = await fetch(byId.get(ids[i])!.public_url).then((r) => r.blob());
            urls.push(await uploadSocialImage(blob)); // JPEG + יחס שאינסטגרם מקבל
            setCurrent((cur) => (cur ? { ...cur, progress: (i + 1) / ids.length } : cur));
          }
          if (!urls.length) throw new Error('אין תמונות לפוסט');
          await reportRendered({ contentId: next.id, mediaUrls: urls });
        }
      } catch (e) {
        failedLocally.current.add(`${next.id}:${next.revision}`);
        const message = e instanceof Error ? e.message : String(e);
        await reportRendered({ contentId: next.id, error: `הרינדור נכשל: ${message}` }).catch(() => undefined);
      } finally {
        busy.current = false;
        setCurrent(null);
      }
    })();
  }, [content, assets, enabled, support.ok]);

  const retry = (id: string) => {
    for (const key of [...failedLocally.current]) if (key.startsWith(`${id}:`)) failedLocally.current.delete(key);
  };

  return { current, supported: support, retry };
}
