import { useEffect, useMemo, useState } from 'react';
import Modal from './ui/Modal';
import { Field, Select, TextInput, PrimaryButton, SecondaryButton } from './ui/Field';
import { sendWorkTime } from '../lib/smartFleetQueries';

/**
 * שליטה קבוצתית (phase71) — שעון ועוצמה / כיבוי לכל המכשירים של לקוח בבת אחת.
 *
 * עריכה → מסך סיכום ואישור → שליחה מכשיר אחרי מכשיר (אותו /api/aroma-command
 * של עריכת מכשיר בודד — כל ההרשאות והיומן נשמרים כרגיל, כולל השעון הקודם של
 * כל מכשיר, כך שתמיד אפשר לחזור). רק מכשירים מחוברים, עם שליטה פעילה ולא נעולים.
 * "כיבוי" = כל 5 התוכניות כבויות בכל ימי השבוע. "הדלקה" = שליחת שעון חדש.
 */

const DAY_SHORT = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const LEVELS = [
  { value: '1', label: 'A (חלש)' },
  { value: '2', label: 'B (בינוני)' },
  { value: '3', label: 'C (חזק)' },
];
const LEVEL_LETTER = { 1: 'A', 2: 'B', 3: 'C' };
const EMPTY_PROGRAM = { enabled: false, start: '08:00', end: '20:00', work_sec: 10, pause_sec: 120, level: 1 };

function normPrograms(programs) {
  const list = (programs ?? []).slice(0, 5).map((p) => ({
    enabled: !!p.enabled,
    start: p.start || '00:00',
    end: p.end || '00:00',
    work_sec: Number(p.work_sec) || 10,
    pause_sec: Number(p.pause_sec) || 120,
    level: Number(p.level) || 1,
  }));
  while (list.length < 5) list.push({ ...EMPTY_PROGRAM });
  return list;
}

const describe = (p) => `${p.start}–${p.end} · ריסוס ${p.work_sec}ש׳ · הפסקה ${p.pause_sec}ש׳ · עוצמה ${LEVEL_LETTER[p.level] ?? p.level}`;

function whereOf(row) {
  const d = row.device;
  const parts = [d?.site?.label, d?.location_note].filter(Boolean);
  return parts.length ? parts.join(' · ') : (d?.serial || row.aroma_name || 'מכשיר');
}

function blockReason(row) {
  if (!row.control_enabled) return 'שליטה מרחוק לא פעילה';
  if (row.is_locked) return 'נעול בענן';
  if (!row.online) return 'מנותק';
  return '';
}

const todayIdx = () => new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' })).getDay();

export default function GroupControlModal({ group, onClose, onDone }) {
  const rows = useMemo(() => (group?.items ?? []).map((it) => it.row ?? it), [group]);
  const eligible = rows.filter((r) => !blockReason(r));

  const [mode, setMode] = useState('schedule'); // schedule | off
  const [selected, setSelected] = useState([]);
  const [programs, setPrograms] = useState(normPrograms([]));
  const [weeks, setWeeks] = useState(ALL_DAYS);
  const [step, setStep] = useState('edit'); // edit → confirm → sending → done
  const [error, setError] = useState('');
  const [status, setStatus] = useState({}); // id → sending | ok | unverified | fail
  const [failMsg, setFailMsg] = useState({});

  const groupKey = group?.key;
  useEffect(() => {
    if (!group) return;
    setMode('schedule');
    setSelected(eligible.map((r) => r.id));
    // תבנית התחלה: השעון של היום מהמכשיר הראשון שאפשר לשלוט בו
    const first = eligible[0];
    const day = todayIdx();
    const sched = Array.isArray(first?.schedule) ? first.schedule.find((d) => d.week === day)?.programs : null;
    setPrograms(normPrograms(sched ?? []));
    setWeeks(ALL_DAYS);
    setStep('edit');
    setError('');
    setStatus({});
    setFailMsg({});
  }, [groupKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const setProgram = (i, patch) => setPrograms((prev) => prev.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  const toggleWeek = (d) => setWeeks((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort()));
  const toggleDevice = (id) => setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const sendPrograms = mode === 'off' ? normPrograms([]).map((p) => ({ ...p, enabled: false })) : programs;
  const sendWeeks = mode === 'off' ? ALL_DAYS : weeks;
  const chosen = rows.filter((r) => selected.includes(r.id));

  function check() {
    if (!chosen.length) return 'צריך לבחור לפחות מכשיר אחד';
    if (mode === 'off') return '';
    if (!weeks.length) return 'צריך לבחור לפחות יום אחד';
    if (!programs.some((p) => p.enabled)) return 'כל התוכניות כבויות — לכיבוי מלא בחר "כיבוי"';
    for (let i = 0; i < 5; i++) {
      const p = programs[i];
      if (!p.enabled) continue;
      if (!(p.end > p.start)) return `תוכנית ${i + 1}: שעת הסיום חייבת להיות אחרי שעת ההתחלה`;
      if (p.work_sec < 5 || p.work_sec > 900) return `תוכנית ${i + 1}: זמן ריסוס בין 5 ל-900 שניות`;
      if (p.pause_sec < 5 || p.pause_sec > 900) return `תוכנית ${i + 1}: זמן הפסקה בין 5 ל-900 שניות`;
    }
    return '';
  }

  function toConfirm() {
    const msg = check();
    setError(msg);
    if (!msg) setStep('confirm');
  }

  async function sendAll() {
    setStep('sending');
    setError('');
    const st = {};
    chosen.forEach((r) => { st[r.id] = 'wait'; });
    setStatus({ ...st });
    for (const r of chosen) {
      setStatus((prev) => ({ ...prev, [r.id]: 'sending' }));
      try {
        const res = await sendWorkTime(r.id, sendWeeks, sendPrograms);
        setStatus((prev) => ({ ...prev, [r.id]: res?.verified ? 'ok' : 'unverified' }));
      } catch (e) {
        setStatus((prev) => ({ ...prev, [r.id]: 'fail' }));
        setFailMsg((prev) => ({ ...prev, [r.id]: e.message || 'השליחה נכשלה' }));
      }
    }
    setStep('done');
    onDone?.();
  }

  const counts = Object.values(status).reduce((a, s) => ({ ...a, [s]: (a[s] || 0) + 1 }), {});

  const footer =
    step === 'edit' ? (
      <>
        <SecondaryButton onClick={onClose}>ביטול</SecondaryButton>
        <PrimaryButton onClick={toConfirm} disabled={!eligible.length}>המשך לאישור</PrimaryButton>
      </>
    ) : step === 'confirm' ? (
      <>
        <SecondaryButton onClick={() => setStep('edit')}>חזרה לעריכה</SecondaryButton>
        <PrimaryButton onClick={sendAll}>{mode === 'off' ? `כבה ${chosen.length} מכשירים` : `שלח ל-${chosen.length} מכשירים`}</PrimaryButton>
      </>
    ) : step === 'sending' ? (
      <PrimaryButton loading disabled>שולח…</PrimaryButton>
    ) : (
      <PrimaryButton onClick={onClose}>סגירה</PrimaryButton>
    );

  const STATUS_VIEW = {
    wait: { text: 'ממתין', cls: 'text-text-faint' },
    sending: { text: 'שולח…', cls: 'text-gold-600' },
    ok: { text: '✓ נקלט במכשיר', cls: 'text-ok' },
    unverified: { text: 'נשלח, עוד לא אושר', cls: 'text-warn' },
    fail: { text: '✗ נכשל', cls: 'text-crit-soft' },
  };

  return (
    <Modal
      open={!!group}
      title="שליטה קבוצתית"
      wide
      subtitle={group ? `${group.name} · ${rows.length} מכשירים` : ''}
      onClose={step === 'sending' ? () => {} : onClose}
      footer={footer}
    >
      {step === 'edit' && (
        <div className="flex flex-col gap-4">
          {/* מה עושים */}
          <div className="inline-flex self-start rounded-xl border border-slate-500/20 bg-slate-500/[0.06] p-1">
            {[['schedule', 'שעון ועוצמה'], ['off', 'כיבוי']].map(([v, label]) => (
              <button
                key={v}
                type="button"
                onClick={() => setMode(v)}
                aria-pressed={mode === v}
                className={`rounded-lg px-5 py-2 text-[14px] font-bold transition-colors ${
                  mode === v ? (v === 'off' ? 'bg-crit/[0.12] text-crit-soft' : 'bg-gold-500/[0.18] text-gold-600') : 'text-text-faint hover:text-text'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* המכשירים */}
          <Field label="מכשירים" hint="רק מכשירים מחוברים, עם שליטה מרחוק פעילה ולא נעולים">
            <div className="flex flex-col gap-1.5">
              {rows.map((r) => {
                const why = blockReason(r);
                return (
                  <label key={r.id} className={`inner-row flex items-center gap-2.5 px-3 py-2 text-[14.5px] ${why ? 'opacity-55' : 'cursor-pointer'}`}>
                    <input type="checkbox" disabled={!!why} checked={!why && selected.includes(r.id)} onChange={() => toggleDevice(r.id)} />
                    <span className="min-w-0 flex-1 truncate font-semibold">{whereOf(r)}</span>
                    {why && <span className="flex-none text-[12.5px] text-text-faint">{why}</span>}
                  </label>
                );
              })}
            </div>
          </Field>
          {!eligible.length && (
            <p className="text-[14px] font-semibold text-warn">אין כרגע אף מכשיר של הלקוח הזה שאפשר לשלוט בו מרחוק.</p>
          )}

          {mode === 'schedule' && eligible.length > 0 && (
            <>
              <p className="text-[13px] text-text-faint">
                השעון שמוצג למטה נטען מהמכשיר הראשון ברשימה (היום). מה שתגדיר כאן יישלח לכל המכשירים שסימנת.
              </p>
              {programs.map((p, i) => (
                <div key={i} className="inner-row flex flex-col gap-2.5 px-3 py-3">
                  <label className="flex items-center gap-2 text-[15px] font-bold">
                    <input type="checkbox" checked={p.enabled} onChange={(e) => setProgram(i, { enabled: e.target.checked })} />
                    תוכנית {i + 1}
                    {!p.enabled && <span className="text-[13px] font-medium text-text-faint">(כבויה)</span>}
                  </label>
                  {p.enabled && (
                    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-5">
                      <Field label="התחלה">
                        <TextInput type="time" value={p.start} onChange={(e) => setProgram(i, { start: e.target.value })} dir="ltr" />
                      </Field>
                      <Field label="סיום">
                        <TextInput type="time" value={p.end} onChange={(e) => setProgram(i, { end: e.target.value })} dir="ltr" />
                      </Field>
                      <Field label="ריסוס (שנ׳)">
                        <TextInput type="number" min={5} max={900} value={p.work_sec} onChange={(e) => setProgram(i, { work_sec: Number(e.target.value) })} dir="ltr" />
                      </Field>
                      <Field label="הפסקה (שנ׳)">
                        <TextInput type="number" min={5} max={900} value={p.pause_sec} onChange={(e) => setProgram(i, { pause_sec: Number(e.target.value) })} dir="ltr" />
                      </Field>
                      <Field label="עוצמה">
                        <Select value={String(p.level)} onChange={(e) => setProgram(i, { level: Number(e.target.value) })} options={LEVELS} />
                      </Field>
                    </div>
                  )}
                </div>
              ))}
              <Field label="להחיל על הימים">
                <div className="flex flex-wrap gap-3">
                  {DAY_SHORT.map((d, i) => (
                    <label key={d} className="flex items-center gap-1.5 text-[15px] font-semibold">
                      <input type="checkbox" checked={weeks.includes(i)} onChange={() => toggleWeek(i)} />
                      {d}
                    </label>
                  ))}
                </div>
              </Field>
            </>
          )}

          {mode === 'off' && eligible.length > 0 && (
            <p className="rounded-xl border border-crit/20 bg-crit/[0.06] px-3 py-2.5 text-[14px]">
              כל התוכניות יכובו בכל ימי השבוע — המכשירים יפסיקו לרסס. השעון הקודם של כל מכשיר נשמר ביומן,
              ואפשר להדליק שוב בכל רגע עם "שעון ועוצמה".
            </p>
          )}
          {error && <p className="text-[14px] font-semibold text-crit-soft">{error}</p>}
        </div>
      )}

      {step === 'confirm' && (
        <div className="flex flex-col gap-3 text-[15px]">
          <p className="font-bold">
            {mode === 'off'
              ? `לכבות ${chosen.length} מכשירים של ${group.name}?`
              : `לשלוח את השעון הזה ל-${chosen.length} מכשירים של ${group.name}, לימים: ${sendWeeks.map((w) => DAY_SHORT[w]).join(', ')}?`}
          </p>
          <div className="inner-row flex flex-col gap-1 px-3 py-2.5 text-[14px]">
            {chosen.map((r) => <span key={r.id}>• {whereOf(r)}</span>)}
          </div>
          {mode === 'schedule' && sendPrograms.map((p, i) => (
            <div key={i} className="text-[14px]">
              <span className="font-semibold">תוכנית {i + 1}:</span> {p.enabled ? describe(p) : 'כבויה'}
            </div>
          ))}
          <p className="text-[13.5px] text-text-faint">השליחה עוברת מכשיר אחרי מכשיר (כ-10 שניות לכל אחד). השעון הקודם של כל מכשיר נשמר ביומן.</p>
        </div>
      )}

      {(step === 'sending' || step === 'done') && (
        <div className="flex flex-col gap-2 text-[15px]">
          {step === 'done' && (
            <p className={`font-bold ${counts.fail ? 'text-warn' : 'text-ok'}`}>
              {counts.ok || 0} נקלטו
              {counts.unverified ? ` · ${counts.unverified} עוד לא אישרו (בדוק שוב בעוד דקה)` : ''}
              {counts.fail ? ` · ${counts.fail} נכשלו` : ''}
            </p>
          )}
          {chosen.map((r) => {
            const s = STATUS_VIEW[status[r.id]] ?? STATUS_VIEW.wait;
            return (
              <div key={r.id} className="inner-row flex flex-col gap-0.5 px-3 py-2">
                <div className="flex items-center justify-between gap-3">
                  <span className="min-w-0 truncate font-semibold">{whereOf(r)}</span>
                  <span className={`flex-none text-[13.5px] font-bold ${s.cls}`}>{s.text}</span>
                </div>
                {failMsg[r.id] && <span className="text-[12.5px] text-crit-soft">{failMsg[r.id]}</span>}
              </div>
            );
          })}
          {step === 'sending' && <p className="text-[13px] text-text-faint">לא לסגור את החלון עד שהשליחה מסתיימת.</p>}
        </div>
      )}
    </Modal>
  );
}
