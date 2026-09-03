/**
 * מוריד את כל הקבצים מה-buckets הציבוריים ("contracts", "branding") לתיקייה
 * מקומית, כחלק מהגיבוי היומי. משתמש ב-service role key (רק ב-CI, דרך secret
 * — לא נכתב או מנוהל על ידי Claude, ר' README באות ה-workflow).
 */
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const OUT_DIR = process.argv[2];
const BUCKETS = ['contracts', 'branding'];

if (!OUT_DIR) {
  console.error('Usage: node backup-storage-buckets.js <out-dir>');
  process.exit(1);
}

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

async function walk(bucket, prefix = '') {
  const { data, error } = await supabase.storage.from(bucket).list(prefix, { limit: 1000 });
  if (error) throw error;

  for (const entry of data ?? []) {
    const entryPath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.id === null) {
      // תיקייה (Supabase Storage מסמן פריט-תיקייה עם id null) — יורדים רקורסיבית
      await walk(bucket, entryPath);
      continue;
    }

    const { data: fileData, error: downloadError } = await supabase.storage.from(bucket).download(entryPath);
    if (downloadError) {
      console.error(`  ! failed to download ${bucket}/${entryPath}: ${downloadError.message}`);
      continue;
    }

    const localPath = path.join(OUT_DIR, bucket, entryPath);
    fs.mkdirSync(path.dirname(localPath), { recursive: true });
    fs.writeFileSync(localPath, Buffer.from(await fileData.arrayBuffer()));
    console.log(`  saved ${bucket}/${entryPath}`);
  }
}

async function run() {
  for (const bucket of BUCKETS) {
    console.log(`backing up bucket: ${bucket}`);
    await walk(bucket);
  }
}

run().catch((error) => {
  console.error('backup-storage-buckets failed:', error.message);
  process.exit(1);
});
