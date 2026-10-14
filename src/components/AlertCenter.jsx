import { useCallback, useEffect, useState } from 'react';
import { loadAlerts, ackAlert } from '../lib/alertsQueries';
import { relativeTime } from '../lib/mappers';
import { useAuth } from '../context/AuthContext';

/**
 * מרכז התראות (phase69) — "דורש טיפול" בראש פאנל הפעמון, מנהלים בלבד.
 * useAlertCenter טוען פעם ב-2 דקות (וגם בכל פתיחה של הפעמון), כדי שהמספר
 * האדום על הפעמון יהיה עדכני גם בלי לפתוח אותו.
 */

const REFRESH_MS = 120000;

export function useAlertCenter(enabled) {
  const [state, setState] = useState({ alerts: [], loading: enabled, error: null });

  const refresh = useCallback(async () => {
    if (!enabled) return;
    try {
      const alerts = await loadAlerts();
      setState({ alerts, loading: false, error: null });
    } catch (e) {
      setState((prev) => ({ ...prev, loading: false, error: e?.message ?? 'שגיאה בטעינת ההתראות' }));
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return undefined;
    refresh();
    const t = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(t);
  }, [enabled, refresh]);

  return { ...state, count: state.alerts.length, refresh, setState };
}

const DOT = { crit: 'bg-crit', warn: 'bg-warn', info: 'bg-slate-400' };
const GROUP_LABEL = { fleet: 'צי חכם', theft: 'מכשיר חסר', calls: 'קריאת שירות', notes: 'הערת שטח' };
const TARGET_LABEL = { smart_fleet: 'לצי חכם', routes: 'למסלולים', service: 'לקריאות', dashboard: 'לדשבורד' };

export default function AlertCenter({ ac, onNavigate, onClose }) {
  const auth = useAuth();
  const email = auth?.user?.email ?? auth?.session?.user?.email ?? auth?.profile?.email ?? null;
  const [busy, setBusy] = useState(null);
  const [showAll, setShowAll] = useState(false);

  async function done(alert) {
    setBusy(alert.key);
    try {
      await ackAlert(alert, email);
      ac.setState((prev) => ({ ...prev, alerts: prev.alerts.filter((a) => a.key !== alert.key) }));
    } catch (e) {
      ac.setState((prev) => ({ ...prev, error: e?.message ?? 'הסימון נכשל' }));
    } finally {
      setBusy(null);
    }
  }

  const list = showAll ? ac.alerts : ac.alerts.slice(0, 8);

  return (
    <div className="mb-2 border-b border-black/[0.06] pb-2">
      <div className="flex items-center justify-between px-2.5 py-2">
        <span className="text-[13px] font-semibold tracking-wide text-text-faint">דורש טיפול</span>
        {ac.count > 0 && (
          <span className="tabular rounded-full bg-crit/10 px-2 py-0.5 text-[12px] font-bold text-crit-soft">{ac.count}</span>
        )}
      </div>

      {ac.loading && <div className="px-2.5 py-2 text-[14px] text-text-faint">טוען…</div>}
      {ac.error && <div className="px-2.5 py-2 text-[13px] text-crit-soft">{ac.error}</div>}
      {!ac.loading && !ac.error && ac.count === 0 && (
        <div className="px-2.5 py-2 text-[14px] font-semibold text-ok">✓ אין כרגע משהו שדורש טיפול</div>
      )}

      {list.map((a) => (
        <div key={a.key} className="inner-row mb-1.5 flex flex-col gap-1.5 px-3 py-2.5 last:mb-0">
          <div className="flex items-start gap-2.5">
            <span className={`mt-1.5 h-2 w-2 flex-none rounded-full ${DOT[a.level] ?? DOT.info}`} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[14px] font-semibold">{a.title}</div>
              <div className="mt-0.5 line-clamp-2 text-[13px] text-text-dim">{a.text}</div>
              <div className="mt-0.5 text-[12px] text-text-faint">
                {GROUP_LABEL[a.group]}{a.at ? ` · ${relativeTime(a.at)}` : ''}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5 ps-[18px]">
            {a.target && onNavigate && (
              <button
                type="button"
                onClick={() => { onNavigate(a.target); onClose?.(); }}
                className="rounded-[7px] border border-black/[0.09] px-2.5 py-1 text-[12px] font-semibold text-text-dim transition-colors hover:border-gold-300/40 hover:text-gold-600"
              >
                {TARGET_LABEL[a.target] ?? 'פתח'}
              </button>
            )}
            {!a.fixed && (
              <button
                type="button"
                onClick={() => done(a)}
                disabled={busy === a.key}
                className="rounded-[7px] border border-ok/30 bg-ok/[0.08] px-2.5 py-1 text-[12px] font-semibold text-ok transition-colors hover:border-ok/50 disabled:opacity-50"
              >
                {busy === a.key ? '…' : 'טופל ✓'}
              </button>
            )}
          </div>
        </div>
      ))}

      {ac.count > 8 && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="mt-1 w-full rounded-row px-2.5 py-1.5 text-[13px] font-semibold text-gold-600 hover:bg-black/[0.03]"
        >
          {showAll ? 'הצג פחות' : `הצג את כל ${ac.count} ההתראות`}
        </button>
      )}
    </div>
  );
}
