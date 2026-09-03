/**
 * בדיקת תקינות בוקר — רצה אחרי הגיבוי היומי (workflow: daily-backup.yml).
 * כל בדיקה שנכשלת מדפיסה שגיאה ברורה; אם משהו נכשל, ה-script יוצא עם קוד
 * שגיאה != 0, מה שהופך את ריצת ה-workflow ל"אדומה" ב-GitHub Actions —
 * זו ההתראה בפועל (GitHub שולח אימייל אוטומטי על ריצה שנכשלה לכל מי שעוקב
 * אחרי הריפו, בברירת המחדל של GitHub, בלי שום קוד נוסף לכתוב).
 */
const { Client } = require('pg');

let failures = 0;

function fail(label, detail) {
  failures += 1;
  console.error(`✗ ${label}: ${detail}`);
}

function ok(label, detail) {
  console.log(`✓ ${label}${detail ? ` — ${detail}` : ''}`);
}

async function run() {
  const client = new Client({ connectionString: process.env.SUPABASE_DB_URL });
  await client.connect();

  try {
    // --- 1. אוורסט / customer_sites מסונכרן ---
    const sites = await client.query(`
      select count(*) from customer_sites cs
      join customers c on c.id = cs.customer_id
      where c.name ilike '%אוורסט%'
    `);
    const siteCount = Number(sites.rows[0].count);
    if (siteCount === 0) {
      fail('אוורסט / customer_sites', 'אין אף שורת אתר רשומה ללקוח אוורסט');
    } else {
      ok('אוורסט / customer_sites', `${siteCount} אתרים רשומים`);
    }

    const unrouted = await client.query(`
      select count(*) from devices d
      join customers cu on cu.id = d.customer_id
      where d.city is null and (cu.route_name is null or cu.route_name = '')
    `);
    const unroutedCount = Number(unrouted.rows[0].count);
    if (unroutedCount > 0) {
      fail('שיוך מכשירים לקו', `${unroutedCount} מכשירים בלי עיר ובלי route_name של הלקוח — לא ישויכו לאף קו`);
    } else {
      ok('שיוך מכשירים לקו', 'כל מכשיר פעיל משויך לקו, ישירות או דרך fallback');
    }

    // --- 2. דוח העמסה מוכן ---
    const missingCapacity = await client.query(`
      select count(*) from device_models where active and capacity_ml is null
    `);
    const missingCapacityCount = Number(missingCapacity.rows[0].count);
    if (missingCapacityCount > 0) {
      fail('נתוני קיבולת לדוח העמסה', `${missingCapacityCount} דגמים פעילים בלי capacity_ml`);
    } else {
      ok('נתוני קיבולת לדוח העמסה', 'לכל הדגמים הפעילים יש capacity_ml');
    }

    const routes = await client.query(`select count(*) from routes where active`);
    if (Number(routes.rows[0].count) === 0) {
      fail('קווי הפצה', 'אין אף קו פעיל בטבלת routes');
    } else {
      ok('קווי הפצה', `${routes.rows[0].count} קווים פעילים`);
    }

    // --- 3. אין חסימות במעקב שמנים ---
    const trigger = await client.query(`
      select p.prosecdef from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'oil_tracking_sync_device'
    `);
    if (trigger.rows[0]?.prosecdef !== true) {
      fail('oil_tracking_sync_device', 'הפונקציה לא (או כבר לא) SECURITY DEFINER — עדכון מפלס שמן ייכשל בשקט');
    } else {
      ok('oil_tracking_sync_device', 'SECURITY DEFINER תקין');
    }

    const policy = await client.query(`
      select pg_get_expr(polqual, polrelid) as u
      from pg_policy where polrelid = 'public.service_calls'::regclass and polname = 'service_calls_update'
    `);
    if (!policy.rows[0]?.u?.includes('assigned_to IS NULL')) {
      fail('service_calls_update RLS', 'החוק לא כולל עוד assigned_to IS NULL — טכנאי לא יוכל לקחת קריאה פתוחה');
    } else {
      ok('service_calls_update RLS', 'תקין');
    }

    const capacityTrigger = await client.query(`
      select count(*) from pg_trigger where tgname = 'oil_tracking_enforce_capacity' and not tgisinternal
    `);
    if (Number(capacityTrigger.rows[0].count) === 0) {
      fail('אכיפת קיבולת מיכלים', 'הטריגר oil_tracking_enforce_capacity לא קיים');
    } else {
      ok('אכיפת קיבולת מיכלים', 'הטריגר קיים ופעיל');
    }
  } finally {
    await client.end();
  }

  console.log('');
  if (failures > 0) {
    console.error(`בדיקת הבוקר נכשלה: ${failures} בעיה/ות. ר' לוג מעל.`);
    process.exit(1);
  }
  console.log('בדיקת הבוקר עברה — הכול תקין.');
}

run().catch((error) => {
  console.error('morning-health-check crashed:', error.message);
  process.exit(1);
});
