// One-off migration: normalized 가계부 schema (categories + transactions).
// Run with:  DATABASE_URL="postgresql://..." node migrate.js
//
// Idempotent — safe to re-run. Drops the legacy `week6_transactions` if present.

const { Pool } = require('pg');

const connectionString = (process.env.DATABASE_URL || '').trim();
if (!connectionString) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
});

const SEED_CATEGORIES = [
  // expense
  { name: '식비',     type: 'expense', emoji: '🍚', sort_order: 1 },
  { name: '교통',     type: 'expense', emoji: '🚌', sort_order: 2 },
  { name: '쇼핑',     type: 'expense', emoji: '🛍️', sort_order: 3 },
  { name: '문화생활', type: 'expense', emoji: '🎬', sort_order: 4 },
  { name: '주거',     type: 'expense', emoji: '🏠', sort_order: 5 },
  { name: '의료',     type: 'expense', emoji: '💊', sort_order: 6 },
  { name: '기타',     type: 'expense', emoji: '🗂️', sort_order: 99 },
  // income
  { name: '급여',     type: 'income',  emoji: '💼', sort_order: 1 },
  { name: '용돈',     type: 'income',  emoji: '💝', sort_order: 2 },
  { name: '기타',     type: 'income',  emoji: '💰', sort_order: 99 },
];

(async () => {
  const client = await pool.connect();
  try {
    console.log('→ Dropping legacy week6_transactions (if exists) ...');
    await client.query('DROP TABLE IF EXISTS week6_transactions CASCADE');

    console.log('→ Creating categories ...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS categories (
        id         SERIAL PRIMARY KEY,
        name       TEXT NOT NULL,
        type       TEXT NOT NULL CHECK (type IN ('income','expense')),
        emoji      TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (name, type)
      );
    `);

    console.log('→ Creating transactions ...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS transactions (
        id          SERIAL PRIMARY KEY,
        type        TEXT NOT NULL CHECK (type IN ('income','expense')),
        amount      NUMERIC(14,2) NOT NULL CHECK (amount > 0),
        category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
        date        DATE NOT NULL,
        memo        TEXT,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    console.log('→ Creating indexes ...');
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions (date DESC)`
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_transactions_type_date ON transactions (type, date)`
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions (category_id)`
    );

    console.log('→ Seeding default categories ...');
    for (const c of SEED_CATEGORIES) {
      await client.query(
        `INSERT INTO categories (name, type, emoji, sort_order)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (name, type) DO UPDATE
           SET emoji = EXCLUDED.emoji,
               sort_order = EXCLUDED.sort_order`,
        [c.name, c.type, c.emoji, c.sort_order]
      );
    }

    console.log('\n✓ Tables in public:');
    const { rows: tables } = await client.query(`
      SELECT table_name
        FROM information_schema.tables
       WHERE table_schema = 'public'
       ORDER BY table_name
    `);
    console.table(tables);

    console.log('\n✓ categories rows:');
    const { rows: catRows } = await client.query(
      `SELECT id, name, type, emoji, sort_order FROM categories ORDER BY type, sort_order, name`
    );
    console.table(catRows);

    console.log('\n✓ transactions row count:');
    const { rows: txCount } = await client.query(
      'SELECT COUNT(*)::int AS n FROM transactions'
    );
    console.log(`  ${txCount[0].n}`);

    console.log('\nDone.');
  } catch (err) {
    console.error('Migration failed:', err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();
