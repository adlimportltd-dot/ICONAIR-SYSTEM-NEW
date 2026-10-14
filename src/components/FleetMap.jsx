import { useEffect, useRef, useState } from 'react';
import { saveLocationCoords } from '../lib/smartFleetQueries';

/**
 * מפה חיה לטאב "צי חכם" (phase67).
 *
 * כל נקודה = מיקום בשטח (לקוח חד-כתובתי או אתר של לקוח ריבוי-כתובות).
 * הצבע לפי המכשירים המחוברים לענן באותו מיקום:
 *   אדום — יש מכשיר מנותק · כתום — מיכל נמוך · ירוק — מחובר ופעיל · אפור — עוד לא מחובר לענן.
 *
 * מיקום בלי קואורדינטות (או שהכתובת שלו השתנתה) מומר לנקודה פעם אחת דרך
 * google.maps.Geocoder ונשמר ב-lat/lng (saveLocationCoords) — בפעם הבאה
 * הוא נטען מיד בלי פנייה לגוגל. משתמש באותו מפתח VITE_GOOGLE_MAPS_API_KEY
 * של אופטימיזציית המסלול (googleMaps.js); ל-Geocoder צריך שה-Geocoding API
 * יהיה מופעל למפתח הזה ב-Google Cloud.
 */

const COLORS = { crit: '#DC2626', warn: '#D97706', ok: '#16A34A', none: '#94A3B8' };
const LABELS = { crit: 'יש מכשיר מנותק', warn: 'מיכל נמוך', ok: 'מחובר ופעיל', none: 'לא מחובר לענן' };
const ISRAEL_CENTER = { lat: 32.79, lng: 35.05 };
const GEOCODE_BATCH = 60; // מקסימום המרות בכל פתיחה של המפה
const GEOCODE_DELAY_MS = 220;

let loader = null;
function loadMaps() {
  if (window.google?.maps?.Map) return Promise.resolve();
  if (loader) return loader;
  const key = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  if (!key) return Promise.reject(new Error('אין מפתח Google Maps במערכת (VITE_GOOGLE_MAPS_API_KEY)'));
  loader = new Promise((resolve, reject) => {
    const cb = '__iconairFleetMapReady';
    window[cb] = () => { delete window[cb]; resolve(); };
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&language=he&region=IL&callback=${cb}`;
    s.async = true;
    s.onerror = () => { loader = null; reject(new Error('טעינת Google Maps נכשלה — בדוק חיבור לרשת')); };
    document.head.appendChild(s);
  });
  return loader;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const queryOf = (loc) => `${loc.address || loc.city || ''}, ישראל`;

function pinIcon(tone, count) {
  const r = count >= 10 ? 13 : count >= 3 ? 11 : 9;
  const size = r * 2 + 6;
  const color = COLORS[tone] ?? COLORS.none;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <circle cx="${size / 2}" cy="${size / 2}" r="${r + 2}" fill="${color}" fill-opacity="0.25"/>
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="${color}" stroke="#fff" stroke-width="2"/>
    ${count > 1 ? `<text x="50%" y="54%" text-anchor="middle" dominant-baseline="middle" font-family="Arial" font-weight="700" font-size="${r > 10 ? 11 : 10}" fill="#fff">${count}</text>` : ''}
  </svg>`;
  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    scaledSize: new window.google.maps.Size(size, size),
    anchor: new window.google.maps.Point(size / 2, size / 2),
  };
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function infoHtml(loc) {
  const rows = loc.iot.map((it) => {
    const tone = !it.online ? COLORS.crit : it.low ? COLORS.warn : COLORS.ok;
    const label = !it.online ? 'מנותק' : it.low ? 'מיכל נמוך' : 'פעיל';
    return `<div style="display:flex;align-items:center;gap:6px;margin-top:3px">
      <span style="width:8px;height:8px;border-radius:50%;background:${tone};display:inline-block"></span>
      <span>${esc(it.where)}</span><span style="color:#64748b">· ${label}${it.pct != null ? ` · ${it.pct}%` : ''}</span></div>`;
  }).join('');
  return `<div dir="rtl" style="font-family:inherit;min-width:190px;max-width:260px;font-size:13px;line-height:1.4">
    <div style="font-weight:800;font-size:14px">${esc(loc.name)}</div>
    <div style="color:#64748b">${esc(loc.address || loc.city || '')}</div>
    <div style="margin-top:6px">${loc.deviceIds.length} מכשירים · ${loc.iot.length} מחוברים לענן${loc.line ? ` · ${esc(loc.line)}` : ''}</div>
    ${rows}
  </div>`;
}

export default function FleetMap({ locations, onSaved }) {
  const boxRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef([]);
  const infoRef = useRef(null);
  const fittedRef = useRef(false);
  const runningRef = useRef(false);
  const attemptedRef = useRef(new Set());
  const deniedRef = useRef(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [geo, setGeo] = useState({ running: false, done: 0, total: 0, failed: 0, denied: false });

  // טעינת המפה
  useEffect(() => {
    let alive = true;
    loadMaps()
      .then(() => {
        if (!alive || !boxRef.current) return;
        mapRef.current = new window.google.maps.Map(boxRef.current, {
          center: ISRAEL_CENTER,
          zoom: 10,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: true,
          clickableIcons: false,
          gestureHandling: 'greedy',
        });
        infoRef.current = new window.google.maps.InfoWindow();
        setReady(true);
      })
      .catch((e) => alive && setError(e.message));
    return () => { alive = false; };
  }, []);

  // ציור הנקודות
  useEffect(() => {
    if (!ready) return;
    markersRef.current.forEach((m) => m.setMap(null));
    markersRef.current = [];
    const bounds = new window.google.maps.LatLngBounds();
    const placed = locations.filter((l) => l.lat != null && l.lng != null);
    // נקודות באותו מקום בדיוק (כתובת לפי עיר בלבד) — הזזה קטנה כדי שלא יסתירו זו את זו
    const seen = new Map();
    placed.forEach((loc) => {
      const k = `${loc.lat.toFixed(5)},${loc.lng.toFixed(5)}`;
      const n = seen.get(k) ?? 0;
      seen.set(k, n + 1);
      const angle = n * 2.4;
      const pos = { lat: loc.lat + (n ? 0.0006 * Math.cos(angle) * Math.sqrt(n) : 0), lng: loc.lng + (n ? 0.0006 * Math.sin(angle) * Math.sqrt(n) : 0) };
      const marker = new window.google.maps.Marker({
        map: mapRef.current,
        position: pos,
        icon: pinIcon(loc.tone, loc.deviceIds.length),
        title: loc.name,
        zIndex: { crit: 4, warn: 3, ok: 2, none: 1 }[loc.tone] ?? 1,
      });
      marker.addListener('click', () => {
        infoRef.current.setContent(infoHtml(loc));
        infoRef.current.open({ map: mapRef.current, anchor: marker });
      });
      markersRef.current.push(marker);
      bounds.extend(pos);
    });
    if (placed.length && !fittedRef.current) {
      mapRef.current.fitBounds(bounds, 48);
      fittedRef.current = true;
    }
  }, [ready, locations]);

  // המרת כתובות חסרות לנקודות (פעם אחת לכל כתובת, נשמר במסד הנתונים)
  useEffect(() => {
    if (!ready || runningRef.current || deniedRef.current) return;
    const todo = locations
      .filter((l) => !attemptedRef.current.has(`${l.kind}:${l.id}`))
      .filter((l) => (l.address || l.city) && (l.lat == null || l.geocodeQuery !== queryOf(l)))
      .slice(0, GEOCODE_BATCH);
    if (!todo.length) return;
    todo.forEach((l) => attemptedRef.current.add(`${l.kind}:${l.id}`));
    runningRef.current = true;
    (async () => {
      setGeo({ running: true, done: 0, total: todo.length, failed: 0, denied: false });
      const geocoder = new window.google.maps.Geocoder();
      let done = 0;
      let failed = 0;
      for (const loc of todo) {
        const q = queryOf(loc);
        try {
          const res = await geocoder.geocode({ address: q, region: 'il' });
          const p = res.results?.[0]?.geometry?.location;
          if (p) await saveLocationCoords(loc, p.lat(), p.lng(), q);
          else failed += 1;
        } catch (e) {
          const msg = String(e?.code || e?.message || e);
          if (/REQUEST_DENIED|not authorized|ApiNotActivated/i.test(msg)) {
            deniedRef.current = true;
            runningRef.current = false;
            setGeo({ running: false, done, total: todo.length, failed, denied: true });
            return;
          }
          failed += 1;
        }
        done += 1;
        setGeo({ running: true, done, total: todo.length, failed, denied: false });
        await sleep(GEOCODE_DELAY_MS);
      }
      runningRef.current = false;
      setGeo({ running: false, done, total: todo.length, failed, denied: false });
      onSaved?.();
    })();
  }, [ready, locations]); // eslint-disable-line react-hooks/exhaustive-deps

  const counts = locations.reduce((acc, l) => { acc[l.tone] = (acc[l.tone] ?? 0) + 1; return acc; }, {});
  const missing = locations.filter((l) => l.lat == null).length;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-3 text-[13px]">
          {['crit', 'warn', 'ok', 'none'].map((t) => (
            <span key={t} className="inline-flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-full border-2 border-white shadow" style={{ background: COLORS[t] }} />
              <span className="font-semibold">{LABELS[t]}</span>
              <span className="tabular text-text-faint">{counts[t] ?? 0}</span>
            </span>
          ))}
        </div>
        <span className="text-[12.5px] text-text-faint">
          {locations.length} מיקומים{missing ? ` · ${missing} עוד בלי נקודה על המפה` : ''}
        </span>
      </div>

      {geo.running && (
        <div className="inner-row px-4 py-2.5 text-[13.5px]">
          ממיר כתובות לנקודות על המפה… {geo.done}/{geo.total}
        </div>
      )}
      {geo.denied && (
        <div className="inner-row !border-warn/40 px-4 py-2.5 text-[13.5px] text-warn">
          גוגל לא מאפשר המרת כתובות עם המפתח הנוכחי. צריך להפעיל את Geocoding API למפתח ב-Google Cloud Console.
        </div>
      )}
      {!geo.running && !geo.denied && geo.failed > 0 && (
        <div className="inner-row px-4 py-2.5 text-[13.5px] text-text-faint">
          {geo.failed} כתובות לא נמצאו בגוגל — כדאי לבדוק את הכתובת בכרטיס הלקוח.
        </div>
      )}
      {error && <div className="inner-row !border-crit/40 px-4 py-3 text-[14px] text-crit-soft">{error}</div>}

      <div
        ref={boxRef}
        className="h-[62vh] min-h-[380px] w-full overflow-hidden rounded-2xl border border-slate-500/20 md:h-[70vh]"
        style={{ background: '#e5e7eb' }}
      />
    </div>
  );
}
