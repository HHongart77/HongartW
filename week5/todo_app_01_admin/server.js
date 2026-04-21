// ============================================================================
// todo_app_01_admin / server.js
// Node.js + Express + Postgres(Supabase) admin backend for todo_app_01
// ============================================================================

const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

// ---------------------------------------------------------------------------
// App init & config
// ---------------------------------------------------------------------------
const app = express();
const PORT = process.env.PORT || 3000;

const FALLBACK_DB_URL =
  'postgresql://postgres.wdohgoccwlrkroaxkuue:VY3el1bEQOf7Fgf7@aws-1-us-east-1.pooler.supabase.com:6543/postgres';

const DATABASE_URL = (process.env.DATABASE_URL || FALLBACK_DB_URL).trim();
const JWT_SECRET = (process.env.JWT_SECRET || 'dev-only-secret-change-me-in-prod').trim();
const JWT_EXPIRES_IN = '7d';

// Shared table prefix with todo_app_01
const T_USERS = 'todo_app_01_users';
const T_TODOS = 'todo_app_01_todos';

// Seed super admin
const SEED_SUPER_ADMIN = {
  email: 'rada12@naver.com',
  password: 'Skstoa77!@#$',
  name: '슈퍼관리자',
  role: 'super_admin',
};

// ---------------------------------------------------------------------------
// DB pool (lazy init safe)
// ---------------------------------------------------------------------------
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

let dbInitialized = false;
async function initDB() {
  if (dbInitialized) return;

  // users
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${T_USERS} (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT,
      role TEXT NOT NULL DEFAULT 'user',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  // idempotent column additions (for older installs)
  await pool.query(`ALTER TABLE ${T_USERS} ADD COLUMN IF NOT EXISTS name TEXT;`);
  await pool.query(`ALTER TABLE ${T_USERS} ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user';`);
  await pool.query(`ALTER TABLE ${T_USERS} ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();`);
  await pool.query(`ALTER TABLE ${T_USERS} ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();`);

  // todos (base + extensions)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${T_TODOS} (
      id SERIAL PRIMARY KEY,
      text TEXT NOT NULL,
      completed BOOLEAN NOT NULL DEFAULT FALSE,
      user_id INTEGER REFERENCES ${T_USERS}(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`ALTER TABLE ${T_TODOS} ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES ${T_USERS}(id) ON DELETE CASCADE;`);
  await pool.query(`ALTER TABLE ${T_TODOS} ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();`);
  await pool.query(`ALTER TABLE ${T_TODOS} ADD COLUMN IF NOT EXISTS description TEXT;`);
  await pool.query(`ALTER TABLE ${T_TODOS} ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'medium';`);
  await pool.query(`ALTER TABLE ${T_TODOS} ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending';`);
  await pool.query(`ALTER TABLE ${T_TODOS} ADD COLUMN IF NOT EXISTS due_date DATE;`);

  // Seed super admin if missing
  const existing = await pool.query(
    `SELECT id FROM ${T_USERS} WHERE email = $1`,
    [SEED_SUPER_ADMIN.email]
  );
  if (existing.rowCount === 0) {
    const password_hash = hashPassword(SEED_SUPER_ADMIN.password);
    await pool.query(
      `INSERT INTO ${T_USERS} (email, password_hash, name, role)
       VALUES ($1, $2, $3, $4)`,
      [SEED_SUPER_ADMIN.email, password_hash, SEED_SUPER_ADMIN.name, SEED_SUPER_ADMIN.role]
    );
    console.log(`✓ Seeded super_admin: ${SEED_SUPER_ADMIN.email}`);
  }

  dbInitialized = true;
  console.log(`✓ DB ready: ${T_USERS}, ${T_TODOS}`);
}

// ---------------------------------------------------------------------------
// Password hashing (scrypt, "salt:hash" hex format)
// ---------------------------------------------------------------------------
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored || typeof stored !== 'string' || !stored.includes(':')) return false;
  const [salt, hashHex] = stored.split(':');
  const hashBuf = Buffer.from(hashHex, 'hex');
  const check = crypto.scryptSync(password, salt, 64);
  if (check.length !== hashBuf.length) return false;
  return crypto.timingSafeEqual(check, hashBuf);
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Lazy init DB for all /api routes
app.use('/api', async (_req, res, next) => {
  try {
    await initDB();
    next();
  } catch (err) {
    console.error('initDB failed:', err);
    res.status(500).json({ error: 'Database initialization failed' });
  }
});

function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload; // { id, email, role }
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function requireRole(...allowed) {
  return (req, res, next) => {
    if (!req.user || !allowed.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const VALID_PRIORITIES = ['low', 'medium', 'high', 'urgent'];
const VALID_STATUSES = ['pending', 'in_progress', 'done'];
const VALID_ROLES = ['user', 'admin', 'super_admin'];

// SELECT list for todo responses (with user JOIN)
const TODO_SELECT = `
  t.id,
  t.text AS title,
  t.description,
  t.priority,
  t.status,
  t.due_date,
  t.completed,
  t.user_id,
  u.email AS user_email,
  u.name  AS user_name,
  t.created_at,
  t.updated_at
`;

async function fetchTodoById(id) {
  const { rows } = await pool.query(
    `SELECT ${TODO_SELECT}
     FROM ${T_TODOS} t
     LEFT JOIN ${T_USERS} u ON u.id = t.user_id
     WHERE t.id = $1`,
    [id]
  );
  return rows[0] || null;
}

// ---------------------------------------------------------------------------
// Auth routes
// ---------------------------------------------------------------------------
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'email and password are required' });
    }
    const { rows } = await pool.query(
      `SELECT id, email, password_hash, name, role FROM ${T_USERS} WHERE email = $1`,
      [email]
    );
    const user = rows[0];
    if (!user || !verifyPassword(password, user.password_hash)) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );
    res.json({
      token,
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    });
  } catch (err) {
    console.error('POST /api/login', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

app.get('/api/me', authRequired, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, email, name, role, created_at FROM ${T_USERS} WHERE id = $1`,
      [req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'User not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('GET /api/me', err);
    res.status(500).json({ error: 'Failed to load user' });
  }
});

// ---------------------------------------------------------------------------
// Admin Todos
// ---------------------------------------------------------------------------
const adminGuard = [authRequired, requireRole('super_admin', 'admin')];

app.get('/api/admin/todos', adminGuard, async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT ${TODO_SELECT}
       FROM ${T_TODOS} t
       LEFT JOIN ${T_USERS} u ON u.id = t.user_id
       ORDER BY t.created_at DESC`
    );
    res.json(rows);
  } catch (err) {
    console.error('GET /api/admin/todos', err);
    res.status(500).json({ error: 'Failed to list todos' });
  }
});

app.post('/api/admin/todos', adminGuard, async (req, res) => {
  try {
    const {
      title,
      description = null,
      priority = 'medium',
      status = 'pending',
      due_date = null,
      user_id = null,
    } = req.body || {};

    if (!title || typeof title !== 'string' || !title.trim()) {
      return res.status(400).json({ error: 'title is required' });
    }
    if (!VALID_PRIORITIES.includes(priority)) {
      return res.status(400).json({ error: 'invalid priority' });
    }
    if (!VALID_STATUSES.includes(status)) {
      return res.status(400).json({ error: 'invalid status' });
    }

    const completed = status === 'done';

    const { rows } = await pool.query(
      `INSERT INTO ${T_TODOS}
         (text, description, priority, status, due_date, completed, user_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
       RETURNING id`,
      [title.trim(), description, priority, status, due_date, completed, user_id]
    );
    const todo = await fetchTodoById(rows[0].id);
    res.status(201).json(todo);
  } catch (err) {
    console.error('POST /api/admin/todos', err);
    res.status(500).json({ error: 'Failed to create todo' });
  }
});

app.patch('/api/admin/todos/:id', adminGuard, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid id' });

    const existing = await fetchTodoById(id);
    if (!existing) return res.status(404).json({ error: 'Todo not found' });

    const {
      title,
      description,
      priority,
      status,
      due_date,
      user_id,
    } = req.body || {};

    const sets = [];
    const vals = [];
    let p = 1;

    if (title !== undefined) {
      if (typeof title !== 'string' || !title.trim()) {
        return res.status(400).json({ error: 'invalid title' });
      }
      sets.push(`text = $${p++}`);
      vals.push(title.trim());
    }
    if (description !== undefined) {
      sets.push(`description = $${p++}`);
      vals.push(description);
    }
    if (priority !== undefined) {
      if (!VALID_PRIORITIES.includes(priority)) {
        return res.status(400).json({ error: 'invalid priority' });
      }
      sets.push(`priority = $${p++}`);
      vals.push(priority);
    }
    if (status !== undefined) {
      if (!VALID_STATUSES.includes(status)) {
        return res.status(400).json({ error: 'invalid status' });
      }
      sets.push(`status = $${p++}`);
      vals.push(status);
      sets.push(`completed = $${p++}`);
      vals.push(status === 'done');
    }
    if (due_date !== undefined) {
      sets.push(`due_date = $${p++}`);
      vals.push(due_date);
    }
    if (user_id !== undefined) {
      sets.push(`user_id = $${p++}`);
      vals.push(user_id);
    }

    if (sets.length === 0) {
      return res.json(existing);
    }

    sets.push(`updated_at = NOW()`);
    vals.push(id);

    await pool.query(
      `UPDATE ${T_TODOS} SET ${sets.join(', ')} WHERE id = $${p}`,
      vals
    );
    const updated = await fetchTodoById(id);
    res.json(updated);
  } catch (err) {
    console.error('PATCH /api/admin/todos/:id', err);
    res.status(500).json({ error: 'Failed to update todo' });
  }
});

app.delete('/api/admin/todos/:id', adminGuard, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid id' });
    const r = await pool.query(`DELETE FROM ${T_TODOS} WHERE id = $1`, [id]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'Todo not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/admin/todos/:id', err);
    res.status(500).json({ error: 'Failed to delete todo' });
  }
});

app.post('/api/admin/todos/bulk-delete', adminGuard, async (req, res) => {
  try {
    const { ids } = req.body || {};
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids must be a non-empty array' });
    }
    const cleanIds = ids.map(Number).filter(Number.isInteger);
    if (cleanIds.length === 0) {
      return res.status(400).json({ error: 'no valid ids' });
    }
    const r = await pool.query(
      `DELETE FROM ${T_TODOS} WHERE id = ANY($1::int[])`,
      [cleanIds]
    );
    res.json({ ok: true, deleted: r.rowCount });
  } catch (err) {
    console.error('POST /api/admin/todos/bulk-delete', err);
    res.status(500).json({ error: 'Failed to bulk delete' });
  }
});

// ---------------------------------------------------------------------------
// Admin Stats
// ---------------------------------------------------------------------------
app.get('/api/admin/stats', adminGuard, async (_req, res) => {
  try {
    const totals = await pool.query(`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status = 'done')::int AS completed,
        COUNT(*) FILTER (WHERE status = 'in_progress')::int AS "inProgress",
        COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
        COUNT(*) FILTER (WHERE priority = 'urgent' AND status <> 'done')::int AS urgent
      FROM ${T_TODOS}
    `);

    const userCountRes = await pool.query(`SELECT COUNT(*)::int AS c FROM ${T_USERS}`);

    const upcoming = await pool.query(`
      SELECT t.id, t.text AS title, t.due_date, u.name AS user_name, t.priority, t.status
      FROM ${T_TODOS} t
      LEFT JOIN ${T_USERS} u ON u.id = t.user_id
      WHERE t.status <> 'done' AND t.due_date IS NOT NULL
      ORDER BY t.due_date ASC
      LIMIT 5
    `);

    const row = totals.rows[0] || {};
    res.json({
      total: row.total || 0,
      completed: row.completed || 0,
      inProgress: row.inProgress || 0,
      pending: row.pending || 0,
      urgent: row.urgent || 0,
      userCount: userCountRes.rows[0]?.c || 0,
      upcomingDeadlines: upcoming.rows,
    });
  } catch (err) {
    console.error('GET /api/admin/stats', err);
    res.status(500).json({ error: 'Failed to load stats' });
  }
});

// ---------------------------------------------------------------------------
// Admin Users
// ---------------------------------------------------------------------------
app.get('/api/admin/users', adminGuard, async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT u.id, u.email, u.name, u.role, u.created_at,
             COALESCE(COUNT(t.id), 0)::int AS todo_count
      FROM ${T_USERS} u
      LEFT JOIN ${T_TODOS} t ON t.user_id = u.id
      GROUP BY u.id
      ORDER BY u.created_at ASC
    `);
    res.json(rows);
  } catch (err) {
    console.error('GET /api/admin/users', err);
    res.status(500).json({ error: 'Failed to list users' });
  }
});

app.patch(
  '/api/admin/users/:id',
  authRequired,
  requireRole('super_admin'),
  async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid id' });

      const { name, role } = req.body || {};

      if (role !== undefined) {
        if (!VALID_ROLES.includes(role)) {
          return res.status(400).json({ error: 'invalid role' });
        }
        if (id === req.user.id) {
          return res.status(400).json({ error: 'cannot change your own role' });
        }
      }

      const sets = [];
      const vals = [];
      let p = 1;
      if (name !== undefined) {
        sets.push(`name = $${p++}`);
        vals.push(name);
      }
      if (role !== undefined) {
        sets.push(`role = $${p++}`);
        vals.push(role);
      }
      if (sets.length === 0) {
        const { rows } = await pool.query(
          `SELECT id, email, name, role, created_at FROM ${T_USERS} WHERE id = $1`,
          [id]
        );
        if (!rows[0]) return res.status(404).json({ error: 'User not found' });
        return res.json(rows[0]);
      }

      sets.push(`updated_at = NOW()`);
      vals.push(id);

      const { rows, rowCount } = await pool.query(
        `UPDATE ${T_USERS} SET ${sets.join(', ')} WHERE id = $${p}
         RETURNING id, email, name, role, created_at`,
        vals
      );
      if (rowCount === 0) return res.status(404).json({ error: 'User not found' });
      res.json(rows[0]);
    } catch (err) {
      console.error('PATCH /api/admin/users/:id', err);
      res.status(500).json({ error: 'Failed to update user' });
    }
  }
);

app.delete(
  '/api/admin/users/:id',
  authRequired,
  requireRole('super_admin'),
  async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid id' });
      if (id === req.user.id) {
        return res.status(400).json({ error: 'cannot delete yourself' });
      }
      const r = await pool.query(`DELETE FROM ${T_USERS} WHERE id = $1`, [id]);
      if (r.rowCount === 0) return res.status(404).json({ error: 'User not found' });
      res.json({ ok: true });
    } catch (err) {
      console.error('DELETE /api/admin/users/:id', err);
      res.status(500).json({ error: 'Failed to delete user' });
    }
  }
);

// ---------------------------------------------------------------------------
// 404 & error handlers
// ---------------------------------------------------------------------------
app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.use((err, _req, res, _next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ---------------------------------------------------------------------------
// Startup (local) / export (serverless)
// ---------------------------------------------------------------------------
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`🚀 http://localhost:${PORT}`);
  });
}

module.exports = app;
