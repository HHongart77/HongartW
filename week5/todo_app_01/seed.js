const { Pool } = require('pg');
const crypto = require('crypto');

const FALLBACK_DB_URL =
  'postgresql://postgres.wdohgoccwlrkroaxkuue:VY3el1bEQOf7Fgf7@aws-1-us-east-1.pooler.supabase.com:6543/postgres';

const pool = new Pool({
  connectionString: (process.env.DATABASE_URL || FALLBACK_DB_URL).trim(),
  ssl: { rejectUnauthorized: false },
});

const PREFIX = 'todo_app_01';
const T_USERS = `${PREFIX}_users`;
const T_TODOS = `${PREFIX}_todos`;
const T_SESSIONS = `${PREFIX}_sessions`;

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

async function migrate() {
  // users: name, updated_at
  await pool.query(`ALTER TABLE ${T_USERS} ADD COLUMN IF NOT EXISTS name TEXT`);
  await pool.query(
    `ALTER TABLE ${T_USERS} ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
  );

  // todos: user_id (nullable for now), updated_at
  await pool.query(
    `ALTER TABLE ${T_TODOS} ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES ${T_USERS}(id) ON DELETE CASCADE`
  );
  await pool.query(
    `ALTER TABLE ${T_TODOS} ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_${PREFIX}_todos_user_id ON ${T_TODOS}(user_id)`
  );

  // sessions
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${T_SESSIONS} (
      token       TEXT        PRIMARY KEY,
      user_id     INTEGER     NOT NULL REFERENCES ${T_USERS}(id) ON DELETE CASCADE,
      expires_at  TIMESTAMPTZ NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_${PREFIX}_sessions_user_id ON ${T_SESSIONS}(user_id)`
  );

  console.log('✓ Migration applied');
}

async function seed() {
  // Super admin id (rada12@naver.com already seeded by server.js)
  const { rows: adminRows } = await pool.query(
    `SELECT id FROM ${T_USERS} WHERE email = $1`,
    ['rada12@naver.com']
  );
  const adminId = adminRows[0]?.id;
  if (!adminId) throw new Error('Super admin not found. Run server.js once first.');

  // Backfill orphan todos to super admin
  const { rowCount: backfilled } = await pool.query(
    `UPDATE ${T_TODOS} SET user_id = $1 WHERE user_id IS NULL`,
    [adminId]
  );
  if (backfilled > 0) console.log(`✓ Backfilled ${backfilled} orphan todo(s) → super_admin`);

  // Demo users
  const demoUsers = [
    { email: 'alice@example.com', password: 'alice1234', name: '앨리스', role: 'user' },
    { email: 'bob@example.com', password: 'bob1234', name: '밥', role: 'user' },
  ];
  const userIds = {};
  for (const u of demoUsers) {
    await pool.query(
      `INSERT INTO ${T_USERS} (email, password_hash, name, role)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO UPDATE
         SET name = EXCLUDED.name,
             role = EXCLUDED.role,
             password_hash = EXCLUDED.password_hash,
             updated_at = NOW()`,
      [u.email, hashPassword(u.password), u.name, u.role]
    );
    const { rows } = await pool.query(
      `SELECT id FROM ${T_USERS} WHERE email = $1`,
      [u.email]
    );
    userIds[u.email] = rows[0].id;
    console.log(`✓ User upserted: ${u.email} (id=${userIds[u.email]}, role=${u.role})`);
  }

  // Reset demo todos (idempotent re-run) — only clears demo users' todos, leaves super admin's data alone
  await pool.query(
    `DELETE FROM ${T_TODOS} WHERE user_id = ANY($1::int[])`,
    [[userIds['alice@example.com'], userIds['bob@example.com']]]
  );

  // Insert demo todos
  const todos = [
    [userIds['alice@example.com'], '장보기 - 우유, 빵, 달걀', false],
    [userIds['alice@example.com'], '저녁 운동 30분', false],
    [userIds['alice@example.com'], '이메일 정리', true],
    [userIds['bob@example.com'], '월요일 회의 자료 준비', false],
    [userIds['bob@example.com'], '책 1챕터 읽기', false],
    [userIds['bob@example.com'], '치과 예약 확인', true],
  ];
  for (const [user_id, text, completed] of todos) {
    await pool.query(
      `INSERT INTO ${T_TODOS} (user_id, text, completed) VALUES ($1, $2, $3)`,
      [user_id, text, completed]
    );
  }
  console.log(`✓ Seeded ${todos.length} demo todos`);
}

(async () => {
  try {
    await migrate();
    await seed();
    console.log('✅ Done');
  } catch (err) {
    console.error('❌ Seed failed:', err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
