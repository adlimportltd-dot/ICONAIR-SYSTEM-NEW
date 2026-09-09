/**
 * מבנה הניווט. התוויות והאייקונים בלבד —
 * המספרים שמופיעים לצדן (18 קריאות, 4 דחופות) מגיעים מהנתונים החיים.
 *
 * `tabBarOrder` שולט על הסדר בניווט התחתון (`BottomNav`) **בנפרד** מסדר
 * ההופעה בסרגל הצד — 2026-09-09, בעקבות דרישה מפורשת: בשטח, בטלפון,
 * מותר להיות רק 4 כפתורים (מסלולים ← לקוחות ← הכנה לקו ← קריאות שירות),
 * בלי לגעת בסדר/בתפריט המלא שמוצג לאדמין בדסקטופ. `inTabBar` בלי
 * `tabBarOrder` לא מופיע ב-BottomNav בכלל.
 */
export const navItems = [
  { id: 'dashboard', label: 'דשבורד',         shortLabel: 'דשבורד',  icon: 'grid' },
  { id: 'devices',   label: 'מכשירים בשטח',   shortLabel: 'מכשירים', icon: 'device' },
  { id: 'customers', label: 'לקוחות',          shortLabel: 'לקוחות',  icon: 'users',  inTabBar: true, tabBarOrder: 2 },
  { id: 'oils',      label: 'מעקב שמנים',      shortLabel: 'שמנים',   icon: 'drop' },
  { id: 'service',   label: 'קריאות שירות',    shortLabel: 'קריאות שירות', icon: 'wrench', inTabBar: true, tabBarOrder: 4 },
  { id: 'routes',    label: 'מסלולים',         shortLabel: 'מסלולים', icon: 'route', inTabBar: true, tabBarOrder: 1 },
  { id: 'stock',     label: 'מלאי נייד',       shortLabel: 'הכנה לקו', icon: 'box', inTabBar: true, tabBarOrder: 3 },
  { id: 'reports',   label: 'דוחות',           shortLabel: 'דוחות',   icon: 'chart' },
  { id: 'catalog',   label: 'ניהול מלאי',        shortLabel: 'מלאי ראשי', icon: 'tag', adminOnly: true },
];

export const settingsNavItem = {
  id: 'settings',
  label: 'הגדרות',
  icon: 'settings',
};

export const allNavItems = [...navItems, settingsNavItem];

/** תת-הכותרת של כל מסך, מחושבת מהמדדים החיים */
export function screenMeta(id, kpis) {
  if (!kpis) return '';

  const n = (value) => Number(value ?? 0).toLocaleString('he-IL');

  switch (id) {
    case 'dashboard':
      return `סקירה כללית · ${n(kpis.devices_online)} מתוך ${n(kpis.devices_total)} מכשירים מקוונים`;
    case 'devices':
      return `${n(kpis.devices_total)} מכשירים מותקנים · ${n(kpis.devices_total - kpis.devices_online)} לא מקוונים`;
    case 'customers':
      return `${n(kpis.customers_active)} לקוחות פעילים · ${n(kpis.customers_onboarding)} בתהליך הקמה`;
    case 'oils':
      return `${Number(kpis.oil_liters_this_month ?? 0).toFixed(1)} ליטר הוזרמו החודש`;
    case 'service':
      return `${n(kpis.calls_open)} קריאות פתוחות · ${n(kpis.calls_critical)} דחופות`;
    case 'routes':
      return 'עצירות לפי קו, עם ניווט חד-לחיצה';
    case 'stock':
      return 'מה יש ברכב של כל טכנאי כרגע';
    case 'reports':
      return 'סיכומים וייצוא נתונים';
    case 'catalog':
      return 'קליטת סחורה למחסן והקצאה לטכנאים';
    case 'settings':
      return 'חשבון, הרשאות והתראות';
    default:
      return '';
  }
}