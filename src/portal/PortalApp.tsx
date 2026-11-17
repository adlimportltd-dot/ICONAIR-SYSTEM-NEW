/**
 * פורטל לקוח (phase61) — נפתח מ-?portal=TOKEN, בלי התחברות.
 * כל הנתונים מגיעים רק דרך פונקציות portal_* ב-Supabase שבודקות את הקישור
 * ומחזירות אך ורק את הנתונים של אותו לקוח (ר' iconair_schema_phase61_customer_portal.sql).
 * הלקוח לא מקבל שום גישה לטבלאות המערכת עצמן.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { supabase } from '../lib/supabase';

type Site = {
  id: string;
  label: string;
  city: string | null;
  access_code: string | null;
  devices: number;
  last_visit: string | null;
  next_window: string | null;
  open_calls: number;
};

type Call = {
  code: string;
  title: string;
  description: string | null;
  status: 'open' | 'in_progress' | 'resolved' | 'cancelled';
  opened_at: string;
  closed_at: string | null;
  resolution: string | null;
  site: string | null;
  site_id: string | null;
};

type Overview = { customer: string; sites: Site[]; calls: Call[] };

type Visit = { date: string; devices: number; filled: number; technician: string | null };
type Device = { model: string | null; location: string | null; scent: string | null };
type SiteDetail = { devices: Device[]; visits: Visit[] };

type VisitRow = {
  location: string | null;
  model: string | null;
  scent: string | null;
  liters: number | null;
  status: 'filled' | 'checked' | 'none';
  notes: string | null;
  technician: string | null;
};

type Kind = 'fault' | 'install' | 'removed' | 'other';

const KIND_LABEL: Record<Kind, string> = {
  fault: 'אין ריח / תקלה',
  install: 'בקשת התקנה / החלפה',
  removed: 'הורדנו מכשיר',
  other: 'פנייה אחרת',
};

const CALL_STATUS: Record<Call['status'], { label: string; cls: string }> = {
  open: { label: 'פתוחה', cls: 'text-crit border-crit/30 bg-crit/[0.06]' },
  in_progress: { label: 'בטיפול', cls: 'text-warn border-warn/30 bg-warn/[0.08]' },
  resolved: { label: 'טופלה', cls: 'text-ok border-ok/30 bg-ok/[0.08]' },
  cancelled: { label: 'בוטלה', cls: 'text-text-faint border-black/[0.12] bg-black/[0.03]' },
};

const ROW_STATUS: Record<VisitRow['status'], { label: string; cls: string }> = {
  filled: { label: 'מולא', cls: 'text-ok' },
  checked: { label: 'נבדק ללא מילוי', cls: 'text-warn' },
  none: { label: 'לא טופל בביקור זה', cls: 'text-text-faint' },
};

function fmtDate(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value.length === 10 ? `${value}T12:00:00` : value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: '2-digit', timeZone: 'Asia/Jerusalem' });
}

function errText(error: unknown): string {
  const msg = (error as { message?: string })?.message ?? String(error);
  if (/Failed to fetch|NetworkError/i.test(msg)) return 'אין חיבור לאינטרנט. נסו שוב.';
  return msg;
}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  if (!supabase) throw new Error('המערכת אינה זמינה כרגע');
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return data as T;
}

/* ---------- רכיבי עיצוב קטנים ---------- */

function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`glass rounded-2xl p-5 sm:p-6 ${className}`}>{children}</section>;
}

function PrimaryBtn(props: { children: ReactNode; onClick?: () => void; disabled?: boolean; type?: 'button' | 'submit' }) {
  return (
    <button
      type={props.type ?? 'button'}
      onClick={props.onClick}
      disabled={props.disabled}
      className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-gold-500 px-5 text-[15px] font-extrabold text-slate-950 transition hover:bg-amber-600 disabled:opacity-50"
    >
      {props.children}
    </button>
  );
}

function GhostBtn(props: { children: ReactNode; onClick?: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      disabled={props.disabled}
      className="ghost-btn inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-[#CBD5E1] bg-white px-4 text-[15px] font-bold text-text transition hover:bg-gold-500/[0.07] disabled:opacity-50"
    >
      {props.children}
    </button>
  );
}

const inputCls =
  'w-full min-h-[44px] rounded-xl border border-[#E2E8F0] bg-ink-800 px-4 text-[15px] text-text outline-none focus:border-gold-500';

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[14px] font-bold text-text">{label}</span>
      {children}
    </label>
  );
}

/* ---------- טופס פנייה ---------- */

function RequestSheet(props: {
  token: string;
  sites: Site[];
  initialSite: string | null;
  initialKind: Kind;
  onClose: () => void;
  onDone: (code: string) => void;
}) {
  const [kind, setKind] = useState<Kind>(props.initialKind);
  const [siteId, setSiteId] = useState<string>(props.initialSite ?? '');
  const [siteQuery, setSiteQuery] = useState('');
  const [floor, setFloor] = useState('');
  const [description, setDescription] = useState('');
  const [reporter, setReporter] = useState(() => {
    try { return localStorage.getItem('portal_reporter') ?? ''; } catch { return ''; }
  });
  const [date, setDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filteredSites = useMemo(() => {
    const q = siteQuery.trim();
    return q ? props.sites.filter((s) => `${s.label} ${s.city ?? ''}`.includes(q)) : props.sites;
  }, [props.sites, siteQuery]);

  async function submit() {
    if (!siteId) { setError('בחרו כתובת'); return; }
    if (kind === 'fault' && !floor.trim() && !description.trim()) { setError('כתבו קומה או פירוט קצר'); return; }
    setBusy(true);
    setError(null);
    try {
      try { localStorage.setItem('portal_reporter', reporter); } catch { /* לא קריטי */ }
      const code = await rpc<string>('portal_open_call', {
        p_token: props.token,
        p_site: siteId,
        p_kind: kind,
        p_floor: floor,
        p_description: description,
        p_reporter: reporter || null,
        p_requested_date: kind === 'install' && date ? date : null,
      });
      props.onDone(code);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/65 sm:items-center" onClick={props.onClose}>
      <div
        className="glass max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-5 sm:rounded-2xl sm:p-6"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="mb-5 flex items-center justify-between gap-3">
          <h2 className="font-display text-[22px] font-bold text-text">פנייה חדשה</h2>
          <button type="button" onClick={props.onClose} className="text-[15px] font-bold text-text-dim">סגירה</button>
        </div>

        <div className="space-y-4">
          <Field label="סוג הפנייה">
            <div className="grid grid-cols-2 gap-2">
              {(Object.keys(KIND_LABEL) as Kind[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKind(k)}
                  className={`min-h-[44px] rounded-xl border px-3 text-[14px] font-bold transition ${
                    kind === k ? 'border-gold-500 bg-gold-500/[0.12] text-text' : 'border-[#E2E8F0] bg-white text-text-dim'
                  }`}
                >
                  {KIND_LABEL[k]}
                </button>
              ))}
            </div>
          </Field>

          <Field label="כתובת">
            {props.initialSite ? (
              <div className="inner-row rounded-xl px-4 py-3 text-[15px] font-bold text-text">
                {props.sites.find((s) => s.id === siteId)?.label}
              </div>
            ) : (
              <>
                <input className={`${inputCls} mb-2`} placeholder="חיפוש כתובת..." value={siteQuery} onChange={(e) => setSiteQuery(e.target.value)} />
                <select className={inputCls} value={siteId} onChange={(e) => setSiteId(e.target.value)}>
                  <option value="">בחרו כתובת</option>
                  {filteredSites.map((s) => (
                    <option key={s.id} value={s.id}>{s.label}{s.city ? `, ${s.city}` : ''}</option>
                  ))}
                </select>
              </>
            )}
          </Field>

          <Field label={kind === 'install' ? 'איפה (לובי / קומות)' : 'קומה / מיקום'}>
            <input className={inputCls} value={floor} onChange={(e) => setFloor(e.target.value)} placeholder={kind === 'install' ? 'למשל: לובי + 2 קומות מינוס' : 'למשל: קומה 6'} />
          </Field>

          {kind === 'install' && (
            <Field label="תאריך מבוקש (לא חובה)">
              <input type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
          )}

          <Field label="פירוט">
            <textarea className={`${inputCls} min-h-[96px] py-3`} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="מה קרה? כל פרט עוזר לטכנאי" />
          </Field>

          <Field label="שם פותח הפנייה">
            <input className={inputCls} value={reporter} onChange={(e) => setReporter(e.target.value)} />
          </Field>

          {error && <p className="text-[14px] font-bold text-crit">{error}</p>}

          <div className="flex gap-3 pt-1">
            <PrimaryBtn onClick={submit} disabled={busy}>{busy ? 'שולח...' : 'שליחת הפנייה'}</PrimaryBtn>
            <GhostBtn onClick={props.onClose}>ביטול</GhostBtn>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------- ביקור בודד (טבלה + PDF) ---------- */

function VisitTable(props: { token: string; site: Site; visit: Visit; customer: string }) {
  const [rows, setRows] = useState<VisitRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    rpc<VisitRow[]>('portal_visit', { p_token: props.token, p_site: props.site.id, p_date: props.visit.date })
      .then((r) => { if (alive) setRows(r); })
      .catch((e) => { if (alive) setError(errText(e)); });
    return () => { alive = false; };
  }, [props.token, props.site.id, props.visit.date]);

  async function downloadPdf() {
    if (!ref.current) return;
    setPdfBusy(true);
    try {
      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')]);
      // ה-PDF תמיד בפריסת טבלה ברוחב מסמך, גם כשמורידים מהטלפון (שבו מוצגים כרטיסים)
      const el = ref.current;
      el.classList.add('pdf-mode');
      el.style.width = '760px';
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      let canvas: HTMLCanvasElement;
      try {
        canvas = await html2canvas(el, { scale: 2, backgroundColor: '#FFFFFF', windowWidth: 800 });
      } finally {
        el.classList.remove('pdf-mode');
        el.style.width = '';
      }
      const doc = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'portrait' });
      const pageW = doc.internal.pageSize.getWidth();
      const pageH = doc.internal.pageSize.getHeight();
      const margin = 24;
      const imgW = pageW - margin * 2;
      const imgH = (canvas.height * imgW) / canvas.width;
      const img = canvas.toDataURL('image/jpeg', 0.92);
      let y = 0;
      while (y < imgH) {
        if (y > 0) doc.addPage();
        doc.addImage(img, 'JPEG', margin, margin - y, imgW, imgH);
        y += pageH - margin * 2;
      }
      doc.save(`דוח ביקור ${props.site.label} ${fmtDate(props.visit.date).replace(/\./g, '-')}.pdf`);
    } catch (e) {
      setError(`יצירת ה-PDF נכשלה: ${errText(e)}`);
    } finally {
      setPdfBusy(false);
    }
  }

  if (error) return <p className="mt-3 text-[14px] font-bold text-crit">{error}</p>;
  if (!rows) return <p className="mt-3 text-[14px] text-text-faint">טוען...</p>;

  return (
    <div className="mt-4">
      <div ref={ref} className="group bg-white p-1" dir="rtl">
        <div className="mb-3">
          <div className="text-[13px] font-bold tracking-[0.8px] text-gold-600">ICON AIR · דוח ביקור</div>
          <div className="font-display text-[20px] font-bold text-text">{props.site.label}{props.site.city ? `, ${props.site.city}` : ''}</div>
          <div className="text-[14px] text-text-dim">
            {props.customer} · ביקור {fmtDate(props.visit.date)} · טכנאי: {props.visit.technician ?? '—'} ·{' '}
            <span className="tabular">{props.visit.filled}</span> מתוך <span className="tabular">{props.visit.devices}</span> מכשירים מולאו
          </div>
        </div>
        {/* טלפון: כרטיס לכל מכשיר, כדי שכמות וסטטוס תמיד ייראו בלי גלילה הצידה */}
        <div className="space-y-2 sm:hidden group-[.pdf-mode]:hidden">
          {rows.map((r, i) => (
            <div key={i} className="inner-row rounded-xl px-3.5 py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <span className="text-[15px] font-bold text-text">{r.location || '—'}</span>
                <span className={`text-[14px] font-bold ${ROW_STATUS[r.status].cls}`}>
                  {ROW_STATUS[r.status].label}
                  {r.liters ? <span className="tabular font-normal text-text-dim"> · {r.liters} ל׳</span> : null}
                </span>
              </div>
              <div className="mt-0.5 text-[13.5px] text-text-dim">
                <span dir="ltr" className="inline-block whitespace-nowrap">{r.model || '—'}</span> · {r.scent || '—'}
              </div>
              {r.notes && <div className="mt-1 text-[13px] text-text-faint">{r.notes}</div>}
            </div>
          ))}
        </div>
        <div className="hidden overflow-x-auto sm:block group-[.pdf-mode]:block">
          <table className="w-full border-collapse text-[14px]">
            <thead>
              <tr className="text-[12.5px] font-semibold tracking-[0.8px] text-text-faint">
                <th className="px-3 py-2 text-start">מיקום</th>
                <th className="px-3 py-2 text-start">דגם</th>
                <th className="px-3 py-2 text-start">ניחוח</th>
                <th className="px-3 py-2 text-start">כמות</th>
                <th className="px-3 py-2 text-start">סטטוס</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-t border-black/[0.075] align-top">
                  <td className="px-3 py-2.5 font-bold text-text">{r.location || '—'}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-text-dim"><span dir="ltr">{r.model || '—'}</span></td>
                  <td className="px-3 py-2.5 text-text-dim">{r.scent || '—'}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 tabular text-text-dim">{r.liters ? `${r.liters} ל׳` : '—'}</td>
                  <td className={`px-3 py-2.5 font-bold ${ROW_STATUS[r.status].cls}`}>
                    {ROW_STATUS[r.status].label}
                    {r.notes && <div className="text-[13px] font-normal text-text-faint">{r.notes}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="mt-3">
        <GhostBtn onClick={downloadPdf} disabled={pdfBusy}>{pdfBusy ? 'מכין PDF...' : 'הורדת PDF'}</GhostBtn>
      </div>
    </div>
  );
}

/* ---------- מסך בניין ---------- */

function SiteView(props: {
  token: string;
  site: Site;
  customer: string;
  calls: Call[];
  onBack: () => void;
  onRequest: (kind: Kind) => void;
  onCodeSaved: () => void;
  initialDate?: string | null;
}) {
  const [detail, setDetail] = useState<SiteDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openVisit, setOpenVisit] = useState<string | null>(null);
  const [editCode, setEditCode] = useState(false);
  const [code, setCode] = useState(props.site.access_code ?? '');
  const [savingCode, setSavingCode] = useState(false);

  useEffect(() => {
    let alive = true;
    rpc<SiteDetail>('portal_site', { p_token: props.token, p_site: props.site.id })
      .then((d) => {
        if (!alive) return;
        setDetail(d);
        const wanted = props.initialDate && d.visits.some((v) => v.date === props.initialDate) ? props.initialDate : null;
        if (wanted) setOpenVisit(wanted);
        else if (d.visits[0]) setOpenVisit(d.visits[0].date);
      })
      .catch((e) => { if (alive) setError(errText(e)); });
    return () => { alive = false; };
  }, [props.token, props.site.id]);

  async function saveCode() {
    setSavingCode(true);
    try {
      await rpc('portal_set_access_code', { p_token: props.token, p_site: props.site.id, p_code: code });
      setEditCode(false);
      props.onCodeSaved();
    } catch (e) {
      setError(errText(e));
    } finally {
      setSavingCode(false);
    }
  }

  const siteCalls = props.calls.filter((c) => c.site_id === props.site.id);

  return (
    <div className="space-y-5">
      <button type="button" onClick={props.onBack} className="text-[15px] font-bold text-gold-600">→ חזרה לכל הבניינים</button>

      <Card>
        <h2 className="font-display text-[26px] font-bold leading-tight text-text">{props.site.label}</h2>
        {props.site.city && <p className="text-[15px] text-text-dim">{props.site.city}</p>}

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="inner-row rounded-xl px-4 py-3">
            <div className="text-[13px] font-semibold text-text-faint">ביקור אחרון</div>
            <div className="text-[17px] font-bold tabular text-text">{fmtDate(props.site.last_visit)}</div>
          </div>
          <div className="inner-row rounded-xl px-4 py-3">
            <div className="text-[13px] font-semibold text-text-faint">הביקור הבא</div>
            <div className="text-[17px] font-bold text-text">{props.site.next_window ?? '—'}</div>
          </div>
          <div className="inner-row rounded-xl px-4 py-3">
            <div className="text-[13px] font-semibold text-text-faint">מכשירים פעילים</div>
            <div className="text-[17px] font-bold tabular text-text">{props.site.devices}</div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <PrimaryBtn onClick={() => props.onRequest('fault')}>אין ריח / תקלה</PrimaryBtn>
          <GhostBtn onClick={() => props.onRequest('install')}>בקשת התקנה / החלפה</GhostBtn>
          <GhostBtn onClick={() => props.onRequest('removed')}>הורדנו מכשיר</GhostBtn>
        </div>
      </Card>

      <Card>
        <h3 className="mb-3 font-display text-[19px] font-bold text-text">קוד כניסה לבניין</h3>
        {editCode ? (
          <div className="flex flex-wrap gap-2">
            <input className={`${inputCls} max-w-xs`} value={code} onChange={(e) => setCode(e.target.value)} placeholder="למשל: 2580*" />
            <PrimaryBtn onClick={saveCode} disabled={savingCode}>{savingCode ? 'שומר...' : 'שמירה'}</PrimaryBtn>
            <GhostBtn onClick={() => { setEditCode(false); setCode(props.site.access_code ?? ''); }}>ביטול</GhostBtn>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-[17px] font-bold tabular text-text" dir="ltr">{props.site.access_code || 'לא הוזן קוד'}</span>
            <GhostBtn onClick={() => setEditCode(true)}>{props.site.access_code ? 'עדכון קוד' : 'הוספת קוד'}</GhostBtn>
          </div>
        )}
        <p className="mt-2 text-[14px] text-text-faint">הטכנאי שלנו רואה את הקוד לפני ההגעה, כך שאין צורך לשלוח אותו בקבוצה.</p>
      </Card>

      {siteCalls.length > 0 && (
        <Card>
          <h3 className="mb-3 font-display text-[19px] font-bold text-text">פניות בכתובת הזו</h3>
          <CallList calls={siteCalls} hideSite />
        </Card>
      )}

      <Card>
        <h3 className="mb-3 font-display text-[19px] font-bold text-text">היסטוריית ביקורים</h3>
        {error && <p className="text-[14px] font-bold text-crit">{error}</p>}
        {!detail && !error && <p className="text-[15px] text-text-faint">טוען...</p>}
        {detail && detail.visits.length === 0 && <p className="text-[15px] text-text-faint">עדיין אין ביקורים מתועדים בכתובת הזו.</p>}
        <div className="space-y-3">
          {detail?.visits.map((v) => (
            <div key={v.date} className="inner-row rounded-xl px-4 py-3">
              <button
                type="button"
                className="flex w-full flex-wrap items-center justify-between gap-2 text-start"
                onClick={() => setOpenVisit(openVisit === v.date ? null : v.date)}
              >
                <span className="text-[16px] font-bold tabular text-text">{fmtDate(v.date)}</span>
                <span className="text-[14px] text-text-dim">
                  <span className="tabular">{v.filled}</span> מתוך <span className="tabular">{v.devices}</span> מולאו · {v.technician ?? '—'}
                </span>
              </button>
              {openVisit === v.date && <VisitTable token={props.token} site={props.site} visit={v} customer={props.customer} />}
            </div>
          ))}
        </div>
      </Card>

      {detail && detail.devices.length > 0 && (
        <Card>
          <h3 className="mb-3 font-display text-[19px] font-bold text-text">מכשירים בכתובת</h3>
          <div className="divide-y divide-black/[0.075]">
            {detail.devices.map((d, i) => (
              <div key={i} className="flex flex-wrap justify-between gap-2 py-2.5 text-[15px]">
                <span className="font-bold text-text">{d.location || '—'}</span>
                <span className="text-text-dim">{d.model || '—'} · {d.scent || 'ללא ניחוח'}</span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

/* ---------- רשימת פניות ---------- */

function CallList({ calls, hideSite = false }: { calls: Call[]; hideSite?: boolean }) {
  if (calls.length === 0) return <p className="text-[15px] text-text-faint">אין פניות.</p>;
  return (
    <div className="space-y-3">
      {calls.map((c) => (
        <div key={c.code} className="inner-row rounded-xl px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[15px] font-bold text-text">{hideSite ? c.title.split(' — ')[0] : c.title}</span>
            <span className={`chip rounded-full border px-3 py-1 text-[13px] font-bold ${CALL_STATUS[c.status].cls}`}>{CALL_STATUS[c.status].label}</span>
          </div>
          <div className="mt-1 text-[13.5px] text-text-faint">
            <span className="font-mono" dir="ltr">{c.code}</span> · נפתחה {fmtDate(c.opened_at)}
            {c.closed_at ? ` · נסגרה ${fmtDate(c.closed_at)}` : ''}
          </div>
          {c.description && <p className="mt-1.5 whitespace-pre-line text-[14px] text-text-dim">{c.description}</p>}
          {c.resolution && (
            <p className="mt-2 rounded-lg bg-ok/[0.08] px-3 py-2 text-[14px] text-text">
              <b>מה בוצע:</b> {c.resolution}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

/* ---------- כניסה עם שם משתמש וסיסמה ---------- */

const TOKEN_KEY = 'iconair_portal_token';

function readStoredToken(): string {
  try { return localStorage.getItem(TOKEN_KEY) ?? ''; } catch { return ''; }
}

function LoginCard({ onLogin }: { onLogin: (token: string) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!username.trim() || !password) { setError('הזינו שם משתמש וסיסמה'); return; }
    setBusy(true);
    setError(null);
    try {
      const token = await rpc<string>('portal_login', { p_username: username, p_password: password });
      try { localStorage.setItem(TOKEN_KEY, token); } catch { /* דפדפן בלי אחסון — הכניסה תחזיק עד סגירת הדף */ }
      onLogin(token);
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-sm">
      <Card>
        <h2 className="mb-1 font-display text-[22px] font-bold text-text">כניסה לפורטל</h2>
        <p className="mb-5 text-[14px] text-text-dim">הזינו את שם המשתמש והסיסמה שקיבלתם מ-ICON AIR</p>
        <form onSubmit={submit} className="space-y-4">
          <Field label="שם משתמש">
            <input className={inputCls} dir="ltr" autoComplete="username" autoCapitalize="none" value={username} onChange={(e) => setUsername(e.target.value)} />
          </Field>
          <Field label="סיסמה">
            <input className={inputCls} dir="ltr" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          {error && <p className="text-[14px] font-bold text-crit">{error}</p>}
          <PrimaryBtn type="submit" disabled={busy}>{busy ? 'נכנס...' : 'כניסה'}</PrimaryBtn>
        </form>
      </Card>
    </div>
  );
}

/* ---------- האפליקציה ---------- */

export default function PortalApp() {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  // כניסה רגילה = שם משתמש וסיסמה (המפתח נשמר בדפדפן). ?portal=KEY נתמך עדיין לקישור ישיר.
  const [token, setToken] = useState<string>(() => params.get('portal') || readStoredToken());
  // קישור ממייל דוח הביקור: ?portal=…&site=…&date=YYYY-MM-DD פותח ישר את הבניין והביקור
  const linkDate = params.get('date');
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'sites' | 'calls'>('sites');
  const [siteId, setSiteId] = useState<string | null>(() => params.get('site'));
  const [query, setQuery] = useState('');
  const [sheet, setSheet] = useState<{ site: string | null; kind: Kind } | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await rpc<Overview>('portal_overview', { p_token: token });
      setData(d);
      setError(null);
    } catch (e) {
      const msg = errText(e);
      if (/אינו תקף/.test(msg)) {
        try { localStorage.removeItem(TOKEN_KEY); } catch { /* לא קריטי */ }
        setToken('');
        setData(null);
        setError(null);
        return;
      }
      setError(msg);
    }
  }, [token]);

  function logout() {
    try { localStorage.removeItem(TOKEN_KEY); } catch { /* לא קריטי */ }
    setToken('');
    setData(null);
    setSiteId(null);
  }

  useEffect(() => {
    document.title = 'ICON AIR · פורטל לקוח';
    document.documentElement.dir = 'rtl';
    document.documentElement.lang = 'he';
    if (!token) return;
    load();
  }, [token, load]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 6000);
    return () => window.clearTimeout(t);
  }, [toast]);

  const sites = useMemo(() => {
    const list = data?.sites ?? [];
    const q = query.trim();
    return q ? list.filter((s) => `${s.label} ${s.city ?? ''}`.includes(q)) : list;
  }, [data, query]);

  const site = data?.sites.find((s) => s.id === siteId) ?? null;
  const openCalls = data?.calls.filter((c) => c.status === 'open' || c.status === 'in_progress').length ?? 0;

  return (
    <div className="min-h-screen bg-white font-ui text-text" dir="rtl">
      <header className="border-b border-[#E2E8F0] bg-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-4">
          <div>
            <div className="text-[13px] font-extrabold tracking-[1.2px] text-gold-600">ICON AIR</div>
            <h1 className="font-display text-[22px] font-bold leading-tight text-text">
              פורטל לקוח{data ? ` · ${data.customer}` : ''}
            </h1>
          </div>
          {data && (
            <div className="flex items-center gap-3">
              <button type="button" onClick={logout} className="text-[14px] font-bold text-text-dim">יציאה</button>
              <PrimaryBtn onClick={() => setSheet({ site: siteId, kind: 'fault' })}>+ פנייה חדשה</PrimaryBtn>
            </div>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6">
        {error && (
          <Card>
            <p className="text-[16px] font-bold text-crit">{error}</p>
            <p className="mt-2 text-[15px] text-text-dim">לעזרה: 055-915-8248</p>
          </Card>
        )}

        {!token && <LoginCard onLogin={(t) => { setError(null); setToken(t); }} />}

        {token && !error && !data && <p className="text-[15px] text-text-faint">טוען...</p>}

        {data && site && (
          <SiteView
            token={token}
            site={site}
            customer={data.customer}
            calls={data.calls}
            onBack={() => setSiteId(null)}
            onRequest={(kind) => setSheet({ site: site.id, kind })}
            onCodeSaved={load}
            initialDate={linkDate}
          />
        )}

        {data && !site && (
          <>
            <div className="mb-5 flex gap-2">
              <button
                type="button"
                onClick={() => setTab('sites')}
                className={`min-h-[44px] rounded-xl px-4 text-[15px] font-bold ${tab === 'sites' ? 'bg-gold-500/[0.14] text-text' : 'text-text-dim'}`}
              >
                בניינים (<span className="tabular">{data.sites.length}</span>)
              </button>
              <button
                type="button"
                onClick={() => setTab('calls')}
                className={`min-h-[44px] rounded-xl px-4 text-[15px] font-bold ${tab === 'calls' ? 'bg-gold-500/[0.14] text-text' : 'text-text-dim'}`}
              >
                הפניות שלי{openCalls ? ` (${openCalls} פתוחות)` : ''}
              </button>
            </div>

            {tab === 'sites' && (
              <>
                <input className={`${inputCls} mb-5`} placeholder="חיפוש בניין או עיר..." value={query} onChange={(e) => setQuery(e.target.value)} />
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {sites.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => { setSiteId(s.id); window.scrollTo({ top: 0 }); }}
                      className="glass rounded-2xl p-5 text-start transition hover:border-gold-300/30 hover:bg-gold-500/[0.04]"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="text-[17px] font-bold text-text">{s.label}</div>
                          <div className="text-[14px] text-text-faint">{s.city ?? ''} · <span className="tabular">{s.devices}</span> מכשירים</div>
                        </div>
                        {s.open_calls > 0 && (
                          <span className="chip rounded-full border border-warn/30 bg-warn/[0.08] px-2.5 py-0.5 text-[12.5px] font-bold text-warn">
                            {s.open_calls} פתוחות
                          </span>
                        )}
                      </div>
                      <div className="mt-3 space-y-1 text-[14px] text-text-dim">
                        <div>ביקור אחרון: <b className="tabular text-text">{fmtDate(s.last_visit)}</b></div>
                        <div>הביקור הבא: <b className="text-text">{s.next_window ?? '—'}</b></div>
                      </div>
                    </button>
                  ))}
                </div>
                {sites.length === 0 && <p className="text-[15px] text-text-faint">לא נמצאו בניינים.</p>}
              </>
            )}

            {tab === 'calls' && (
              <Card>
                <CallList calls={data.calls} />
              </Card>
            )}
          </>
        )}

        <p className="mt-10 text-center text-[13px] text-text-faint">ICON AIR · שירות לקוחות 055-915-8248</p>
      </main>

      {sheet && data && (
        <RequestSheet
          token={token}
          sites={data.sites}
          initialSite={sheet.site}
          initialKind={sheet.kind}
          onClose={() => setSheet(null)}
          onDone={(code) => {
            setSheet(null);
            setToast(`הפנייה נקלטה (${code}). נעדכן כאן כשהיא תטופל.`);
            load();
          }}
        />
      )}

      {toast && (
        <div className="fixed inset-x-4 bottom-5 z-50 mx-auto max-w-md rounded-xl bg-ok px-4 py-3 text-center text-[15px] font-bold text-white shadow-lift">
          {toast}
        </div>
      )}
    </div>
  );
}
