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

    // --- phase65: משימות מתוזמנות (cron) — כל משימה רצה ב-24 השעות האחרונות ובלי כשלונות ---
    const cronJobs = await client.query(`
      select j.jobname,
        count(r.*) filter (where r.start_time > now() - interval '24 hours') as runs,
        count(r.*) filter (where r.start_time > now() - interval '24 hours' and r.status <> 'succeeded') as failed,
        max(r.start_time) as last_run
      from cron.job j
      left join cron.job_run_details r on r.jobid = j.jobid
      group by j.jobname
    `);
    for (const job of cronJobs.rows) {
      const lastRun = job.last_run ? new Date(job.last_run) : null;
      const minutesAgo = lastRun ? Math.round((Date.now() - lastRun.getTime()) / 60000) : null;
      if (!lastRun || minutesAgo > 60) {
        fail(`משימה מתוזמנת ${job.jobname}`, lastRun ? `לא רצה כבר ${minutesAgo} דקות` : 'לא רצה אף פעם');
      } else if (Number(job.failed) > 0) {
        fail(`משימה מתוזמנת ${job.jobname}`, `${job.failed} כשלונות מתוך ${job.runs} ריצות ב-24 שעות`);
      } else {
        ok(`משימה מתוזמנת ${job.jobname}`, `${job.runs} ריצות ב-24 שעות, בלי כשלונות`);
      }
    }

    // --- phase65: צי חכם — הסנכרון מ-Aroma Link באמת מעדכן נתונים (לא רק שהמשימה רצה) ---
    const iotSync = await client.query(`select max(last_sync_at) as last_sync, count(*) as devices from iot_devices`);
    const lastSync = iotSync.rows[0].last_sync ? new Date(iotSync.rows[0].last_sync) : null;
    const syncMinutes = lastSync ? Math.round((Date.now() - lastSync.getTime()) / 60000) : null;
    if (Number(iotSync.rows[0].devices) === 0) {
      ok('סנכרון צי חכם', 'אין עדיין מכשירים מחוברים');
    } else if (!lastSync || syncMinutes > 30) {
      fail('סנכרון צי חכם', lastSync ? `הסנכרון האחרון לפני ${syncMinutes} דקות (אמור להיות כל 5 דקות)` : 'אף מכשיר לא סונכרן');
    } else {
      ok('סנכרון צי חכם', `סונכרן לפני ${syncMinutes} דקות, ${iotSync.rows[0].devices} מכשירים`);
    }

    // --- phase65: רישום מילויים מהשטח — הטכנאים מזינים (4 ימים כדי לא להתריע על סוף שבוע) ---
    const oilEntries = await client.query(`select max(recorded_at) as last_entry from oil_tracking`);
    const lastEntry = oilEntries.rows[0].last_entry ? new Date(oilEntries.rows[0].last_entry) : null;
    const entryDays = lastEntry ? Math.floor((Date.now() - lastEntry.getTime()) / 86400000) : null;
    if (!lastEntry || entryDays > 4) {
      fail('רישום מילויים מהשטח', lastEntry ? `לא נרשם מילוי כבר ${entryDays} ימים` : 'אין רישומי מילוי');
    } else {
      ok('רישום מילויים מהשטח', `המילוי האחרון נרשם לפני ${entryDays} ימים`);
    }

    // --- phase64/65: כמות מילוי למכשיר — השדה קיים (אחרת המסלולים חוזרים לכמות של הדגם בלבד) ---
    const fillCol = await client.query(`
      select count(*) from information_schema.columns
      where table_schema = 'public' and table_name = 'devices' and column_name = 'fill_ml'
    `);
    if (Number(fillCol.rows[0].count) === 0) {
      fail('כמות מילוי למכשיר', 'השדה devices.fill_ml חסר');
    } else {
      ok('כמות מילוי למכשיר', 'השדה קיים');
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
