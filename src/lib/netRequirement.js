/**
 * מלאי נטו נדרש (Net Requirement) — 2026-09-28, בקשה מפורשת.
 *
 * לכל פריט בנפרד (ניחוח בליטרים, או דגם מכשיר ביחידות):
 *   target_quantity  — היעד הנדרש לקו/לתכנון (מ-getRouteLoadPlan)
 *   existing_stock   — המלאי הקיים בפועל במחסן הראשי (warehouse_stock)
 *   on_order         — כבר בהזמנות רכש פתוחות ל-ADL (phase49), שעוד לא נקלטו
 *   net_required     — מה שחובה להביא/להזמין בפועל:
 *       existing + on_order < target  →  target − existing − on_order
 *       אחרת                           →  0
 * (בלי הזמנות פתוחות זו בדיוק הנוסחה: target − existing, ומינימום 0.)
 *
 * מקור אמת יחיד לנוסחה — גם המסך וגם הדוח משתמשים רק בזה.
 * המלאי שכבר ברכבי הטכנאים (technician_stock) לא מקוזז כאן בכוונה.
 */

const round2 = (n) => Math.round(n * 100) / 100;

/** הנוסחה עצמה. קלט שלילי/לא מספרי נחשב 0. */
export function netRequired(targetQuantity, existingStock, onOrder = 0) {
  const target = Math.max(0, Number(targetQuantity) || 0);
  const covered = Math.max(0, Number(existingStock) || 0) + Math.max(0, Number(onOrder) || 0);
  return covered < target ? round2(target - covered) : 0;
}

const keyOf = (s) => String(s ?? '').trim();

/**
 * מפות מלאי מחסן לפי מפתח פריט. שורת מחסן היא ניחוח (scent_name לא ריק,
 * ליטרים) או דגם (model, יחידות) — ר' warehouse_stock_item_shape (phase8).
 * כמה שורות עם אותו מפתח (נתונים ישנים) מצטברות.
 */
export function indexWarehouseStock(rows) {
  const scents = new Map();
  const models = new Map();
  for (const r of rows ?? []) {
    const qty = Number(r.quantity) || 0;
    const scent = keyOf(r.scent_name);
    if (scent) scents.set(scent, (scents.get(scent) ?? 0) + qty);
    else if (keyOf(r.model)) models.set(keyOf(r.model), (models.get(keyOf(r.model)) ?? 0) + qty);
  }
  return { scents, models };
}

/** יתרה פתוחה (הוזמן − נקלט) לפי פריט, מתוך שורות purchase_order_lines פתוחות. */
export function indexOpenPurchaseLines(rows) {
  const scents = new Map();
  const models = new Map();
  for (const r of rows ?? []) {
    const open = Math.max(0, (Number(r.ordered_qty) || 0) - (Number(r.received_qty) || 0));
    if (!open) continue;
    const map = r.item_kind === 'model' ? models : scents;
    const key = keyOf(r.item_kind === 'model' ? r.model : r.scent_name);
    if (key) map.set(key, (map.get(key) ?? 0) + open);
  }
  return { scents, models };
}

/**
 * targets: [{ key, target }] → [{ key, target_quantity, existing_stock, on_order, net_required }]
 * ממוין: מה שחסר קודם (net גבוה → נמוך), אחר כך מה שמכוסה.
 */
export function computeNetRequirements(targets, stockByKey, onOrderByKey = new Map()) {
  return targets
    .map(({ key, target }) => {
      const target_quantity = round2(Math.max(0, Number(target) || 0));
      const existing_stock = round2(stockByKey.get(keyOf(key)) ?? 0);
      const on_order = round2(onOrderByKey.get(keyOf(key)) ?? 0);
      return { key, target_quantity, existing_stock, on_order, net_required: netRequired(target_quantity, existing_stock, on_order) };
    })
    .sort((a, b) => b.net_required - a.net_required || String(a.key).localeCompare(String(b.key), 'he'));
}
