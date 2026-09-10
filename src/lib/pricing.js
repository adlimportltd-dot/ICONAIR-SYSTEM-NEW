import { computeVat } from './mappers';

/**
 * תמחור מכשירים — מקור אמת אחד לכל המערכת (הועבר מ-CustomerProfile.jsx
 * ב-2026-09-10 כדי שגם CustomersScreen/דוחות ישתמשו באותה נוסחה בדיוק,
 * לא בעותק מקביל שעלול לסטות ממנה).
 *
 * מחיר-יחידה למכשיר: devices.unit_price אם הוזן ידנית (חריג), אחרת
 * מחיר-הדגם של הכתובת שלו (customer_site_model_prices), אחרת 0.
 * הכול לפני מע"מ; מע"מ 18% מחושב מעל הסכום (computeVat, 'excluded') —
 * זה תמיד קבוע ולא תלוי ב-vat_mode של הלקוח, כי מחירי מכשיר/דגם
 * מוזנים תמיד כסכום-לפני-מע"מ מוסכם, בניגוד ל-amount_due הידני
 * שיכול להיות "כולל" או "לפני" לפי מה שהמנהל בחר עבור אותו לקוח.
 */
export const UNASSIGNED_SITE = '__none__';

export const priceMapOf = (prices) => new Map((prices ?? []).map((p) => [p.model, Number(p.unit_price)]));

export const hasOwnPrice = (device) => device.unit_price !== null && device.unit_price !== undefined && device.unit_price !== '';

export function effectivePrice(device, priceMap) {
  if (hasOwnPrice(device)) return Number(device.unit_price);
  return priceMap.get(device.model) ?? 0;
}

/** פירוט לפי דגם עבור קבוצת מכשירים אחת (כתובת אחת, או "בלי כתובת") */
export function computeDeviceBreakdown(devices, prices) {
  const priceMap = priceMapOf(prices);
  const byModel = new Map();
  for (const d of devices) {
    if (d.status === 'uninstalled') continue;
    const line = byModel.get(d.model) ?? {
      model: d.model, count: 0, defaultUnitPrice: priceMap.get(d.model) ?? 0, lineTotal: 0, overrides: 0,
    };
    line.count += 1;
    line.lineTotal += effectivePrice(d, priceMap);
    if (hasOwnPrice(d)) line.overrides += 1;
    byModel.set(d.model, line);
  }
  const lines = [...byModel.values()].sort((a, b) => a.model.localeCompare(b.model, 'he'));
  const preVatRaw = lines.reduce((sum, l) => sum + l.lineTotal, 0);
  return { lines, ...computeVat(preVatRaw, 'excluded') };
}

/**
 * הסכום החודשי המלא של לקוח אחד: סכימה על פני כל הכתובות שלו (כל אחת
 * עם טבלת המחירים-לפי-דגם שלה) בתוספת מכשירים בלי כתובת (מחיר-מכשיר
 * בלבד, בלי מחיר-דגם — אין "מחיר דגם" בלי כתובת שמחזיקה אותו).
 * `sites` הוא מערך של {id, prices: [{model, unit_price}]}.
 */
export function computeCustomerDeviceTotal(devices, sites) {
  const bySite = new Map();
  for (const d of devices) {
    const key = d.site_id ?? UNASSIGNED_SITE;
    if (!bySite.has(key)) bySite.set(key, []);
    bySite.get(key).push(d);
  }

  let preVat = 0;
  for (const site of sites) preVat += computeDeviceBreakdown(bySite.get(site.id) ?? [], site.prices).preVat;
  preVat += computeDeviceBreakdown(bySite.get(UNASSIGNED_SITE) ?? [], []).preVat;

  const vat = computeVat(preVat, 'excluded');
  return { ...vat, hasDeviceBilling: vat.preVat > 0 };
}

/**
 * גרסת-המונים של computeCustomerDeviceTotal לכל הלקוחות יחד, מ-2 שאילתות
 * גורפות (כל המכשירים + כל מחירי-הדגם-לכתובת) במקום N+1 שאילתות פר-לקוח
 * — ר' listAllCustomerDevicePricing ב-queries.js. מחזיר
 * Map<customer_id, {preVat, vatAmount, total, hasDeviceBilling}>.
 * hasDeviceBilling=false (preVat===0) אומר "אין תמחור-מכשירים ללקוח
 * הזה" — הקורא צריך ליפול חזרה ל-amount_due הידני, ר' effectiveCustomerBilling.
 */
export function computeAllCustomerTotals(devices, sitePrices) {
  const pricesBySite = new Map();
  for (const p of sitePrices ?? []) {
    if (!pricesBySite.has(p.site_id)) pricesBySite.set(p.site_id, []);
    pricesBySite.get(p.site_id).push(p);
  }

  const devicesByCustomer = new Map();
  for (const d of devices ?? []) {
    if (d.status === 'uninstalled') continue;
    if (!devicesByCustomer.has(d.customer_id)) devicesByCustomer.set(d.customer_id, []);
    devicesByCustomer.get(d.customer_id).push(d);
  }

  const result = new Map();
  for (const [customerId, customerDevices] of devicesByCustomer) {
    const bySite = new Map();
    for (const d of customerDevices) {
      const key = d.site_id ?? UNASSIGNED_SITE;
      if (!bySite.has(key)) bySite.set(key, []);
      bySite.get(key).push(d);
    }

    let preVat = 0;
    for (const [siteKey, siteDevices] of bySite) {
      const prices = siteKey === UNASSIGNED_SITE ? [] : (pricesBySite.get(siteKey) ?? []);
      preVat += computeDeviceBreakdown(siteDevices, prices).preVat;
    }

    const vat = computeVat(preVat, 'excluded');
    result.set(customerId, { ...vat, hasDeviceBilling: vat.preVat > 0 });
  }
  return result;
}

/**
 * "כמה הלקוח הזה באמת משלם" — פונקציית-הכניסה היחידה שכל מסך צריך
 * לקרוא לה (רשימת לקוחות, דוחות, כרטיס לקוח), כדי שלעולם לא יהיו שני
 * מקומות שמחליטים "מקור אמת" אחרת. אם ללקוח יש תמחור-מכשירים אמיתי
 * (preVat>0, מ-computeAllCustomerTotals/computeCustomerDeviceTotal) —
 * זה הסכום הקובע, תמיד, גם אם amount_due הידני קיים/שונה/מיושן. רק
 * ללקוח בלי שום מכשיר מתומחר (למשל חיוב-גלובלי ידני בלבד, לא קשור
 * להתקנה בשטח) נופלים ל-amount_due+vat_mode הישן.
 */
export function effectiveCustomerBilling(customer, deviceTotal) {
  if (deviceTotal && deviceTotal.hasDeviceBilling) return deviceTotal;
  return { ...computeVat(customer?.amount_due, customer?.vat_mode), hasDeviceBilling: false };
}
