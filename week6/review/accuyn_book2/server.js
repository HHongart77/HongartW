// accuyn_book2 — Express + Supabase Postgres (가계부 UI review backend)
// Dual-mode: local `node server.js` + Vercel serverless export
//
// Schema: a single flat table `accuyn_book2_transactions`
//   (id, type, amount, category, date, memo, created_at)
//
// Note: this project intentionally uses its own table name to avoid colliding
// with sibling `week6/account_book` which writes to `transactions` /
// `categories` on the same Supabase database.

try { require('dotenv').config(); } catch (_e) { /* dotenv optional in prod */ }

const express = require('express');
const path = require('path');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;
const TABLE = 'accuyn_book2_transactions';

// ---------- DB pool ----------
const connectionString = (process.env.DATABASE_URL || '').trim();
if (!connectionString) {
  throw new Error(
    'DATABASE_URL is not set. Copy .env.example to .env and fill in your Supabase connection string.'
  );
}

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
});

// Return DATE columns as 'YYYY-MM-DD' strings (1082 = Postgres OID for DATE)
const { types } = require('pg');
types.setTypeParser(1082, (v) => v);

// ---------- Helpers ----------
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-\d{2}$/;

function normalizeRow(row) {
  if (!row) return row;
  return {
    id: row.id,
    type: row.type,
    amount: Number(row.amount),
    category: row.category,
    date: row.date,
    memo: row.memo,
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
  };
}

// ---------- Lazy DB init ----------
let dbInitialized = false;

async function initDB() {
  if (dbInitialized) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${TABLE} (
      id         SERIAL PRIMARY KEY,
      type       TEXT NOT NULL CHECK (type IN ('income','expense')),
      amount     NUMERIC(14,2) NOT NULL CHECK (amount > 0),
      category   TEXT NOT NULL,
      date       DATE NOT NULL,
      memo       TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_${TABLE}_date ON ${TABLE} (date DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_${TABLE}_type_date ON ${TABLE} (type, date)`);

  // Seed if empty — same fixtures the static client.html shipped with so the
  // first server-rendered view matches what the user already saw.
  const { rows: countRows } = await pool.query(`SELECT COUNT(*)::int AS n FROM ${TABLE}`);
  if (countRows[0].n === 0) {
    const seed = [
      ['income',  3200000, '급여',     '2026-04-25', '4월 급여'],
      ['expense', 850000,  '주거',     '2026-04-05', '월세'],
      ['expense', 98000,   '식비',     '2026-04-08', '주간 장보기'],
      ['expense', 32000,   '교통',     '2026-04-11', '택시 + 버스'],
      ['expense', 125000,  '쇼핑',     '2026-04-14', '봄 옷'],
      ['expense', 28000,   '의료',     '2026-04-17', '병원'],
      ['expense', 15000,   '기타',     '2026-04-19', '편의점'],
      ['expense', 20000,   '문화생활', '2026-04-22', '메가박스'],
      ['expense', 6500,    '식비',     '2026-04-23', '스타벅스'],
      ['expense', 12000,   '식비',     '2026-04-24', '김치찌개'],
      ['income',  50000,   '용돈',     '2026-04-10', '부모님'],
      ['income',  3200000, '급여',     '2026-03-25', '3월 급여'],
      ['expense', 180000,  '식비',     '2026-03-12', '장보기'],
      ['expense', 42000,   '문화생활', '2026-03-22', '영화+카페'],
    ];
    for (const [type, amount, category, date, memo] of seed) {
      await pool.query(
        `INSERT INTO ${TABLE} (type, amount, category, date, memo)
         VALUES ($1,$2,$3,$4,$5)`,
        [type, amount, category, date, memo]
      );
    }
  }

  dbInitialized = true;
}

// ---------- Middleware ----------
app.use(express.json());
app.use(express.static(__dirname));

app.use('/api', async (_req, res, next) => {
  try {
    await initDB();
    next();
  } catch (err) {
    console.error('[initDB]', err);
    res.status(500).json({ success: false, message: 'Database initialization failed' });
  }
});

// ---------- Routes ----------

// GET /api/transactions
app.get('/api/transactions', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, type, amount, category, date, memo, created_at
         FROM ${TABLE}
        ORDER BY date DESC, id DESC`
    );
    res.json({ success: true, data: rows.map(normalizeRow) });
  } catch (err) {
    console.error('[GET /api/transactions]', err);
    res.status(500).json({ success: false, message: 'Failed to fetch transactions' });
  }
});

// POST /api/transactions
app.post('/api/transactions', async (req, res) => {
  try {
    const { type, amount, category, date, memo } = req.body || {};

    if (type !== 'income' && type !== 'expense') {
      return res.status(400).json({ success: false, message: "type must be 'income' or 'expense'" });
    }
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      return res.status(400).json({ success: false, message: 'amount must be a positive number' });
    }
    if (typeof category !== 'string' || category.trim() === '') {
      return res.status(400).json({ success: false, message: 'category is required' });
    }
    if (typeof date !== 'string' || !DATE_RE.test(date)) {
      return res.status(400).json({ success: false, message: 'date must be YYYY-MM-DD' });
    }
    const memoVal = typeof memo === 'string' && memo.trim() !== '' ? memo.trim() : null;

    const { rows } = await pool.query(
      `INSERT INTO ${TABLE} (type, amount, category, date, memo)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING id, type, amount, category, date, memo, created_at`,
      [type, amt, category.trim(), date, memoVal]
    );
    res.status(201).json({ success: true, data: normalizeRow(rows[0]) });
  } catch (err) {
    console.error('[POST /api/transactions]', err);
    res.status(500).json({ success: false, message: 'Failed to create transaction' });
  }
});

// DELETE /api/transactions/:id
app.delete('/api/transactions/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ success: false, message: 'invalid id' });
    }
    const { rowCount } = await pool.query(`DELETE FROM ${TABLE} WHERE id = $1`, [id]);
    if (rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Transaction not found' });
    }
    res.json({ success: true, data: { id } });
  } catch (err) {
    console.error('[DELETE /api/transactions/:id]', err);
    res.status(500).json({ success: false, message: 'Failed to delete transaction' });
  }
});

// GET /api/summary?month=YYYY-MM
app.get('/api/summary', async (req, res) => {
  try {
    const month = typeof req.query.month === 'string' ? req.query.month : '';
    if (!MONTH_RE.test(month)) {
      return res.status(400).json({ success: false, message: 'month must be YYYY-MM' });
    }
    const start = `${month}-01`;
    const [y, m] = month.split('-').map(Number);
    const nextY = m === 12 ? y + 1 : y;
    const nextM = m === 12 ? 1 : m + 1;
    const end = `${nextY}-${String(nextM).padStart(2, '0')}-01`;

    const { rows } = await pool.query(
      `SELECT type, category, amount
         FROM ${TABLE}
        WHERE date >= $1 AND date < $2`,
      [start, end]
    );

    let income = 0;
    let expense = 0;
    const byCategory = {};
    for (const r of rows) {
      const a = Number(r.amount);
      if (r.type === 'income') {
        income += a;
      } else {
        expense += a;
        byCategory[r.category] = (byCategory[r.category] || 0) + a;
      }
    }
    res.json({
      success: true,
      data: { income, expense, balance: income - expense, byCategory },
    });
  } catch (err) {
    console.error('[GET /api/summary]', err);
    res.status(500).json({ success: false, message: 'Failed to build summary' });
  }
});

// ---------- SPA fallback ----------
app.get('/{*splat}', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ---------- Error handler ----------
app.use((err, _req, res, _next) => {
  console.error('[unhandled]', err);
  res.status(500).json({ success: false, message: 'Internal server error' });
});

// ---------- Dual-mode export ----------
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`accuyn_book2 server running on http://localhost:${PORT}`);
  });
}

module.exports = app;
