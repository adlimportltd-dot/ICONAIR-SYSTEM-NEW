import { useEffect, useMemo, useRef, useState } from 'react';
import {
  approveBatch, approveContent, retryBatch, retryContent, reviseContent, markActionTaken, KIND_LABEL,
  type ClaraMessage, type ClaraContent, type ClaraAction,
} from '../../lib/clara';

interface Props {
  messages: ClaraMessage[];
  content: ClaraContent[];
  onToast: (t: { message: string; tone?: 'ok' | 'crit' | 'gold' }) => void;
}

const time = (iso: string) => new Date(iso).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
const day = (iso: string) => new Date(iso).toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'numeric' });

/**
 * השיחה עם קלרה — בסגנון וואטסאפ, בתוך ה-CRM. כל הודעה של קלרה יכולה
 * לשאת כפתורי תגובה (אישור/תזמון/ניסיון חוזר); הודעות חשובות נשלחות גם
 * כ-Push לטלפון של המנהלים (טריגר ב-DB).
 */
export default function ClaraChat({ messages, content, onToast }: Props) {
  const [text, setText] = useState('');
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const editable = useMemo(
    () => content.filter((c) => ['pending_approval', 'draft', 'approved'].includes(c.status)),
    [content],
  );
  const targetId = target || editable[0]?.id || '';

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [messages.length]);

  async function onAction(m: ClaraMessage, a: ClaraAction) {
    setBusy(`${m.id}:${a.id}`);
    try {
      if (a.id === 'approve_all_best' || a.id === 'approve_all_today') {
        if (!m.batch_id) throw new Error('חסר מזהה משימה');
        const r = await approveBatch(m.batch_id, a.id === 'approve_all_today' ? 'today' : 'best');
        onToast({ message: `${r.approved} תכנים תוזמנו` });
      } else if (a.id.startsWith('approve:')) {
        const [, id, when] = a.id.split(':');
        await approveContent(id, (when as 'best') || 'best');
      } else if (a.id === 'retry' && m.content_ids[0]) {
        await retryContent(m.content_ids[0]);
      } else if (a.id === 'retry_batch' && m.batch_id) {
        await retryBatch(m.batch_id);
      }
      await markActionTaken(m.id, a.id);
    } catch (e) {
      onToast({ tone: 'crit', message: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  }

  async function send() {
    const body = text.trim();
    if (!body || !targetId) return;
    setBusy('send');
    try {
      await reviseContent(targetId, body);
      setText('');
    } catch (e) {
      onToast({ tone: 'crit', message: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  }

  let lastDay = '';

  return (
    <div className="glass-card flex h-[640px] flex-col overflow-hidden xl:h-[760px]">
      <div className="flex items-center gap-3 border-b border-black/[0.06] px-5 py-4">
        <div className="grid h-11 w-11 place-items-center rounded-full border border-gold-300/[0.35] bg-gold-500/[0.14] font-display text-[18px] font-extrabold text-gold-600">ק</div>
        <div>
          <div className="font-bold">קלרה</div>
          <div className="text-[13px] text-text-faint">מנהלת השיווק של ICONAIR · עונה מיד</div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto bg-ink-800 px-4 py-4">
        {messages.length === 0 && (
          <div className="mx-auto mt-10 max-w-[300px] rounded-row bg-white px-4 py-3 text-center text-[14px] text-text-dim shadow-lift">
            היי, אני קלרה 👋 העלה תמונות או סרטונים מהשטח, ואני אכין מהם רילז ופוסטים מוכנים לאישור.
          </div>
        )}
        {messages.map((m) => {
          const d = day(m.created_at);
          const showDay = d !== lastDay;
          lastDay = d;
          const mine = m.role === 'user';
          return (
            <div key={m.id}>
              {showDay && <div className="my-3 text-center"><span className="chip">{d}</span></div>}
              <div className={`mb-2 flex ${mine ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] rounded-row px-3.5 py-2.5 text-[14.5px] leading-relaxed shadow-lift ${
                  mine ? 'rounded-se-md bg-gold-500/[0.16]' : 'rounded-ss-md bg-white'}`}>
                  <div className="whitespace-pre-wrap">{m.body}</div>
                  {m.content_ids.length > 0 && !mine && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {m.content_ids.map((id) => {
                        const c = content.find((x) => x.id === id);
                        return c ? <span key={id} className="chip !text-[12.5px]">{KIND_LABEL[c.kind]}: {c.title}</span> : null;
                      })}
                    </div>
                  )}
                  {m.actions.length > 0 && (
                    <div className="mt-2.5 flex flex-col gap-1.5">
                      {m.actions.map((a) => {
                        const taken = m.action_taken === a.id;
                        const disabled = Boolean(m.action_taken) || Boolean(busy);
                        return (
                          <button key={a.id} type="button" disabled={disabled} onClick={() => onAction(m, a)}
                            className={`rounded-pill border px-3 py-2 text-[14px] font-bold transition-colors disabled:cursor-default ${
                              taken ? 'border-ok/30 bg-ok/10 text-ok'
                                : a.kind === 'primary' ? 'border-gold-600/30 bg-gold-500 text-slate-950 hover:bg-amber-600 disabled:opacity-50'
                                  : 'border-black/[0.1] bg-white text-gold-600 hover:bg-gold-500/[0.08] disabled:opacity-50'}`}>
                            {busy === `${m.id}:${a.id}` ? '…' : taken ? `✓ ${a.label}` : a.label}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  <div className="tabular mt-1 text-end text-[11.5px] text-text-faint">{time(m.created_at)}</div>
                </div>
              </div>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>

      <div className="flex flex-col gap-2 border-t border-black/[0.06] p-3">
        {editable.length > 0 ? (
          <select value={targetId} onChange={(e) => setTarget(e.target.value)}
            className="w-full rounded-pill border border-[#E2E8F0] bg-ink-800 px-3.5 py-2 text-[14px] font-semibold text-text">
            {editable.map((c) => <option key={c.id} value={c.id}>לשנות את: {KIND_LABEL[c.kind]} · {c.title}</option>)}
          </select>
        ) : (
          <div className="px-1 text-[13.5px] text-text-faint">כשיהיו תכנים לאישור, אפשר לבקש כאן שינויים במילים שלך.</div>
        )}
        <div className="flex gap-2">
          <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') send(); }}
            disabled={!editable.length || busy === 'send'}
            placeholder={editable.length ? 'למשל: תקצרי את הכיתוב ותוסיפי שיש התקנה חינם בצפון' : ''}
            className="min-w-0 flex-1 rounded-pill border border-[#E2E8F0] bg-ink-800 px-4 py-3 text-[15px] focus:border-gold-500/60 focus:bg-white focus:outline-none" />
          <button type="button" onClick={send} disabled={!text.trim() || !targetId || busy === 'send'}
            className="rounded-pill bg-gold-500 px-5 text-[15px] font-extrabold text-slate-950 transition-colors hover:bg-amber-600 disabled:opacity-50">
            {busy === 'send' ? '…' : 'שלח'}
          </button>
        </div>
      </div>
    </div>
  );
}
