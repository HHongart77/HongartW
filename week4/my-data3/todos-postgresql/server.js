const express = require('express');
const { Pool } = require('pg');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3003;

app.use(express.json());
app.use(express.static(path.join(__dirname)));

// ── DB 연결 ────────────────────────────────────────
const pool = new Pool({
  connectionString: (process.env.DATABASE_URL || '').trim(),
  ssl: { rejectUnauthorized: false },
});

// ── DB 초기화 (Lazy Init) ──────────────────────────
let dbInitialized = false;
async function initDB() {
  if (dbInitialized) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id   SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE
    );

    CREATE TABLE IF NOT EXISTS todos (
      id          SERIAL PRIMARY KEY,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title       TEXT NOT NULL,
      description TEXT DEFAULT '',
      done        BOOLEAN DEFAULT FALSE
    );
  `);

  // 시드: 유저가 없을 때만 초기 데이터 삽입
  const { rows } = await pool.query('SELECT COUNT(*) as cnt FROM users');
  if (parseInt(rows[0].cnt) === 0) {
    const alice = await pool.query('INSERT INTO users (name) VALUES ($1) RETURNING id', ['Alice']);
    const bob   = await pool.query('INSERT INTO users (name) VALUES ($1) RETURNING id', ['Bob']);
    const charlie = await pool.query('INSERT INTO users (name) VALUES ($1) RETURNING id', ['Charlie']);
    const aliceId = alice.rows[0].id;
    const bobId   = bob.rows[0].id;
    const charlieId = charlie.rows[0].id;

    await pool.query(
      'INSERT INTO todos (user_id, title, description) VALUES ($1,$2,$3),($4,$5,$6),($7,$8,$9),($10,$11,$12),($13,$14,$15),($16,$17,$18),($19,$20,$21)',
      [
        aliceId,   '장보기',     '우유, 달걀, 빵 구매하기',
        aliceId,   '운동하기',   '30분 조깅',
        aliceId,   '책 읽기',    '오늘의 챕터 완독',
        bobId,     '코드 공부',  'Node.js fs 모듈 실습',
        bobId,     '청소하기',   '방 정리 및 청소기 돌리기',
        charlieId, '이메일 확인', '받은 메일함 정리하기',
        charlieId, '회의 준비',  '발표 자료 만들기',
      ]
    );
  }
  dbInitialized = true;
}

app.use('/api', async (_req, res, next) => {
  try { await initDB(); next(); }
  catch (e) { res.status(500).json({ success: false, message: 'DB 초기화 실패: ' + e.message }); }
});

// ── Users API ──────────────────────────────────────
app.get('/api/users', async (_req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM users ORDER BY id');
    res.json({ success: true, data: rows });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.post('/api/users', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name?.trim()) return res.status(400).json({ success: false, message: 'name은 필수입니다.' });
    const { rows } = await pool.query('INSERT INTO users (name) VALUES ($1) RETURNING *', [name.trim()]);
    res.status(201).json({ success: true, data: rows[0] });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ success: false, message: '이미 존재하는 유저입니다.' });
    res.status(500).json({ success: false, message: e.message });
  }
});

app.delete('/api/users/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT id FROM users WHERE id = $1', [Number(req.params.id)]);
    if (!rows.length) return res.status(404).json({ success: false, message: '해당 유저를 찾을 수 없습니다.' });
    await pool.query('DELETE FROM users WHERE id = $1', [Number(req.params.id)]);
    res.json({ success: true, message: `user ${req.params.id} 삭제 완료` });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// ── Todos API ──────────────────────────────────────
app.get('/api/todos', async (req, res) => {
  try {
    const { user_id } = req.query;
    const { rows } = user_id
      ? await pool.query('SELECT * FROM todos WHERE user_id = $1 ORDER BY id', [Number(user_id)])
      : await pool.query(`
          SELECT t.*, u.name as user_name
          FROM todos t JOIN users u ON t.user_id = u.id
          ORDER BY t.id
        `);
    res.json({ success: true, data: rows });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.post('/api/todos', async (req, res) => {
  try {
    const { user_id, title, description = '' } = req.body;
    if (!user_id) return res.status(400).json({ success: false, message: 'user_id는 필수입니다.' });
    if (!title?.trim()) return res.status(400).json({ success: false, message: 'title은 필수입니다.' });
    const { rows } = await pool.query(
      'INSERT INTO todos (user_id, title, description) VALUES ($1, $2, $3) RETURNING *',
      [Number(user_id), title.trim(), description.trim()]
    );
    res.status(201).json({ success: true, data: rows[0] });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.patch('/api/todos/:id', async (req, res) => {
  try {
    const { rows: existing } = await pool.query('SELECT * FROM todos WHERE id = $1', [Number(req.params.id)]);
    if (!existing.length) return res.status(404).json({ success: false, message: '해당 todo를 찾을 수 없습니다.' });
    const todo = existing[0];
    const title       = req.body.title       !== undefined ? req.body.title       : todo.title;
    const description = req.body.description !== undefined ? req.body.description : todo.description;
    const done        = req.body.done        !== undefined ? req.body.done        : todo.done;
    const { rows } = await pool.query(
      'UPDATE todos SET title=$1, description=$2, done=$3 WHERE id=$4 RETURNING *',
      [title, description, done, Number(req.params.id)]
    );
    res.json({ success: true, data: rows[0] });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.delete('/api/todos/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT id FROM todos WHERE id = $1', [Number(req.params.id)]);
    if (!rows.length) return res.status(404).json({ success: false, message: '해당 todo를 찾을 수 없습니다.' });
    await pool.query('DELETE FROM todos WHERE id = $1', [Number(req.params.id)]);
    res.json({ success: true, message: `todo ${req.params.id} 삭제 완료` });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.get('/{*splat}', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

if (require.main === module) {
  app.listen(PORT, () => console.log(`서버 실행 중: http://localhost:${PORT}`));
}
module.exports = app;
