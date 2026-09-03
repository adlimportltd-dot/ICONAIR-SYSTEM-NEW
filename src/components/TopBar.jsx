import { useEffect, useRef, useState } from 'react';
import { Brand } from './Sidebar';
import { SearchIcon, BellIcon, PlusIcon } from './ui/Icons';
import { relativeTime } from '../lib/mappers';

/** שם עצירה קריא: שם הלקוח, ועם תווית הבניין אם זו עצירת-אתר (אוורסט וכו') */
function stopLabel(visit) {
  const name = visit.customer?.name ?? visit.site?.label ?? 'לקוח';
  return visit.site?.label ? `${name} — ${visit.site.label}` : name;
}

/**
 * פעמון ההתראות: פותח פאנל עם הביקורים שהושלמו לאחרונה (route_assignments
 * status='done'). נטען בעצלנות — רק כשנפתח בפעם הראשונה — ומתעדכן
 * אוטומטית בזמן אמת דרך ה-refetch שה-Shell כבר מריץ על שינויים ב-route_assignments.
 */
function NotificationsBell({ alerts, completedVisits, loading, onOpen }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    function onDocClick(event) {
      if (ref.current && !ref.current.contains(event.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  function toggle() {
    setOpen((prev) => {
      if (!prev) onOpen?.();
      return !prev;
    });
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-label={alerts > 0 ? `${alerts} התראות פתוחות` : 'התראות'}
        className="relative grid h-10 w-10 flex-none place-items-center rounded-pill
                   border border-white/[0.075] bg-white/[0.03] text-text-dim
                   transition-colors hover:border-gold-500/35 hover:text-gold-300"
      >
        <BellIcon className="h-[18px] w-[18px]" />
        {alerts > 0 && (
          <span className="absolute left-2.5 top-[9px] h-[7px] w-[7px] rounded-full bg-crit
                           ring-[2.5px] ring-ink-900" />
        )}
      </button>

      {open && (
        <div
          className="glass absolute end-0 top-[calc(100%+8px)] z-30 max-h-[360px] w-[300px]
                     overflow-y-auto rounded-panel p-2 shadow-lift"
        >
          <div className="px-2.5 py-2 text-[11px] font-semibold tracking-wide text-text-faint">
            ביקורים שהושלמו לאחרונה
          </div>

          {loading && (
            <div className="px-2.5 py-3 text-[12.5px] text-text-faint">טוען…</div>
          )}

          {!loading && completedVisits.length === 0 && (
            <div className="px-2.5 py-3 text-[12.5px] text-text-faint">אין עדיין ביקורים שהושלמו.</div>
          )}

          {!loading && completedVisits.map((visit) => (
            <div key={visit.id} className="inner-row mb-1.5 flex items-center gap-2.5 px-3 py-2.5 last:mb-0">
              <span className="h-2 w-2 flex-none rounded-full bg-ok" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12.5px] font-semibold">{stopLabel(visit)}</div>
                <div className="mt-0.5 truncate text-[11px] text-text-faint">
                  {visit.route?.name ?? 'ללא קו'} · {relativeTime(visit.updated_at)}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * שורה עליונה דביקה: זהות המסך, חיפוש, מצב הצי בזמן אמת ופעולות מהירות.
 * בנייד הלוגו מחליף את כותרת המסך כדי לחסוך רוחב.
 */
export default function TopBar({
  title, meta, online, total, alerts = 0, completedVisits = [], completedVisitsLoading = false,
  onOpenNotifications, onNewCall, onSearch,
}) {
  const allOnline = total > 0 && online === total;

  return (
    <header className="glass sticky top-2 z-[15] mb-[18px] flex items-center gap-3 rounded-panel px-3.5 py-3">
      <div className="lg:hidden">
        <Brand compact />
      </div>

      <div className="hidden min-w-0 flex-col lg:flex">
        <h1 className="font-display text-[22px] font-bold leading-tight">{title}</h1>
        <div className="tabular mt-0.5 truncate text-[12.5px] text-text-faint">{meta}</div>
      </div>

      <button
        type="button"
        onClick={onSearch}
        className="ms-auto hidden min-w-[230px] items-center gap-[9px] rounded-pill
                   border border-white/[0.075] bg-black/25 px-3.5 py-[9px]
                   text-[13.5px] text-text-faint transition-colors hover:text-text-dim md:flex"
      >
        <SearchIcon className="h-4 w-4" />
        חיפוש לקוח, מכשיר או קריאה…
      </button>

      {total > 0 && (
        <div
          className={`tabular hidden items-center gap-[7px] rounded-xl border px-[13px] py-2
                      text-xs font-semibold wide:flex
                      ${allOnline
                        ? 'border-ok/20 bg-ok/[0.07] text-ok'
                        : 'border-warn/25 bg-warn/[0.07] text-warn'}`}
        >
          <span className={`h-[7px] w-[7px] rounded-full ${allOnline ? 'animate-pulse-dot bg-ok' : 'bg-warn'}`} />
          {online} / {total} מקוונים
        </div>
      )}

      <NotificationsBell
        alerts={alerts}
        completedVisits={completedVisits}
        loading={completedVisitsLoading}
        onOpen={onOpenNotifications}
      />

      <button
        type="button"
        aria-label="קריאת שירות חדשה"
        onClick={onNewCall}
        className="grid h-10 w-10 flex-none place-items-center rounded-pill
                   border border-white/[0.075] bg-white/[0.03] text-text-dim
                   transition-colors hover:border-gold-500/35 hover:text-gold-300"
      >
        <PlusIcon className="h-[18px] w-[18px]" />
      </button>
    </header>
  );
}
