import { COMPANY, money } from '../lib/contractTemplate';
import { computeVat } from '../lib/mappers';

const FONT = "'Assistant', -apple-system, 'Segoe UI', sans-serif";

/**
 * תבנית הצעת המחיר — מרונדרת אמיתית ב-DOM (לא canvas-מהיד) ואז נלכדת
 * ע"י html2canvas ב-src/lib/quoteReport.js, בדיוק אותו דפוס כמו
 * ServiceReportTemplate/LoadPlanReportTemplate: עברית/RTL תקינה כי
 * הדפדפן עצמו מצייר את הטקסט, בלי הטמעת פונט/bidi ידניים ב-jsPDF.
 * סגנונות inline בלבד (לא מחלקות Tailwind) — אותה סיבה, עקביות רינדור.
 *
 * רוחב קבוע 794px = A4 ב-96dpi. items: [{ model, quantity, unitPrice }] —
 * הסכומים (subtotal/vat/total) תמיד לפני-מע"מ ועם מע"מ בנפרד, לפי
 * computeVat/VAT_RATE הקיימים (18%, "לא כולל מע"מ" — אותו מקור אמת
 * שכבר בשימוש בכרטיס הלקוח, לא נוסחה חדשה).
 */
export default function QuoteDocumentTemplate({ leadName, leadCity, leadPhone, items = [], quoteDate, quoteNumber }) {
  const rows = items.filter((row) => Number(row.quantity) > 0);
  const subtotal = rows.reduce((sum, row) => sum + Number(row.quantity) * Number(row.unitPrice), 0);
  const { vatAmount, total } = computeVat(subtotal, 'excluded');

  return (
    <div
      dir="rtl"
      style={{
        width: 794,
        minHeight: 1000,
        background: '#FFFFFF',
        color: '#020617',
        fontFamily: FONT,
        boxSizing: 'border-box',
      }}
    >
      {/* כותרת עליונה — שבב נייבי כהה עם הדגשת ענבר, זהה לזהות הניווט
          הכהה של האפליקציה ולשאר המסמכים הממותגים (דוח שירות/העמסה) */}
      <div style={{
        background: '#0F172A', padding: '28px 48px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div>
          <div style={{
            fontFamily: "'Frank Ruhl Libre', Georgia, serif",
            fontWeight: 700, fontSize: 30, color: '#FFFFFF', letterSpacing: 0.5,
          }}>
            ICON AIR
          </div>
          <div style={{ fontSize: 12.5, color: '#94A3B8', marginTop: 2, fontWeight: 500 }}>
            פתרונות ריח מתקדמים לעסקים
          </div>
        </div>
        <div style={{ textAlign: 'left' }}>
          <div style={{
            fontSize: 13, fontWeight: 800, color: '#FCD34D',
            textTransform: 'uppercase', letterSpacing: 1,
          }}>
            הצעת מחיר
          </div>
          {quoteNumber && (
            <div style={{ fontSize: 11, color: '#64748B', marginTop: 4, fontFamily: "'IBM Plex Mono', monospace" }}>
              #{String(quoteNumber).slice(0, 8)}
            </div>
          )}
          {quoteDate && <div style={{ fontSize: 12, color: '#CBD5E1', marginTop: 4 }}>{quoteDate}</div>}
        </div>
      </div>

      <div style={{ padding: '32px 48px' }}>
        {/* פרטי לקוח מול פרטי החברה — אותו מבנה כמו ContractDocument */}
        <div style={{ display: 'flex', gap: 18, marginBottom: 22 }}>
          <div style={{ flex: 1, border: '1px solid #CBD5E1', borderRadius: 14, padding: '18px 22px' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#B45309', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8 }}>
              עבור
            </div>
            <div style={{ fontSize: 18, fontWeight: 800 }}>{leadName || '—'}</div>
            {leadCity && <div style={{ fontSize: 14, color: '#334155', marginTop: 4 }}>{leadCity}</div>}
            {leadPhone && <div style={{ fontSize: 14, color: '#334155', marginTop: 2 }} dir="ltr">{leadPhone}</div>}
          </div>
          <div style={{ flex: 1, border: '1px solid #CBD5E1', borderRadius: 14, padding: '18px 22px' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#B45309', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8 }}>
              מאת
            </div>
            <div style={{ fontSize: 14.5, fontWeight: 700 }}>{COMPANY.name}</div>
            <div style={{ fontSize: 13, color: '#334155', marginTop: 4 }}>ח.פ. {COMPANY.regNumber}</div>
            <div style={{ fontSize: 13, color: '#334155', marginTop: 2 }}>{COMPANY.address}</div>
            <div style={{ fontSize: 13, color: '#334155', marginTop: 2 }}>{COMPANY.email} · {COMPANY.phone}</div>
          </div>
        </div>

        {/* טבלת שורות — דגם / כמות / מחיר ליחידה / סה"כ לשורה */}
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #0F172A' }}>
              <th style={cellHead}>דגם</th>
              <th style={{ ...cellHead, textAlign: 'center' }}>כמות</th>
              <th style={{ ...cellHead, textAlign: 'end' }}>מחיר ליחידה</th>
              <th style={{ ...cellHead, textAlign: 'end' }}>סה״כ</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={4} style={{ ...cell, color: '#94A3B8', padding: '14px 6px' }}>לא הוזנו פריטים</td></tr>
            )}
            {rows.map((row, i) => (
              <tr key={i} style={{ borderBottom: '1px solid #E2E8F0' }}>
                <td style={{ ...cell, fontWeight: 700 }}>{row.model}</td>
                <td style={{ ...cell, textAlign: 'center' }} className="tabular">{row.quantity}</td>
                <td style={{ ...cell, textAlign: 'end' }} className="tabular">{money(row.unitPrice)}</td>
                <td style={{ ...cell, textAlign: 'end', fontWeight: 700 }} className="tabular">
                  {money(row.quantity * row.unitPrice)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* סיכום — לפני מע"מ / מע"מ / סה"כ כולל, אותו computeVat כמו בכל המערכת */}
        <div style={{ marginTop: 18, display: 'flex', justifyContent: 'flex-end' }}>
          <div style={{ minWidth: 260 }}>
            <SummaryLine label="סה״כ לפני מע״מ" value={money(subtotal)} />
            <SummaryLine label="מע״מ (18%)" value={money(vatAmount)} />
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
              marginTop: 8, paddingTop: 10, borderTop: '2px solid #0F172A',
            }}>
              <span style={{ fontSize: 14, fontWeight: 700 }}>סה״כ כולל מע״מ</span>
              <span className="tabular" style={{ fontSize: 22, fontWeight: 800, color: '#B45309' }}>{money(total)}</span>
            </div>
          </div>
        </div>

        <div style={{ marginTop: 28, padding: '14px 18px', borderRadius: 10, background: '#F1F5F9', fontSize: 12.5, color: '#475569' }}>
          ההצעה תקפה ל-14 יום ממועד ההפקה. המחירים המפורטים לעיל הם לפני מע״מ כדין, ואינם כוללים התקנה אלא אם צוין אחרת.
        </div>

        <div style={{
          marginTop: 26, display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          paddingTop: 16, borderTop: '2px solid #0F172A',
        }}>
          <div style={{ fontSize: 11.5, color: '#94A3B8' }}>
            מסמך זה הופק אוטומטית על ידי מערכת ICON AIR
          </div>
          <div style={{ fontSize: 11.5, color: '#94A3B8', textAlign: 'left' }}>
            {COMPANY.email} · {COMPANY.phone}
          </div>
        </div>
      </div>
    </div>
  );
}

function SummaryLine({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 13.5 }}>
      <span style={{ color: '#64748B', fontWeight: 600 }}>{label}</span>
      <span className="tabular" style={{ fontWeight: 700 }}>{value}</span>
    </div>
  );
}

const cellHead = {
  textAlign: 'start', padding: '9px 6px', fontWeight: 700, fontSize: 12,
  color: '#64748B', textTransform: 'uppercase', letterSpacing: 0.5,
};
const cell = { textAlign: 'start', padding: '10px 6px' };
