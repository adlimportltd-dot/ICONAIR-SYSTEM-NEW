/**
 * תוכן הסכם ההתקשרות הסטנדרטי — מקור אמת יחיד, בשימוש גם בתצוגה
 * המקדימה למנהל (ContractDocument.jsx, בתוך האפליקציה) וגם בקובץ
 * ה-HTML העצמאי שנשמר ב-Storage ונפתח דרך קישור החתימה הציבורי.
 *
 * הניסוח כאן הוא עדכון/ליטוש של טופס ה-PDF הפיזי שהיה בשימוש עד כה —
 * לא ייעוץ משפטי. מומלץ שעו"ד יעבור על הנוסח לפני שהוא יוצא כ"סטנדרט"
 * קבוע לחתימה, בפרט סעיפי הביטול המוקדם והאחריות.
 */

export const COMPANY = {
  name: 'אייקון אייר בע״מ',
  regNumber: '516923471',
  address: 'דרך חיפה 10, קריית אתא',
  email: 'iconairisrael@gmail.com',
  phone: '053-2133335',
};

export const CONTRACT_SECTIONS = [
  {
    num: 1,
    title: 'מהות ההתקשרות',
    clauses: [
      `${COMPANY.name} ("החברה") תספק ללקוח שירותי בישום ריח לעסקים, לרבות אספקת מערכות ריח, ` +
      'חומרי בישום, התקנה, תחזוקה שוטפת ומתן שירות תיקון תקלות, בהתאם לתנאי הסכם זה ולפרטי המערכות והתמחור המפורטים בנספח א׳.',
    ],
  },
  {
    num: 2,
    title: 'תקופת ההתקשרות',
    clauses: [
      'ההתקשרות הינה לתקופה מינימלית של 12 (שנים עשר) חודשים ממועד התקנת המערכת אצל הלקוח ("תקופת ההתחייבות״).',
      'תקופת ההתחייבות חלה בנפרד על כל מערכת ומכשיר המותקנים אצל הלקוח, בהתאם למועד ההתקנה הספציפי של כל אחד מהם, כמפורט בנספח א׳.',
      'בתום תקופת ההתחייבות של כל מערכת, ההתקשרות לגביה תתחדש אוטומטית מחודש לחודש, אלא אם נמסרה הודעת סיום כמפורט בסעיף 3 להלן.',
    ],
  },
  {
    num: 3,
    title: 'סיום ההתקשרות לאחר תקופת ההתחייבות',
    clauses: [
      'הלקוח רשאי לסיים את ההתקשרות לגבי מערכת מסוימת לאחר תום תקופת ההתחייבות החלה עליה, בהודעה מוקדמת בכתב של 30 (שלושים) יום.',
      `הודעת הסיום תימסר בכתב בלבד, באמצעות דואר אלקטרוני לכתובת ${COMPANY.email} או בכתב לכתובת החברה כמפורט במבוא להסכם זה.`,
    ],
  },
  {
    num: 4,
    title: 'ביטול מוקדם',
    clauses: [
      'במקרה שהלקוח יבקש לסיים את ההתקשרות לגבי מערכת כלשהי לפני תום תקופת ההתחייבות החלה עליה, יחויב הלקוח בתשלום מלוא יתרת דמי ' +
      'ההתקשרות (התשלומים החודשיים) שנותרו עד תום אותה תקופת התחייבות, בגין המערכת הרלוונטית בלבד.',
      'החברה רשאית, בנוסף לכל סעד אחר העומד לה על פי דין, לבטל הסכם זה באופן מיידי במקרה של אי-תשלום החוב במלואו על ידי הלקוח, ' +
      'לאחר שנמסרה ללקוח התראה בכתב ולא הוסדר החוב בתוך 14 יום ממועד מסירתה.',
    ],
  },
  {
    num: 5,
    title: 'תמורה ותנאי תשלום',
    clauses: [
      'התמורה החודשית עבור השירותים תשולם בהתאם למחירים המפורטים בנספח א׳ להסכם זה, בתוספת מע״מ כדין.',
      'התשלום יבוצע מדי חודש בחודשו, באמצעות הוראת קבע, כרטיס אשראי או המחאות, לפי בחירת הלקוח ובכפוף לאישור החברה.',
      'אי-תשלום במועד ייחשב הפרה יסודית של הסכם זה, ויקנה לחברה את הזכות להשעות את אספקת השירות עד להסדרת מלוא התשלום שבפיגור, ' +
      'מבלי שהדבר יגרע מיתר זכויות החברה על פי הסכם זה או על פי כל דין.',
    ],
  },
  {
    num: 6,
    title: 'ציוד ובעלות',
    clauses: [
      'כל המערכות, המכשירים והאביזרים המסופקים ללקוח הינם ויישארו רכוש החברה בלעדי, ולא יעברו לבעלות הלקוח בכל שלב, ' +
      'אלא אם נקבע אחרת בהסכם נפרד ובכתב.',
      'הלקוח מתחייב שלא להעביר, למכור, להשכיר, לפרק, להעתיק או לעשות בציוד כל שימוש שלא הורשה מראש ובכתב על ידי החברה.',
      'עם סיום ההתקשרות, מכל סיבה שהיא, יאפשר הלקוח לחברה גישה נאותה לציוד לצורך פירוקו והחזרתו, במצב תקין למעט בלאי סביר הנובע משימוש רגיל.',
      'במקרה של אובדן, גניבה, נזק לציוד או שימוש בלתי מורשה בו, יחויב הלקוח בעלות תיקון או החלפת הציוד, לפי קביעת החברה.',
    ],
  },
  {
    num: 7,
    title: 'שירות ותקלות',
    clauses: [
      'החברה תעניק ללקוח שירות תפעולי לתיקון תקלות בזמן סביר ממועד קבלת הפנייה, בהתאם לזמינות הצוות הטכני.',
      'הלקוח מתחייב להודיע לחברה על כל תקלה בציוד בהקדם האפשרי מרגע גילויה, ולאפשר לצוות החברה גישה נאותה לביצוע התיקון.',
    ],
  },
  {
    num: 8,
    title: 'אחריות',
    clauses: [
      'החברה תפעל באופן מקצועי, מיומן ואיכותי לאספקת השירותים נשוא הסכם זה.',
      'החברה לא תהיה אחראית לכל נזק עקיף, תוצאתי, או אובדן רווחים שייגרם ללקוח או לצד שלישי כלשהו, ' +
      'למעט במקרים של רשלנות רבתי או כוונת זדון מוכחת מצד החברה.',
    ],
  },
  {
    num: 9,
    title: 'שינויים, כללי ושונות',
    clauses: [
      'כל שינוי בתנאי הסכם זה טעון מסמך בכתב החתום על ידי שני הצדדים; לא יהיה תוקף לכל שינוי, ויתור או תוספת שנעשו בעל-פה.',
      'הדין החל על הסכם זה הוא דיני מדינת ישראל בלבד, וסמכות השיפוט הבלעדית בכל הנוגע להסכם זה נתונה לבתי המשפט המוסמכים במחוז חיפה.',
      'כותרות הסעיפים בהסכם זה נועדו לנוחות העיון בלבד ולא ישמשו לפרשנותו.',
    ],
  },
];

export const money = (value) =>
  Number(value ?? 0).toLocaleString('he-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 0 });

export function todayHebrew() {
  return new Date().toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/** סה"כ תשלום חודשי לפי שורות הציוד בנספח א' — כל שורה: model, quantity, monthlyPrice */
export function totalMonthly(items = []) {
  return items.reduce((sum, row) => sum + (Number(row.quantity) || 0) * (Number(row.monthlyPrice) || 0), 0);
}

/**
 * מסמך ה-HTML העצמאי שנשמר ב-Storage — עמוד עצמאי (לא תלוי באפליקציה),
 * כי זה מה שנפתח דרך קישור חתימה/צפייה שנשלח ללקוח, ואולי גם דרך
 * getContractUrl אחרי חתימה. עיצוב נייר לבן ומכובד, לא הזכוכית הכהה
 * של האפליקציה — זה מסמך משפטי, לא מסך ניהול.
 */
export function renderContractHtml({ customer, idNumber, items, contractDate, generatedAt }) {
  const rows = items
    .filter((row) => row.quantity > 0)
    .map((row) => `
      <tr>
        <td>${escapeHtml(row.model)}</td>
        <td>${row.quantity}</td>
        <td>${money(row.monthlyPrice)}</td>
        <td>${money(row.quantity * row.monthlyPrice)}</td>
      </tr>`).join('');

  const sections = CONTRACT_SECTIONS.map((section) => `
    <section class="clause">
      <h2>${section.num}. ${escapeHtml(section.title)}</h2>
      ${section.clauses.map((c) => `<p>${escapeHtml(c)}</p>`).join('')}
    </section>`).join('');

  return `<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>הסכם התקשרות — ${escapeHtml(customer.name)}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 32px 24px 64px; background: #f4f2ee; color: #1a1a1a;
    font-family: "Segoe UI", Arial, sans-serif; line-height: 1.65; font-size: 14.5px;
  }
  .sheet { max-width: 780px; margin: 0 auto; background: #fff; border-radius: 10px;
           box-shadow: 0 1px 4px rgba(0,0,0,.08); padding: 40px 44px; }
  .brand { display:flex; align-items:baseline; justify-content:space-between; border-bottom: 2px solid #1a1a1a;
           padding-bottom: 14px; margin-bottom: 18px; }
  .brand h1 { font-size: 22px; letter-spacing: 2px; margin: 0; }
  .brand .tagline { font-size: 11.5px; color: #666; margin-top: 2px; }
  .doc-title { text-align:center; font-size: 19px; font-weight: 700; margin: 22px 0 26px; }
  .parties { display:flex; gap: 18px; margin-bottom: 26px; font-size: 13px; }
  .party { flex:1; border: 1px solid #ddd; border-radius: 8px; padding: 14px 16px; }
  .party b { display:block; margin-bottom: 6px; font-size: 13.5px; }
  .party div { color:#333; margin-top: 2px; }
  .clause { margin-bottom: 16px; }
  .clause h2 { font-size: 14.5px; margin: 0 0 6px; }
  .clause p { margin: 0 0 6px; }
  table { width:100%; border-collapse: collapse; margin: 10px 0 4px; font-size: 13px; }
  th, td { border: 1px solid #ccc; padding: 7px 9px; text-align: start; }
  th { background: #f0f0f0; }
  .appendix-title { font-size: 15px; font-weight: 700; margin: 30px 0 10px; border-top: 1px solid #ddd; padding-top: 20px; }
  .total-row td { font-weight: 700; background: #fafafa; }
  .sign-area { display:flex; gap: 24px; margin-top: 40px; }
  .sign-box { flex:1; border-top: 1px solid #999; padding-top: 8px; font-size: 12.5px; color:#444; }
  .footer-note { margin-top: 30px; font-size: 11px; color: #888; text-align:center; }
</style>
</head>
<body>
  <div class="sheet">
    <div class="brand">
      <div>
        <h1>ICON AIR</h1>
        <div class="tagline">פתרונות ריח מתקדמים</div>
      </div>
      <div style="text-align:end; font-size:11.5px; color:#555;">
        ${escapeHtml(COMPANY.name)} · ח.פ. ${COMPANY.regNumber}<br />
        ${escapeHtml(COMPANY.address)}<br />
        ${escapeHtml(COMPANY.email)} · ${escapeHtml(COMPANY.phone)}
      </div>
    </div>

    <div class="doc-title">הסכם התקשרות לשירותי בישום עסקי</div>

    <div class="parties">
      <div class="party">
        <b>הלקוח</b>
        <div>${escapeHtml(customer.name)}</div>
        ${idNumber ? `<div>ת.ז./ח.פ.: ${escapeHtml(idNumber)}</div>` : ''}
        ${customer.address ? `<div>${escapeHtml(customer.address)}${customer.city ? ` · ${escapeHtml(customer.city)}` : ''}</div>` : ''}
        ${customer.phone ? `<div>טלפון: ${escapeHtml(customer.phone)}</div>` : ''}
        ${customer.email ? `<div>דוא״ל: ${escapeHtml(customer.email)}</div>` : ''}
      </div>
      <div class="party">
        <b>החברה</b>
        <div>${escapeHtml(COMPANY.name)}</div>
        <div>ח.פ. ${COMPANY.regNumber}</div>
        <div>${escapeHtml(COMPANY.address)}</div>
        <div>${escapeHtml(COMPANY.email)} · ${escapeHtml(COMPANY.phone)}</div>
      </div>
    </div>

    <p style="font-size:12.5px; color:#555; margin-bottom: 22px;">נחתם ביום ${escapeHtml(contractDate)}, בין הצדדים דלעיל.</p>

    ${sections}

    <div class="appendix-title">נספח א׳ — פירוט מערכות ותשלום חודשי</div>
    <table>
      <thead>
        <tr><th>דגם</th><th>כמות</th><th>מחיר חודשי ליחידה</th><th>סה״כ לחודש</th></tr>
      </thead>
      <tbody>
        ${rows || '<tr><td colspan="4" style="color:#999;">לא הוזנו מערכות</td></tr>'}
        <tr class="total-row">
          <td colspan="3">סה״כ תשלום חודשי (לפני מע״מ)</td>
          <td>${money(totalMonthly(items))}</td>
        </tr>
      </tbody>
    </table>

    <div class="sign-area">
      <div class="sign-box">${escapeHtml(COMPANY.name)} — חתימה וחותמת</div>
      <div class="sign-box" id="customer-sign-box">הלקוח — חתימה</div>
    </div>

    <div class="footer-note">מסמך זה הופק אוטומטית על ידי מערכת ICON AIR ${generatedAt ? `· ${escapeHtml(generatedAt)}` : ''}</div>
  </div>
  <script>
    // מדווח את הגובה האמיתי להורה (עמוד החתימה, מקור אחר — Storage) כדי
    // שה-iframe שם יתאים את גובהו במקום שורת גלילה כפולה מכוערת.
    function reportHeight() {
      window.parent?.postMessage({ iconairContractHeight: document.documentElement.scrollHeight }, '*');
    }
    window.addEventListener('load', reportHeight);
    new ResizeObserver(reportHeight).observe(document.body);
  </script>
</body>
</html>`;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}
