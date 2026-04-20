require('dotenv').config();
const { Client } = require('pg');

const connectionString = (process.env.DATABASE_URL || '').trim();
if (!connectionString) {
  console.error('❌ DATABASE_URL is not set. Add it to .env and retry.');
  process.exit(1);
}

(async () => {
  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
  await client.connect();
  console.log('✅ Connected\n');

  // Try every plausible prefix variant
  const variants = [
    '가계부 앱%',   // space
    '가계부_앱%',   // underscore
    '가계부앱%',    // none
    '가계부-앱%',   // hyphen
    '%가계부%',     // anywhere
  ];

  for (const v of variants) {
    const r = await client.query(
      `SELECT schemaname, tablename FROM pg_tables WHERE tablename LIKE $1 ORDER BY schemaname, tablename`,
      [v]
    );
    console.log(`\n━━━ LIKE '${v}' → ${r.rowCount}건 ━━━`);
    if (r.rowCount) console.table(r.rows);
  }

  // Also case-insensitive catch-all, any schema
  const all = await client.query(`
    SELECT schemaname, tablename
    FROM pg_tables
    WHERE schemaname NOT IN ('pg_catalog','information_schema','auth','storage','realtime','vault','extensions','graphql','graphql_public','net','pgsodium','pgsodium_masks','supabase_functions','_analytics','_realtime','_supavisor')
      AND tablename ~ '[가-힣]'
    ORDER BY schemaname, tablename;
  `);
  console.log(`\n━━━ 한글 포함 테이블 전체 → ${all.rowCount}건 ━━━`);
  if (all.rowCount) console.table(all.rows);

  await client.end();
})().catch(err => {
  console.error('❌', err.message);
  process.exit(1);
});
