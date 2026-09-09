import { OIL_EVENT_LABEL, formatDateTime } from '../lib/mappers';

/**
 * תבנית דוח השירות — מרונדרת אמיתית ב-DOM (לא canvas-מהיד) ואז נלכדת
 * ע"י html2canvas ב-src/lib/serviceReport.js. זו הדרך האמינה ביותר
 * להפיק PDF עברי/RTL תקין: הדפדפן כבר יודע לצייר עברית נכון עם הפונטים
 * הטעונים באתר (Assistant/Frank Ruhl Libre) — אין צורך בהטמעת פונט
 * ידנית או בטיפול ב-bidi בספריית PDF (jsPDF לא תומך בזה טוב).
 *
 * רוחב קבוע 794px = A4 ב-96dpi, כדי שהיחס יישמר נכון ב-PDF שנוצר.
 * כל טקסט דינמי מגיע כ-children של React (לא dangerouslySetInnerHTML) —
 * React מבצע escaping אוטומטי, כך שאין וקטור הזרקה דרך שם/כתובת/הערות
 * לקוח שמגיעים מהמסד.
 */
export default function ServiceReportTemplate({
  customerName, address, phone,
  deviceModel, deviceSerial, scentName,
  eventType, litersAdded, levelBeforePct, levelAfterPct, notes,
  technicianName, recordedAt, reportId,
}) {
  const ml = Math.round((Number(litersAdded) || 0) * 1000);
  const eventLabel = OIL_EVENT_LABEL[eventType] ?? eventType;

  return (
    <div
      dir="rtl"
      style={{
        width: 794,
        minHeight: 1000,
        background: '#FFFFFF',
        color: '#020617',
        fontFamily: "'Assistant', -apple-system, 'Segoe UI', sans-serif",
        boxSizing: 'border-box',
      }}
    >
      {/* כותרת עליונה — שבב נייבי כהה, זהה לזהות הניווט הכהה של האפליקציה */}
      <div
        style={{
          background: '#0F172A',
          padding: '28px 48px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div>
          <div style={{
            fontFamily: "'Frank Ruhl Libre', Georgia, serif",
            fontWeight: 700, fontSize: 30, color: '#FFFFFF', letterSpacing: 0.5,
          }}>
            ICON AIR
          </div>
          <div style={{ fontSize: 12.5, color: '#94A3B8', marginTop: 2, fontWeight: 500 }}>
            מערכת שטח וניהול — הפצת מכשירי ריח
          </div>
        </div>
        <div style={{ textAlign: 'left' }}>
          <div style={{
            fontSize: 13, fontWeight: 800, color: '#FCD34D',
            textTransform: 'uppercase', letterSpacing: 1,
          }}>
            דוח שירות
          </div>
          {reportId && (
            <div style={{ fontSize: 11, color: '#64748B', marginTop: 4, fontFamily: "'IBM Plex Mono', monospace" }}>
              #{String(reportId).slice(0, 8)}
            </div>
          )}
        </div>
      </div>

      <div style={{ padding: '32px 48px' }}>
        {/* תאריך ושעה מדויקים */}
        <div style={{ fontSize: 13, color: '#64748B', fontWeight: 600, marginBottom: 20 }}>
          הופק בתאריך {formatDateTime(recordedAt)}
        </div>

        {/* פרטי לקוח */}
        <div style={{
          border: '1px solid #CBD5E1', borderRadius: 14, padding: '20px 24px', marginBottom: 20,
        }}>
          <div style={{
            fontSize: 12, fontWeight: 700, color: '#B45309', textTransform: 'uppercase',
            letterSpacing: 0.8, marginBottom: 8,
          }}>
            לקוח
          </div>
          <div style={{ fontSize: 20, fontWeight: 800 }}>{customerName || '—'}</div>
          {address && <div style={{ fontSize: 14.5, color: '#334155', marginTop: 4 }}>{address}</div>}
          {phone && <div style={{ fontSize: 14.5, color: '#334155', marginTop: 2 }} dir="ltr">{phone}</div>}
        </div>

        {/* פירוט הפעולה */}
        <div style={{
          border: '1px solid #CBD5E1', borderRadius: 14, padding: '20px 24px', marginBottom: 20,
        }}>
          <div style={{
            fontSize: 12, fontWeight: 700, color: '#B45309', textTransform: 'uppercase',
            letterSpacing: 0.8, marginBottom: 14,
          }}>
            פירוט הפעולה שבוצעה
          </div>

          <ReportRow label="סוג פעולה" value={eventLabel} />
          <ReportRow label="סוג מכשיר" value={deviceModel || '—'} />
          {deviceSerial && <ReportRow label="מספר סידורי" value={deviceSerial} mono />}
          <ReportRow label="ניחוח" value={scentName || 'ללא ניחוח ספציפי'} />
          {ml > 0 && <ReportRow label="כמות שמולאה" value={`${ml} מ״ל`} bold />}
          {levelBeforePct != null && <ReportRow label="מפלס לפני" value={`${levelBeforePct}%`} />}
          <ReportRow label="מפלס אחרי" value={`${levelAfterPct}%`} bold />

          {/* מד ויזואלי פשוט למפלס אחרי */}
          <div style={{
            marginTop: 10, height: 10, borderRadius: 6, background: '#F1F5F9', overflow: 'hidden',
          }}>
            <div style={{
              height: '100%',
              width: `${Math.max(0, Math.min(100, levelAfterPct))}%`,
              background: 'linear-gradient(90deg,#D97706,#FCD34D)',
              borderRadius: 6,
            }} />
          </div>

          {notes && (
            <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid #E2E8F0' }}>
              <div style={{ fontSize: 12.5, color: '#64748B', fontWeight: 600, marginBottom: 4 }}>הערות הטכנאי</div>
              <div style={{ fontSize: 14.5, lineHeight: 1.6 }}>{notes}</div>
            </div>
          )}
        </div>

        {/* חתימה תחתונה */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          paddingTop: 18, borderTop: '2px solid #0F172A',
        }}>
          <div>
            <div style={{ fontSize: 12, color: '#64748B', fontWeight: 600 }}>בוצע על ידי</div>
            <div style={{ fontSize: 16, fontWeight: 800 }}>{technicianName || 'טכנאי ICON AIR'}</div>
          </div>
          <div style={{ fontSize: 11.5, color: '#94A3B8', textAlign: 'left' }}>
            מסמך זה הופק אוטומטית ע״י מערכת ICON AIR<br />בעת סיום הביקור בשטח
          </div>
        </div>
      </div>
    </div>
  );
}

function ReportRow({ label, value, bold, mono }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
      padding: '7px 0', fontSize: 14.5,
    }}>
      <span style={{ color: '#64748B', fontWeight: 600 }}>{label}</span>
      <span style={{
        fontWeight: bold ? 800 : 600,
        color: bold ? '#B45309' : '#020617',
        fontFamily: mono ? "'IBM Plex Mono', monospace" : undefined,
      }}>
        {value}
      </span>
    </div>
  );
}
