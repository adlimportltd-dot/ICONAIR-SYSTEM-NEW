import { useEffect, useRef, useState } from 'react';
import ContractDocument from '../components/ContractDocument';
import SignaturePad from '../components/SignaturePad';
import { Field, TextInput, PrimaryButton } from '../components/ui/Field';
import { getContractForSigning, submitContractSignature, contractPublicUrl } from '../lib/queries';
import { describeError, isSupabaseConfigured } from '../lib/supabase';

/**
 * עמוד חתימה ציבורי — נטען לפי ?sign=<token> ב-App.jsx, לפני שער
 * ההתחברות לגמרי (הלקוח לא מחובר ולא יהיה לו חשבון). כל הגישה
 * לנתונים כאן עוברת דרך שני RPC-ים ציבוריים (get_contract_for_signing,
 * submit_contract_signature) שכבר קיימים ב-Supabase ובודקים בעצמם
 * תוקף/תפוגה של ה-token — לא מסתמכים על שום דבר בצד הלקוח.
 *
 * את קובץ החוזה המדויק (עם טבלת המערכות/המחירים הספציפית שהמנהל
 * הזין) מציגים ב-iframe — bucket "contracts" הוגדר public בכוונה:
 * שם הקובץ הוא ה-sign_token עצמו (UUID אקראי), אז זו בפועל "קישור
 * סודי" כמו שיתוף ב-Drive/Dropbox, לא חשיפה פתוחה.
 *
 * ⚠ לא משתמשים ב-<iframe src=publicUrl> ישירות: Supabase Storage
 * מגיש קבצי .html שהועלו כ-text/plain בכוונה (הגנת אנטי-XSS מובנית —
 * וידאתי בפועל, גם דרך ה-SDK עם contentType מפורש), אז src ישיר
 * היה מציג את קוד המקור הגולמי במקום לרנדר אותו. הפתרון: מביאים את
 * הטקסט עם fetch (עדיין דורש שה-bucket יהיה public, כי fetch עדיין
 * עובר דרך RLS של Storage) ומזריקים אותו ל-iframe דרך srcDoc, עם
 * sandbox="allow-scripts" (בלי allow-same-origin) — כך ה-ResizeObserver
 * שבתוך המסמך (contractTemplate.js) עדיין עובד, אבל למסמך אין גישה
 * לעוגיות/ל-localStorage של האפליקציה שלנו.
 */
export default function SignContractScreen({ token }) {
  const [state, setState] = useState({ loading: true, data: null, error: null });
  const [contractHtml, setContractHtml] = useState(null);
  const [signerName, setSignerName] = useState('');
  const [signerIdNumber, setSignerIdNumber] = useState('');
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [done, setDone] = useState(false);
  const [iframeHeight, setIframeHeight] = useState(600);
  const padRef = useRef(null);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    getContractForSigning(token)
      .then((data) => setState({ loading: false, data, error: null }))
      .catch((error) => setState({ loading: false, data: null, error: describeError(error) }));
  }, [token]);

  useEffect(() => {
    if (!state.data?.file_path) return;
    fetch(contractPublicUrl(state.data.file_path))
      .then((res) => (res.ok ? res.text() : Promise.reject(new Error('טעינת החוזה נכשלה'))))
      .then(setContractHtml)
      .catch(() => setContractHtml(null));
  }, [state.data?.file_path]);

  useEffect(() => {
    function onMessage(event) {
      const height = event.data?.iconairContractHeight;
      if (typeof height === 'number') setIframeHeight(height);
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  async function submit(event) {
    event.preventDefault();
    setSubmitError(null);

    if (!signerName.trim() || !signerIdNumber.trim()) {
      setSubmitError('נא למלא שם מלא ות.ז./ח.פ.');
      return;
    }
    if (padRef.current?.isEmpty()) {
      setSubmitError('נא לחתום בתיבת החתימה למטה');
      return;
    }
    if (!agree) {
      setSubmitError('יש לאשר את הסכמתך לתנאי החוזה');
      return;
    }

    setBusy(true);
    try {
      await submitContractSignature({
        token,
        signerName: signerName.trim(),
        signerIdNumber: signerIdNumber.trim(),
        signatureData: padRef.current.getDataUrl(),
      });
      setDone(true);
    } catch (caught) {
      setSubmitError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#f4f2ee] px-4 py-8 sm:px-6" dir="rtl" style={{ colorScheme: 'light' }}>
      <div className="mx-auto max-w-[820px]">
        {state.loading && <StatusCard title="טוען את החוזה…" />}

        {!state.loading && state.error && <StatusCard title="שגיאה" tone="crit" text={state.error} />}

        {!state.loading && !state.error && state.data && !state.data.found && (
          <StatusCard title="הקישור לא תקף" text="הקישור פג תוקף או שגוי. פנה לחברה לקבלת קישור חדש." tone="crit" />
        )}

        {!state.loading && state.data?.found && state.data.status === 'signed' && (
          <StatusCard
            title="החוזה כבר נחתם"
            tone="ok"
            text={state.data.signed_at ? `נחתם בתאריך ${new Date(state.data.signed_at).toLocaleDateString('he-IL')}` : undefined}
          />
        )}

        {!state.loading && state.data?.found && state.data.status === 'declined' && (
          <StatusCard title="החוזה נדחה" text="אם מדובר בטעות, פנה לחברה." />
        )}

        {!state.loading && state.data?.found && !['signed', 'declined'].includes(state.data.status) && !done && (
          <>
            <div className="mb-4 overflow-hidden rounded-xl shadow-[0_1px_4px_rgba(0,0,0,.08)]">
              {contractHtml ? (
                <iframe
                  title="חוזה"
                  srcDoc={contractHtml}
                  sandbox="allow-scripts"
                  style={{ height: iframeHeight }}
                  className="w-full border-0"
                />
              ) : (
                <ContractDocument customer={{ name: state.data.customer_name }} items={[]} contractDate="" />
              )}
            </div>

            <form onSubmit={submit} className="rounded-xl bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,.08)] sm:p-7">
              <h3 className="mb-4 text-[16px] font-bold">חתימה על החוזה</h3>

              <div className="mb-3.5 grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                <Field label="שם מלא" required>
                  <LightInput value={signerName} onChange={(e) => setSignerName(e.target.value)} required />
                </Field>
                <Field label="ת.ז. / ח.פ." required>
                  <LightInput value={signerIdNumber} onChange={(e) => setSignerIdNumber(e.target.value)} required />
                </Field>
              </div>

              <div className="mb-1.5 text-[12.5px] font-medium text-[#555]">חתימה</div>
              <SignaturePad ref={padRef} />
              <button
                type="button"
                onClick={() => padRef.current?.clear()}
                className="mt-1.5 text-[12px] text-[#888] underline"
              >
                ניקוי וחתימה מחדש
              </button>

              <label className="mt-4 flex items-start gap-2 text-[12.5px] text-[#333]">
                <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-0.5" />
                קראתי את תנאי ההסכם ואני מאשר/ת ומסכים/ה להם.
              </label>

              {submitError && (
                <div className="mt-3.5 rounded-lg border border-[#e5b3b3] bg-[#fdf0f0] px-3.5 py-2.5 text-[12.5px] text-[#a33]">
                  {submitError}
                </div>
              )}

              <div className="mt-5">
                <PrimaryButton type="submit" loading={busy}>אישור וחתימה</PrimaryButton>
              </div>
            </form>
          </>
        )}

        {done && <StatusCard title="תודה, החוזה נחתם בהצלחה" tone="ok" text="עותק חתום ישמר במערכת החברה." />}
      </div>
    </div>
  );
}

function LightInput(props) {
  return (
    <input
      {...props}
      className="w-full rounded-lg border border-[#ccc] bg-white px-3.5 py-2.5 text-[14px] text-[#1a1a1a]
                 focus:border-[#D8B36A] focus:outline-none"
    />
  );
}

const TONE_STYLE = {
  crit: { border: '#e5b3b3', bg: '#fdf0f0', text: '#a33' },
  ok: { border: '#b6e0c8', bg: '#f0fbf4', text: '#1a7a44' },
  neutral: { border: '#ddd', bg: '#fff', text: '#333' },
};

function StatusCard({ title, text, tone = 'neutral' }) {
  const style = TONE_STYLE[tone];
  return (
    <div
      className="rounded-xl p-6 text-center shadow-[0_1px_4px_rgba(0,0,0,.08)]"
      style={{ background: style.bg, border: `1px solid ${style.border}`, color: style.text }}
    >
      <div className="text-[16px] font-bold">{title}</div>
      {text && <div className="mt-1.5 text-[13px]">{text}</div>}
    </div>
  );
}
