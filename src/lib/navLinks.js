/**
 * קישורי ניווט חד-לחיצה לוויז ול-Google Maps.
 *
 * שני האפליקציות מקבלות כתובת כטקסט חופשי ומגלות מיקום בעצמן — אין
 * צורך בגיאוקודינג בצד שלנו. הניקוי כאן מוריד רק את מה שממש שובר
 * חיפוש (קודי כניסה, מספרי דירה בסוגריים), לא מנסה לפרסר את הכתובת.
 */
function cleanAddressForMaps(address) {
  if (!address) return '';
  return address
    .replace(/\(.*?\)/g, ' ')          // "(קוד כניסה: #1234)" וכו'
    .replace(/קוד כניסה[^,]*/g, ' ')   // אותו דבר בלי סוגריים
    .replace(/כניסה\s*:\s*\S*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** קישור וויז לתחנה בודדת — נפתח באפליקציה אם מותקנת, אחרת בדפדפן. */
export function wazeLink(address) {
  const clean = cleanAddressForMaps(address);
  if (!clean) return null;
  return `https://waze.com/ul?q=${encodeURIComponent(clean)}&navigate=yes`;
}

/** קישור Google Maps לתחנה בודדת, עם ניווט מיידי (turn-by-turn). */
export function googleMapsLink(address) {
  const clean = cleanAddressForMaps(address);
  if (!clean) return null;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(clean)}&travelmode=driving`;
}

// Google Maps מגביל בקישור דפדפן ל-~25 עצירות ביניים; זה תקרה הגיונית
// למסלול הפצה יומי, לא מגבלה שנבחרה שרירותית.
const MAX_WAYPOINTS = 23;

/**
 * קישור Google Maps למסלול שלם עם כמה עצירות (waypoints), לפי הסדר
 * הנוכחי ברשימה — למבט-על של המנהל, לא לניווט בפועל מהרכב.
 * מחזיר null אם אין מספיק כתובות תקינות למסלול.
 */
export function googleMapsRouteLink(addresses) {
  const clean = addresses.map(cleanAddressForMaps).filter(Boolean);
  if (clean.length < 2) return null;

  const origin = clean[0];
  const destination = clean[clean.length - 1];
  const waypoints = clean.slice(1, -1).slice(0, MAX_WAYPOINTS);

  const params = new URLSearchParams({
    api: '1',
    origin,
    destination,
    travelmode: 'driving',
  });
  if (waypoints.length) params.set('waypoints', waypoints.join('|'));

  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

/** קישור וואטסאפ עם טקסט מוכן מראש — לשליחת קישור חתימה על חוזה, בין השאר. */
export function whatsappLink(phone, text) {
  const digits = String(phone ?? '').replace(/\D/g, '');
  if (!digits) return null;
  // מספר ישראלי מקומי (05X...) -> בינלאומי (972...) בלי ה-0 המוביל
  const international = digits.startsWith('0') ? `972${digits.slice(1)}` : digits;
  return `https://wa.me/${international}?text=${encodeURIComponent(text)}`;
}

export { cleanAddressForMaps };
