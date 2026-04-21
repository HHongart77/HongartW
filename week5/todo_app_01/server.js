const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 3000;

const TABLE_PREFIX = 'todo_app_01';
const TODOS_TABLE = `${TABLE_PREFIX}_todos`;
const USERS_TABLE = `${TABLE_PREFIX}_users`;

const FALLBACK_DB_URL =
  'postgresql://postgres.wdohgoccwlrkroaxkuue:VY3el1bEQOf7Fgf7@aws-1-us-east-1.pooler.supabase.com:6543/postgres';

const JWT_SECRET = (process.env.JWT_SECRET || 'dev-only-secret-change-me-in-prod').trim();
const JWT_EXPIRES_IN = '7d';

const pool = new Pool({
  connectionString: (process.env.DATABASE_URL || FALLBACK_DB_URL).trim(),
  ssl: { rejectUnauthorized: false },
});

app.use(express.json());
app.use(express.static(path.join(__dirname)));

// ---------- Password hashing (scrypt, salt:hash) ----------
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored || typeof stored !== 'string' || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const hashBuf = Buffer.from(hash, 'hex');
  const testBuf = crypto.scryptSync(password, salt, 64);
  if (hashBuf.length !== testBuf.length) return false;
  return crypto.timingSafeEqual(hashBuf, testBuf);
}

// ---------- JWT ----------
function signToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: '로그인이 필요합니다.' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: '유효하지 않은 토큰입니다.' });
  }
}

function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: '로그인이 필요합니다.' });
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: '권한이 없습니다.' });
    }
    next();
  };
}

// ---------- Input validation ----------
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function validateCredentials({ email, password }) {
  if (!email || typeof email !== 'string' || !EMAIL_RE.test(email)) {
    return '이메일 형식이 올바르지 않습니다.';
  }
  if (!password || typeof password !== 'string' || password.length < 8) {
    return '비밀번호는 8자 이상이어야 합니다.';
  }
  return null;
}

// ---------- Lazy DB init ----------
let dbInitialized = false;
let dbInitPromise = null;

async function initDB() {
  if (dbInitialized) return;
  if (dbInitPromise) return dbInitPromise;

  dbInitPromise = (async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ${TODOS_TABLE} (
        id         SERIAL      PRIMARY KEY,
        text       TEXT        NOT NULL,
        completed  BOOLEAN     NOT NULL DEFAULT false,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    console.log(`✓ DB ready: ${TODOS_TABLE}`);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS ${USERS_TABLE} (
        id            SERIAL      PRIMARY KEY,
        email         TEXT        NOT NULL UNIQUE,
        password_hash TEXT        NOT NULL,
        role          TEXT        NOT NULL DEFAULT 'user',
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    // Migrations (idempotent — safe if columns already exist from seed.js)
    await pool.query(`ALTER TABLE ${USERS_TABLE} ADD COLUMN IF NOT EXISTS name TEXT`);
    await pool.query(
      `ALTER TABLE ${USERS_TABLE} ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
    );
    await pool.query(
      `ALTER TABLE ${TODOS_TABLE} ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES ${USERS_TABLE}(id) ON DELETE CASCADE`
    );
    await pool.query(
      `ALTER TABLE ${TODOS_TABLE} ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
    );
    await pool.query(
      `CREATE INDEX IF NOT EXISTS idx_${TABLE_PREFIX}_todos_user_id ON ${TODOS_TABLE}(user_id)`
    );
    console.log(`✓ DB ready: ${USERS_TABLE}`);

    // Seed super admin if missing
    const SUPER_EMAIL = 'rada12@naver.com';
    const SUPER_PASSWORD = 'Skstoa77!@#$';
    const SUPER_ROLE = 'super_admin';

    const { rows: existing } = await pool.query(
      `SELECT id FROM ${USERS_TABLE} WHERE email = $1`,
      [SUPER_EMAIL]
    );

    if (existing.length === 0) {
      const passwordHash = hashPassword(SUPER_PASSWORD);
      await pool.query(
        `INSERT INTO ${USERS_TABLE} (email, password_hash, role)
         VALUES ($1, $2, $3)
         ON CONFLICT (email) DO NOTHING`,
        [SUPER_EMAIL, passwordHash, SUPER_ROLE]
      );
      console.log(`✓ Super admin seeded: ${SUPER_EMAIL}`);
    } else {
      console.log(`✓ Super admin already exists: ${SUPER_EMAIL}`);
    }

    dbInitialized = true;
  })();

  try {
    await dbInitPromise;
  } catch (err) {
    dbInitPromise = null;
    throw err;
  }
}

// Ensure DB is ready before any /api request
app.use('/api', async (_req, res, next) => {
  try {
    await initDB();
    next();
  } catch (err) {
    console.error('DB init failed:', err.message);
    res.status(500).json({ error: 'Database initialization failed' });
  }
});

// ---------- Todos API (all routes require auth, scoped by user) ----------
app.get('/api/todos', authRequired, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, text, completed, created_at FROM ${TODOS_TABLE}
       WHERE user_id = $1 ORDER BY created_at ASC`,
      [req.user.sub]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/todos', authRequired, async (req, res) => {
  const { text } = req.body;
  if (!text?.trim()) return res.status(400).json({ error: '내용을 입력해주세요.' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO ${TODOS_TABLE} (user_id, text) VALUES ($1, $2)
       RETURNING id, text, completed, created_at`,
      [req.user.sub, text.trim()]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/todos/:id', authRequired, async (req, res) => {
  const { id } = req.params;
  const { completed } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE ${TODOS_TABLE} SET completed = $1, updated_at = NOW()
       WHERE id = $2 AND user_id = $3
       RETURNING id, text, completed, created_at`,
      [completed, id, req.user.sub]
    );
    if (!rows.length) return res.status(404).json({ error: '없는 항목입니다.' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/todos/completed must come before /:id
app.delete('/api/todos/completed', authRequired, async (req, res) => {
  try {
    await pool.query(
      `DELETE FROM ${TODOS_TABLE} WHERE user_id = $1 AND completed = true`,
      [req.user.sub]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/todos/:id', authRequired, async (req, res) => {
  const { id } = req.params;
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM ${TODOS_TABLE} WHERE id = $1 AND user_id = $2`,
      [id, req.user.sub]
    );
    if (!rowCount) return res.status(404).json({ error: '없는 항목입니다.' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- Auth API ----------
// POST /api/signup { email, password, name? }
app.post('/api/signup', async (req, res) => {
  const { email, password, name } = req.body || {};
  const invalid = validateCredentials({ email, password });
  if (invalid) return res.status(400).json({ error: invalid });

  try {
    const normalizedEmail = email.trim().toLowerCase();
    const { rows: existing } = await pool.query(
      `SELECT id FROM ${USERS_TABLE} WHERE email = $1`,
      [normalizedEmail]
    );
    if (existing.length) {
      return res.status(409).json({ error: '이미 가입된 이메일입니다.' });
    }

    const { rows } = await pool.query(
      `INSERT INTO ${USERS_TABLE} (email, password_hash, name, role)
       VALUES ($1, $2, $3, 'user')
       RETURNING id, email, name, role`,
      [normalizedEmail, hashPassword(password), name?.trim() || null]
    );
    const user = rows[0];
    const token = signToken(user);
    res.status(201).json({ token, user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/login { email, password }
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: '이메일과 비밀번호를 입력해주세요.' });
  }
  try {
    const { rows } = await pool.query(
      `SELECT id, email, password_hash, name, role FROM ${USERS_TABLE} WHERE email = $1`,
      [email.trim().toLowerCase()]
    );
    const user = rows[0];
    if (!user || !verifyPassword(password, user.password_hash)) {
      return res.status(401).json({ error: '이메일 또는 비밀번호가 올바르지 않습니다.' });
    }
    const token = signToken(user);
    res.json({
      token,
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/me  (requires Authorization: Bearer <token>)
app.get('/api/me', authRequired, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, email, name, role, created_at FROM ${USERS_TABLE} WHERE id = $1`,
      [req.user.sub]
    );
    if (!rows.length) return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- Admin API (super_admin / admin) ----------
const VALID_ROLES = ['user', 'admin', 'super_admin'];

// GET /api/admin/users — list all users + todo counts
app.get('/api/admin/users', authRequired, requireRole('super_admin', 'admin'), async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT u.id, u.email, u.name, u.role, u.created_at,
              COUNT(t.id)::int AS todo_count
       FROM ${USERS_TABLE} u
       LEFT JOIN ${TODOS_TABLE} t ON t.user_id = u.id
       GROUP BY u.id
       ORDER BY u.id ASC`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/admin/users/:id/role — super_admin only
app.patch('/api/admin/users/:id/role', authRequired, requireRole('super_admin'), async (req, res) => {
  const targetId = parseInt(req.params.id, 10);
  const { role } = req.body || {};
  if (!VALID_ROLES.includes(role)) {
    return res.status(400).json({ error: '유효하지 않은 역할입니다.' });
  }
  if (targetId === req.user.sub) {
    return res.status(400).json({ error: '본인의 역할은 변경할 수 없습니다.' });
  }
  try {
    const { rows } = await pool.query(
      `UPDATE ${USERS_TABLE} SET role = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING id, email, name, role`,
      [role, targetId]
    );
    if (!rows.length) return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/admin/users/:id — super_admin only
app.delete('/api/admin/users/:id', authRequired, requireRole('super_admin'), async (req, res) => {
  const targetId = parseInt(req.params.id, 10);
  if (targetId === req.user.sub) {
    return res.status(400).json({ error: '본인 계정은 삭제할 수 없습니다.' });
  }
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM ${USERS_TABLE} WHERE id = $1`,
      [targetId]
    );
    if (!rowCount) return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/todos — all todos with owner
app.get('/api/admin/todos', authRequired, requireRole('super_admin', 'admin'), async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT t.id, t.text, t.completed, t.created_at, t.user_id,
              u.email AS user_email, u.name AS user_name
       FROM ${TODOS_TABLE} t
       LEFT JOIN ${USERS_TABLE} u ON u.id = t.user_id
       ORDER BY t.created_at DESC`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/admin/todos/:id — super_admin or admin
app.delete('/api/admin/todos/:id', authRequired, requireRole('super_admin', 'admin'), async (req, res) => {
  const { id } = req.params;
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM ${TODOS_TABLE} WHERE id = $1`,
      [id]
    );
    if (!rowCount) return res.status(404).json({ error: '없는 항목입니다.' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- Local vs serverless ----------
if (require.main === module) {
  initDB()
    .then(() => {
      app.listen(PORT, () =>
        console.log(`🚀  http://localhost:${PORT}`)
      );
    })
    .catch((err) => {
      console.error('DB 초기화 실패:', err.message);
      process.exit(1);
    });
}

module.exports = app;
