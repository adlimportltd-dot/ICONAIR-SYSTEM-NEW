import { useEffect, useMemo, useState } from 'react';
import Modal from './ui/Modal';
import { TextInput } from './ui/Field';
import { loadLookupIndex, getStopHistory } from '../lib/lookupQueries';

/**
 * חיפוש מהיר "מתי היינו?" — 2026-10-20, בקשה מפורשת של ליאור: לקוח מתקשר
 * ושואל מתי היה מילוי בכתובת; מקלידים כתובת או שם, ומיד רואים ביקור אחרון,
 * ביקור קודם, סטטוס החודש והמכשירים. נפתח מכפתור החיפוש בשורה העליונה.
 * קריאה בלבד.
 */

const fmtDate = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: '2-digit', timeZone: 'Asia/Jerusalem' });
};

const daysAgo = (iso) => {
  if (!iso) return null;
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (diff <= 0) return 'היום';
  if (diff === 1) return 'אתמול';
  return `לפני ${diff} ימים`;
};

const MONTH_STATUS = {
  done: { label: 'בוצע החודש', cls: 'border-emerald-500/30 bg-emerald-500/[0.1] text-emerald-700' },
  skipped: { label: 'סגור / לא נמצא החודש', cls: 'border-crit/30 bg-crit/[0.08] text-crit-soft' },
  pending: { label: 'עוד לא בוצע החודש', cls: 'border-gold-500/30 bg-gold-500/[0.1] text-gold-600' },
};

function StopDetails({ stop }) {
  const [state, setState] = useState({ loading: true, data: null, error: null });

  useEffect(() => {
    let alive = true;
    setState({ loading: true, data: null, error: null });
    getStopHistory(stop)
      .then((data) => alive && setState({ loading: false, data, error: null }))
      .catch((error) => alive && setState({ loading: false, data: null, error }));
    return () => { alive = false; };
  }, [stop.key]);

  if (state.loading) return <div className="px-1 py-3 text-[14px] text-text-faint">טוען…</div>;
  if (state.error) return <div className="px-1 py-3 text-[14px] text-crit-soft">לא הצלחתי לטעון את ההיסטוריה.</div>;

  const { devices, visits, month, firstAdded } = state.data;
  const [last, prev] = visits;
  const monthInfo = month ? MONTH_STATUS[month.status] : null;

  return (
    <div className="flex flex-col gap-3">
      {last ? (
        <div className="rounded-row border border-emerald-500/25 bg-emerald-500/[0.07] px-3.5 py-3">
          <div className="text-[13px] font-semibold text-text-faint">ביקור אחרון</div>
          <div className="mt-0.5 text-[20px] font-bold text-text">
            {fmtDate(last.at)} <span className="text-[14px] font-medium text-text-dim">· {daysAgo(last.at)}</span>
          </div>
          <div className="mt-0.5 text-[14px] text-text-dim">
            {last.who || 'טכנאי'} · {last.liters > 0 ? `${last.liters} ל׳` : 'ביקור ללא מילוי'}
            {last.deviceCount > 1 ? ` · ${last.deviceCount} מכשירים` : ''}
          </div>
          {last.notes.length > 0 && (
            <div className="mt-1 text-[13px] text-text-faint">📝 {last.notes.join(' · ')}</div>
          )}
        </div>
      ) : (
        <div className="rounded-row border border-gold-500/30 bg-gold-500/[0.08] px-3.5 py-3">
          <div className="text-[16px] font-bold text-gold-600">טרם בוצע מילוי בכתובת הזו</div>
          {firstAdded && (
            <div className="mt-0.5 text-[14px] text-text-dim">נוספה למערכת ב-{fmtDate(firstAdded)}</div>
          )}
        </div>
      )}

      {prev && (
        <div className="px-1 text-[14px] text-text-dim">
          <b className="font-semibold text-text">ביקור קודם:</b> {fmtDate(prev.at)} · {prev.who || 'טכנאי'}
          {' · '}{prev.liters > 0 ? `${prev.liters} ל׳` : 'ללא מילוי'}
        </div>
      )}

      {monthInfo && (
        <div className={`self-start rounded-pill border px-3 py-1 text-[13px] font-semibold ${monthInfo.cls}`}>
          {monthInfo.label}
          {month.status === 'skipped' && month.closed_reason ? ` (${month.closed_reason})` : ''}
        </div>
      )}

      {visits.length > 2 && (
        <div className="px-1 text-[13px] text-text-faint">
          ביקורים קודמים: {visits.slice(2).map((v) => fmtDate(v.at)).join(' · ')}
        </div>
      )}

      <div className="border-t border-black/[0.06] pt-2.5">
        <div className="mb-1 px-1 text-[13px] font-semibold text-text-faint">מכשירים בכתובת ({devices.length})</div>
        {devices.length === 0 ? (
          <div className="px-1 text-[14px] text-text-faint">אין מכשירים פעילים.</div>
        ) : devices.map((d) => (
          <div key={d.id} className="px-1 text-[14px] text-text-dim">
            • {d.model}{d.location_note ? ` · ${d.location_note}` : ''}{d.scent_name ? ` · ${d.scent_name}` : ''}
            <span className="text-text-faint"> · {d.serial}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function QuickLookup({ open, onClose }) {
  const [index, setIndex] = useState(null);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState(null);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setPicked(null);
    setError(null);
    loadLookupIndex().then(setIndex).catch(setError);
  }, [open]);

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!index || needle.length < 2) return [];
    const words = needle.split(/\s+/);
    return index
      .filter((s) => {
        const hay = `${s.title} ${s.address}`.toLowerCase();
        return words.every((w) => hay.includes(w));
      })
      .slice(0, 30);
  }, [index, query]);

  return (
    <Modal open={open} title="מתי היינו?" subtitle="הקלד כתובת או שם לקוח — ביקור אחרון, ביקור קודם וסטטוס החודש" onClose={onClose}>
      <div className="flex flex-col gap-3">
        <TextInput
          autoFocus
          value={query}
          onChange={(e) => { setQuery(e.target.value); setPicked(null); }}
          placeholder="למשל: שניר 11, דודו דותן 6, גשר הזיו…"
          autoComplete="off"
        />

        {error && <div className="text-[14px] text-crit-soft">לא הצלחתי לטעון את רשימת הכתובות.</div>}
        {!index && !error && <div className="text-[14px] text-text-faint">טוען כתובות…</div>}

        {picked ? (
          <>
            <button type="button" onClick={() => setPicked(null)}
              className="self-start text-[13px] font-semibold text-gold-600 hover:underline">
              ← חזרה לתוצאות
            </button>
            <div>
              <div className="text-[16px] font-bold text-text">{picked.title}</div>
              {picked.address && <div className="text-[14px] text-text-faint">{picked.address}</div>}
            </div>
            <StopDetails stop={picked} />
          </>
        ) : (
          index && query.trim().length >= 2 && (
            results.length === 0 ? (
              <div className="text-[14px] text-text-faint">לא נמצאה כתובת מתאימה.</div>
            ) : (
              <div className="max-h-[50vh] overflow-y-auto rounded-card border border-black/[0.08]">
                {results.map((s) => (
                  <button key={s.key} type="button" onClick={() => setPicked(s)}
                    className="block w-full border-b border-black/[0.06] px-3.5 py-2.5 text-start last:border-b-0 hover:bg-gold-500/[0.07]">
                    <div className="text-[15px] font-semibold text-text">
                      {s.title}{s.inactive ? <span className="text-[12px] font-medium text-text-faint"> · לא פעיל</span> : null}
                    </div>
                    {s.address && <div className="text-[13px] text-text-faint">{s.address}</div>}
                  </button>
                ))}
              </div>
            )
          )
        )}
      </div>
    </Modal>
  );
}
