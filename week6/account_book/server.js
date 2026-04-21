// Week6 Account Book — Express + Supabase Postgres
// Dual-mode: local `node server.js` + Vercel serverless export

const express = require('express');
const path = require('path');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

// ---------- DB pool (lazy, safe for serverless cold starts) ----------
const FALLBACK_DATABASE_URL =
  'postgresql://postgres.ybwjaugezfpzbzvatvcl:xulf70bFh3msKS17@aws-1-ap-southeast-1.pooler.supabase.com:6543/postgres';

const connectionString = (process.env.DATABASE_URL || FALLBACK_DATABASE_URL).trim();

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
});

// Return DATE columns as 'YYYY-MM-DD' strings instead of JS Date objects.
// 1082 = OID for DATE in Postgres.
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
    amount: Number(row.amount), // NUMERIC -> number
    category: row.category,
    date: row.date, // already 'YYYY-MM-DD' via type parser
    memo: row.memo,
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
  };
}

// ---------- Lazy DB init ----------
let dbInitialized = false;

async function initDB() {
  if (dbInitialized) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS week6_transactions (
      id         SERIAL PRIMARY KEY,
      type       TEXT NOT NULL CHECK (type IN ('income','expense')),
      amount     NUMERIC(14,2) NOT NULL CHECK (amount > 0),
      category   TEXT NOT NULL,
      date       DATE NOT NULL,
      memo       TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // Seed realistic Korean samples if empty. Mix of 2026-04 (current) and 2026-03.
  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM week6_transactions');
  if (rows[0].n === 0) {
    const seed = [
      // 2026-03 (previous month)
      ['income',  3200000, '급여',       '2026-03-25', '3월 급여'],
      ['income',    50000, '용돈',       '2026-03-10', '부모님 용돈'],
      ['expense',  850000, '주거',       '2026-03-05', '월세'],
      ['expense',  180000, '식비',       '2026-03-12', '장보기 + 외식'],
      ['expense',   65000, '교통',       '2026-03-15', '대중교통 충전'],
      ['expense',   42000, '문화생활',   '2026-03-22', '영화 + 카페'],
      // 2026-04 (current month, today = 2026-04-21)
      ['income',  3200000, '급여',       '2026-04-20', '4월 급여'],
      ['expense',  850000, '주거',       '2026-04-05', '월세'],
      ['expense',   98000, '식비',       '2026-04-08', '주간 장보기'],
      ['expense',   32000, '교통',       '2026-04-11', '택시 + 버스'],
      ['expense',  125000, '쇼핑',       '2026-04-14', '봄 옷 구매'],
      ['expense',   28000, '의료',       '2026-04-17', '병원 진료비'],
      ['expense',   15000, '기타',       '2026-04-19', '편의점'],
    ];
    const values = [];
    const placeholders = seed.map((s, i) => {
      const b = i * 5;
      values.push(...s);
      return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5})`;
    });
    await pool.query(
      `INSERT INTO week6_transactions (type, amount, category, date, memo) VALUES ${placeholders.join(',')}`,
      values
    );
  }

  dbInitialized = true;
}

// ---------- Middleware ----------
app.use(express.json());
app.use(express.static(__dirname));

// Lazy init guard for every /api/* call
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
      'SELECT id, type, amount, category, date, memo, created_at FROM week6_transactions ORDER BY date DESC, id DESC'
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
      `INSERT INTO week6_transactions (type, amount, category, date, memo)
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
    const { rowCount } = await pool.query('DELETE FROM week6_transactions WHERE id = $1', [id]);
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
    // first day of next month
    const [y, m] = month.split('-').map(Number);
    const nextY = m === 12 ? y + 1 : y;
    const nextM = m === 12 ? 1 : m + 1;
    const end = `${nextY}-${String(nextM).padStart(2, '0')}-01`;

    const { rows } = await pool.query(
      `SELECT type, category, amount
         FROM week6_transactions
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
      data: {
        income,
        expense,
        balance: income - expense,
        byCategory,
      },
    });
  } catch (err) {
    console.error('[GET /api/summary]', err);
    res.status(500).json({ success: false, message: 'Failed to build summary' });
  }
});

// ---------- SPA fallback (Express 5 splat) ----------
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
    console.log(`Account Book server running on http://localhost:${PORT}`);
  });
}

module.exports = app;
