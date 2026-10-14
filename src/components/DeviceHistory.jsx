import { useMemo } from 'react';
import { useQuery } from '../hooks/useQuery';
import { getDeviceHistory } from '../lib/smartFleetQueries';
import { relativeTime } from '../lib/mappers';

/**
 * היסטוריה של מכשיר בצי החכם (phase68) — נפתחת בתוך הפירוט של השורה.
 * 1. ציר זמינות של 30 יום: ירוק = מחובר, אדום = מנותק, אפור = אין נתונים
 *    (לפני שהמכשיר חובר לענן / לפני שהתחיל הרישום ב-iot_status_events).
 * 2. מדדים: אחוז זמינות, מספר ניתוקים, הניתוק האחרון והניתוק הארוך ביותר.
 * 3. המילויים האחרונים מהשטח (oil_tracking) — רק למכשיר שמשויך למכשיר במערכת.
 * הכול נגזר מנתונים שכבר נשמרים — בלי טבלה חדשה.
 */

const DAY = 86400000;

function fmtDuration(ms) {
  const min = Math.round(ms / 60000);
  if (min < 60) return `${min} דק'`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h} שע'`;
  return `${Math.round(h / 24)} ימים`;
}

const fmtDate = (iso) => new Date(iso).toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' });

/** הופך את רשימת האירועים לקטעים רצופים על הציר */
function buildSegments(data, currentOnline) {
  const start = new Date(data.since).getTime();
  const end = Date.now();
  const segs = [];
  let cursor = start;
  let state = data.before ? data.before.online : null; // null = לא ידוע
  data.events.forEach((ev) => {
    const t = new Date(ev.happened_at).getTime();
    if (t > cursor) segs.push({ from: cursor, to: t, state });
    cursor = Math.max(cursor, t);
    state = ev.online;
  });
  // מהאירוע האחרון ועד עכשיו — לפי המצב הנוכחי של המכשיר (הכי עדכני)
  if (state === null && !data.events.length) state = null;
  segs.push({ from: cursor, to: end, state: data.events.length || data.before ? (currentOnline ?? state) : null });
  return { segs: segs.filter((s) => s.to > s.from), start, end };
}

export default function DeviceHistory({ row }) {
  const q = useQuery(() => getDeviceHistory(row.id, row.device?.id ?? null), [row.id, row.device?.id]);

  const stats = useMemo(() => {
    if (!q.data) return null;
    const { segs, start, end } = buildSegments(q.data, row.online);
    const known = segs.filter((s) => s.state !== null);
    const knownMs = known.reduce((a, s) => a + (s.to - s.from), 0);
    const onMs = known.filter((s) => s.state).reduce((a, s) => a + (s.to - s.from), 0);
    const offs = known.filter((s) => s.state === false);
    const longest = offs.reduce((m, s) => Math.max(m, s.to - s.from), 0);
    const lastOff = [...q.data.events].reverse().find((e) => e.online === false);
    const firstKnown = known.length ? known[0].from : null;
    return {
      segs, start, end,
      pct: knownMs ? Math.round((onMs / knownMs) * 1000) / 10 : null,
      drops: q.data.events.filter((e) => e.online === false).length,
      longest,
      lastOff,
      knownDays: firstKnown ? Math.max(1, Math.round((end - firstKnown) / DAY)) : 0,
    };
  }, [q.data, row.online]);

  if (q.loading) return <div className="text-[13px] text-text-faint">טוען היסטוריה…</div>;
  if (q.error) return <div className="text-[13px] text-crit-soft">לא הצלחתי לטעון היסטוריה: {q.error}</div>;
  if (!stats) return null;

  const total = stats.end - stats.start;
  const pctTone = stats.pct == null ? 'text-text-faint' : stats.pct >= 95 ? 'text-ok' : stats.pct >= 80 ? 'text-warn' : 'text-crit-soft';

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-[14px] font-bold">היסטוריה · 30 ימים אחרונים</span>
        {stats.knownDays > 0 && stats.knownDays < 30 && (
          <span className="text-[12px] text-text-faint">
            {stats.knownDays === 1 ? 'יש נתונים מהיום האחרון בלבד' : `יש נתונים מ-${stats.knownDays} הימים האחרונים`}
          </span>
        )}
      </div>

      {/* ציר זמינות */}
      <div>
        <div className="flex h-4 w-full overflow-hidden rounded-full bg-slate-500/15" dir="ltr">
          {stats.segs.map((s, i) => (
            <span
              key={i}
              title={`${s.state === null ? 'אין נתונים' : s.state ? 'מחובר' : 'מנותק'} · ${fmtDate(new Date(s.from).toISOString())} – ${fmtDate(new Date(s.to).toISOString())} · ${fmtDuration(s.to - s.from)}`}
              className={`h-full ${s.state === null ? 'bg-slate-400/30' : s.state ? 'bg-ok' : 'bg-crit'}`}
              style={{ width: `${((s.to - s.from) / total) * 100}%`, minWidth: s.state === false ? 3 : 0 }}
            />
          ))}
        </div>
        <div className="mt-1 flex justify-between text-[11.5px] text-text-faint" dir="ltr">
          <span>{fmtDate(new Date(stats.start).toISOString())}</span>
          <span>{fmtDate(new Date(stats.start + total / 2).toISOString())}</span>
          <span>היום</span>
        </div>
      </div>

      {/* מדדים */}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <div className="inner-row px-3 py-2">
          <div className="text-[12px] text-text-faint">זמינות</div>
          <div className={`tabular text-[20px] font-extrabold ${pctTone}`}>{stats.pct == null ? '—' : `${stats.pct}%`}</div>
        </div>
        <div className="inner-row px-3 py-2">
          <div className="text-[12px] text-text-faint">ניתוקים</div>
          <div className={`tabular text-[20px] font-extrabold ${stats.drops ? 'text-crit-soft' : ''}`}>{stats.drops}</div>
        </div>
        <div className="inner-row px-3 py-2">
          <div className="text-[12px] text-text-faint">הניתוק הארוך ביותר</div>
          <div className="tabular text-[17px] font-bold">{stats.longest ? fmtDuration(stats.longest) : '—'}</div>
        </div>
        <div className="inner-row px-3 py-2">
          <div className="text-[12px] text-text-faint">ניתוק אחרון</div>
          <div className="tabular text-[17px] font-bold">{stats.lastOff ? relativeTime(stats.lastOff.happened_at) : '—'}</div>
        </div>
      </div>

      {/* מילויים אחרונים */}
      {row.device?.id && (
        <div>
          <div className="mb-1.5 text-[13px] font-bold text-text-dim">מילויים אחרונים מהשטח</div>
          {!q.data.refills.length ? (
            <div className="text-[13px] text-text-faint">עוד אין רישומי מילוי למכשיר הזה.</div>
          ) : (
            <div className="flex flex-col gap-1">
              {q.data.refills.map((r) => {
                const ml = Math.round(Number(r.liters_added ?? 0) * 1000);
                return (
                  <div key={r.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 border-b border-slate-500/10 py-1 text-[13px] last:border-0">
                    <span className="tabular font-semibold">{fmtDate(r.recorded_at)}</span>
                    <span className={ml ? '' : 'text-text-faint'}>
                      {ml ? `${ml} מ״ל` : 'ביקור בלי מילוי'}
                    </span>
                    <span className="text-text-faint">{r.recorder?.full_name ?? ''}</span>
                    {r.notes && <span className="w-full text-[12px] text-text-faint">{r.notes}</span>}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
