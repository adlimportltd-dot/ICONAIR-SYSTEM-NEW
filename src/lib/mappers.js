/**
 * תרגום בין מה שבסיס הנתונים מחזיר לבין מה שהקומפוננטות מציגות.
 * כל ההחלטות ה"עבריות" — חודשים, זמן יחסי, תוויות סטטוס — יושבות כאן,
 * כדי שקומפוננטת תצוגה לא תעסוק בפורמט.
 */

export const HEBREW_MONTHS = [
  'ינו', 'פבר', 'מרץ', 'אפר', 'מאי', 'יונ',
  'יול', 'אוג', 'ספט', 'אוק', 'נוב', 'דצמ',
];

// דגמים עצמם באים היום מטבלת device_models (ר' listDeviceModels
// ב-queries.js) — לא מרשימה קבועה כאן, כדי שמנהל יוכל להוסיף דגם
// חדש בלי שינוי קוד. הצבע כאן הוא רק רמז ויזואלי לדגמים המוכרים;
// דגם חדש שנוסף בהמשך פשוט מקבל צ'יפ ניטרלי (modelTone מטה) עד
// שמישהו יחליט לתת לו צבע ייעודי.
export const MODEL_TONE = {
  'Icon 50': 'neutral',
  'Icon 70': 'neutral',
  'Icon 80': 'neutral',
  'Icon 90': 'neutral',
  'Icon 150': 'neutral',
  'Icon 300': 'slate',
  'Icon 400': 'slate',
  'Icon 500': 'teal',
  'Icon 600': 'teal',
  'Icon 700': 'gold', // הזהב שמור לדגם הדגל
};

export const modelTone = (name) => MODEL_TONE[name] ?? 'neutral';

export const DEVICE_STATUS_LABEL = {
  active: 'פעיל',
  offline: 'לא מקוון',
  maintenance: 'בתחזוקה',
  uninstalled: 'הוסר',
};

export const CUSTOMER_STATUS_LABEL = {
  active: 'פעיל',
  onboarding: 'בהקמה',
  paused: 'מושהה',
  churned: 'עזב',
};

export const PAYMENT_TYPE_LABEL = {
  credit_card: 'אשראי / הוראת קבע',
  bank_transfer: 'העברה בנקאית',
  check: 'צ׳ק',
  cash: 'מזומן',
  deferred: 'מוזמן (שוטף+)',
};

export const PAYMENT_TYPE_ICON = {
  credit_card: '💳',
  bank_transfer: '🏦',
  check: '📝',
  cash: '💵',
  deferred: '🗓️',
};

export const formatCurrency = (value) =>
  Number(value ?? 0).toLocaleString('he-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 0 });

export const VAT_RATE = 0.18;

export const VAT_MODE_LABEL = {
  included: 'כולל מע״מ',
  excluded: 'לא כולל מע״מ',
};

/**
 * amount הוא הסכום שהוזן בטופס — משמעותו תלויה ב-vatMode:
 * 'included' → amount הוא כבר הסכום הסופי (מע"מ בפנים).
 * 'excluded' → amount הוא מחיר הבסיס, ומע"מ מתווסף עליו.
 * מחזיר את שלושת הסכומים מעוגלים לאגורה, כדי שהטבלה תמיד תציג
 * מספר עקבי בלי קשר לאיך שהוזן.
 */
export function computeVat(amount, vatMode) {
  const round2 = (x) => Math.round(x * 100) / 100;
  const n = Number(amount ?? 0);

  if (vatMode === 'excluded') {
    const preVat = round2(n);
    const vatAmount = round2(preVat * VAT_RATE);
    return { preVat, vatAmount, total: round2(preVat + vatAmount) };
  }

  const total = round2(n);
  const preVat = round2(total / (1 + VAT_RATE));
  return { preVat, vatAmount: round2(total - preVat), total };
}

/** תאריך פירעון עבר, והחוב עדיין פתוח — זה מה שהופך "יש תאריך" ל"יש בעיה" */
export function isOverdue(dueDate, isPaid) {
  if (!dueDate || isPaid) return false;
  return new Date(dueDate) < new Date(new Date().toDateString());
}

/** "Icon 500 ×3 · Icon 700 ×1" — מכשירים שמותקנים אצל הלקוח כרגע, לפי דגם */
export function summarizeDevicesByModel(devices = []) {
  const active = devices.filter((d) => d.status !== 'uninstalled');
  if (active.length === 0) return 'אין מכשירים בשטח';

  const counts = new Map();
  for (const d of active) counts.set(d.model, (counts.get(d.model) ?? 0) + 1);

  return [...counts.entries()].map(([model, count]) => `${model} ×${count}`).join(' · ');
}

export const CALL_STATUS_LABEL = {
  open: 'פתוחה',
  in_progress: 'בטיפול',
  resolved: 'טופלה',
  cancelled: 'בוטלה',
};

export const CALL_SEVERITY_LABEL = {
  crit: 'דחוף',
  warn: 'לטיפול',
  norm: 'רגיל',
  sched: 'מתוזמן',
};

export const OIL_EVENT_LABEL = {
  refill: 'מילוי',
  replacement: 'החלפת מכל',
  reading: 'קריאת מד',
};

/* ---------------------------------------------------------------- */

export function formatDate(value) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

export function formatDateTime(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString('he-IL', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

/** "40 דק'" · "3 שע'" · "אתמול" · "לפני 4 ימים" */
export function relativeTime(value) {
  if (!value) return '—';

  const minutes = Math.round((Date.now() - new Date(value).getTime()) / 60000);
  if (minutes < 1) return 'עכשיו';
  if (minutes < 60) return `${minutes} דק'`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} שע'`;

  const days = Math.round(hours / 24);
  if (days === 1) return 'אתמול';
  if (days < 30) return `לפני ${days} ימים`;

  return formatDate(value);
}

const num = (value, digits = 0) =>
  Number(value ?? 0).toLocaleString('he-IL', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });

/* =====================================================================
   דשבורד
   ===================================================================== */

export function mapKpis(row) {
  if (!row) return [];

  const oilNow = Number(row.oil_liters_this_month ?? 0);
  const oilPrev = Number(row.oil_liters_prev_month ?? 0);
  const oilDelta = oilPrev > 0 ? ((oilNow - oilPrev) / oilPrev) * 100 : null;

  const uptime = row.devices_total > 0
    ? (row.devices_online / row.devices_total) * 100
    : 0;

  return [
    {
      id: 'devices',
      label: 'מכשירים פעילים בשטח',
      value: num(row.devices_total),
      icon: 'device',
      iconColor: 'slate',
      trend: { direction: 'up', text: num(row.devices_installed_this_month) },
      footnote: 'התקנות חדשות החודש',
    },
    {
      id: 'calls',
      label: 'קריאות שירות פתוחות',
      value: num(row.calls_open),
      icon: 'wrench',
      iconColor: 'crit',
      trend: {
        direction: row.calls_critical > 0 ? 'down' : 'flat',
        text: `${num(row.calls_critical)} דחופות`,
        hideArrow: true,
      },
      footnote: row.avg_close_hours ? `${num(row.avg_close_hours, 1)} שעות לסגירה` : 'אין עדיין קריאות סגורות',
    },
    {
      id: 'oil',
      label: 'שמן שהוזרם החודש',
      value: num(oilNow, 1),
      unit: 'ליטר',
      icon: 'drop',
      iconColor: 'teal',
      trend: oilDelta === null
        ? { direction: 'flat', text: 'חודש ראשון', hideArrow: true }
        : { direction: oilDelta >= 0 ? 'up' : 'down', text: `${num(Math.abs(oilDelta), 1)}%` },
      footnote: 'מול החודש שעבר',
    },
    {
      id: 'clients',
      label: 'לקוחות פעילים',
      value: num(row.customers_active),
      icon: 'users',
      iconColor: 'gold',
      trend: { direction: 'flat', text: `${num(uptime, 1)}%`, hideArrow: true },
      footnote: `זמינות צי · ${num(row.customers_onboarding)} בהקמה`,
    },
  ];
}

export function mapFleet(rows = []) {
  return rows.map((row) => ({
    model: row.model,
    count: Number(row.device_count),
    color: modelTone(row.model),
  }));
}

// ערך חסר או לא מספרי (null/undefined/NaN) הופך ל-0 — לא מוצג "NaN ל'"
const finiteOrZero = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

export function mapOilConsumption(rows = []) {
  const months = rows.map((r) => HEBREW_MONTHS[new Date(r.month).getMonth()]);
  const actual = rows.map((r) => finiteOrZero(r.actual_liters));
  const forecast = rows.map((r) => finiteOrZero(r.target_liters));

  const last = actual.at(-1) ?? 0;
  const lastTarget = forecast.at(-1) ?? 0;
  const deviation = lastTarget > 0 ? ((last - lastTarget) / lastTarget) * 100 : 0;

  return {
    months,
    actual,
    forecast,
    summary: {
      actualTotal: `${num(last, 1)} ל'`,
      forecastTotal: `${num(lastTarget, 1)} ל'`,
      deviation: `${deviation >= 0 ? '+' : '−'}${num(Math.abs(deviation), 1)}%`,
    },
  };
}

export function mapServiceCalls(rows = []) {
  return rows.map((row) => ({
    id: row.code,
    rowId: row.id,
    client: row.customer?.city ? `${row.customer.name} · ${row.customer.city}` : row.customer?.name,
    description: [
      row.device?.model,
      row.title,
      row.assignee?.full_name,
    ].filter(Boolean).join(' — ').replace(' — ', ' — '),
    severity: row.severity,
    statusLabel: row.status === 'in_progress'
      ? CALL_STATUS_LABEL.in_progress
      : CALL_SEVERITY_LABEL[row.severity],
    age: relativeTime(row.opened_at),
  }));
}

export function mapOilAlerts(rows = []) {
  return rows.map((row) => ({
    client: row.customer?.city ? `${row.customer.name} · ${row.customer.city}` : row.customer?.name,
    deviceId: row.serial,
    scent: row.scent_name ?? 'ללא ניחוח משויך',
    level: Number(row.oil_level_pct),
    note: row.estimated_days_left != null
      ? `${row.estimated_days_left} ימים למלאי`
      : (row.customer?.route_name ?? 'לא משויך לקו'),
  }));
}

/** אין טבלת ביקורים מתוכננים — הפילוח הוא לפי מכשירים בפועל, ומפלס השמן הממוצע קובע את הצבע */
export function mapRoutes(rows = []) {
  return rows.map((row) => ({
    name: row.name,
    total: Number(row.total) || 0,
    active: Number(row.active) || 0,
    avgOil: Number(row.avgOil) || 0,
  }));
}

function scentTone(pct) {
  if (pct >= 40) return 'gold';
  if (pct >= 20) return 'teal';
  if (pct >= 8) return 'slate';
  return 'crit';
}

/** אין טבלת מלאי מחסן — זו תצרוכת שמן בפועל, מקובצת לפי ניחוח, מתוך oil_tracking החודש */
export function mapOilByScent(rows = []) {
  return rows.map((row) => ({
    scent: row.name,
    level: Math.round(row.pct),
    liters: Number(row.liters),
    tone: scentTone(row.pct),
  }));
}

export { num as formatNumber };
