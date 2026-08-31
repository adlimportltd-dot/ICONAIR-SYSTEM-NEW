/**
 * מבנה הניווט. התוויות והאייקונים בלבד —
 * המספרים שמופיעים לצדן (18 קריאות, 4 דחופות) מגיעים מהנתונים החיים.
 */

export const navItems = [
  { id: 'dashboard', label: 'דשבורד',         shortLabel: 'דשבורד',  icon: 'grid',   inTabBar: true },
  { id: 'devices',   label: 'מכשירים בשטח',   shortLabel: 'מכשירים', icon: 'device', inTabBar: true },
  { id: 'customers', label: 'לקוחות',          shortLabel: 'לקוחות',  icon: 'users',  inTabBar: true },
  { id: 'oils',      label: 'מעקב שמנים',      shortLabel: 'שמנים',   icon: 'drop',   inTabBar: true },
  { id: 'service',   label: 'קריאות שירות',    shortLabel: 'קריאות',  icon: 'wrench', inTabBar: true },
  { id: 'routes',    label: 'מסלולים',         shortLabel: 'מסלולים', icon: 'route', inTabBar: true },
  { id: 'stock',     label: 'מלאי נייד',       shortLabel: 'מלאי',   icon: 'box',   inTabBar: true },
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