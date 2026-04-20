const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3002;

app.use(express.json());
app.use(express.static(path.join(__dirname)));

// ── DB 초기화 ──────────────────────────────────────
const db = new Database(path.join(__dirname, 'todos.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE
  );

  CREATE TABLE IF NOT EXISTS todos (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    description TEXT DEFAULT '',
    done        INTEGER DEFAULT 0
  );
`);

// 시드: 유저가 없을 때만 초기 데이터 삽입
const userCount = db.prepare('SELECT COUNT(*) as cnt FROM users').get().cnt;
if (userCount === 0) {
  const insertUser = db.prepare('INSERT INTO users (name) VALUES (?)');
  const insertTodo = db.prepare('INSERT INTO todos (user_id, title, description, done) VALUES (?, ?, ?, ?)');

  const alice = insertUser.run('Alice').lastInsertRowid;
  const bob   = insertUser.run('Bob').lastInsertRowid;

  insertTodo.run(alice, '장보기',    '우유, 달걀, 빵 구매하기',    0);
  insertTodo.run(alice, '운동하기',  '30분 조깅',                  0);
  insertTodo.run(alice, '책 읽기',   '오늘의 챕터 완독',            0);
  insertTodo.run(bob,   '코드 공부', 'Node.js fs 모듈 실습',       0);
  insertTodo.run(bob,   '청소하기',  '방 정리 및 청소기 돌리기',    0);
}

// ── Users API ──────────────────────────────────────
// GET /api/users
app.get('/api/users', (req, res) => {
  try {
    const users = db.prepare('SELECT * FROM users ORDER BY id').all();
    res.json({ success: true, data: users });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// POST /api/users
app.post('/api/users', (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ success: false, message: 'name은 필수입니다.' });
    const result = db.prepare('INSERT INTO users (name) VALUES (?)').run(name.trim());
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json({ success: true, data: user });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ success: false, message: '이미 존재하는 유저입니다.' });
    res.status(500).json({ success: false, message: e.message });
  }
});

// ── Todos API ──────────────────────────────────────
// GET /api/todos?user_id=1
app.get('/api/todos', (req, res) => {
  try {
    const { user_id } = req.query;
    const todos = user_id
      ? db.prepare('SELECT * FROM todos WHERE user_id = ? ORDER BY id').all(Number(user_id))
      : db.prepare(`
          SELECT t.*, u.name as user_name
          FROM todos t JOIN users u ON t.user_id = u.id
          ORDER BY t.id
        `).all();
    res.json({ success: true, data: todos });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// GET /api/todos/:id
app.get('/api/todos/:id', (req, res) => {
  try {
    const todo = db.prepare('SELECT * FROM todos WHERE id = ?').get(Number(req.params.id));
    if (!todo) return res.status(404).json({ success: false, message: '해당 todo를 찾을 수 없습니다.' });
    res.json({ success: true, data: todo });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// POST /api/todos
app.post('/api/todos', (req, res) => {
  try {
    const { user_id, title, description = '' } = req.body;
    if (!user_id) return res.status(400).json({ success: false, message: 'user_id는 필수입니다.' });
    if (!title || !title.trim()) return res.status(400).json({ success: false, message: 'title은 필수입니다.' });
    const user = db.prepare('SELECT id FROM users WHERE id = ?').get(Number(user_id));
    if (!user) return res.status(404).json({ success: false, message: '해당 유저를 찾을 수 없습니다.' });
    const result = db.prepare('INSERT INTO todos (user_id, title, description, done) VALUES (?, ?, ?, 0)')
      .run(Number(user_id), title.trim(), description.trim());
    const todo = db.prepare('SELECT * FROM todos WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json({ success: true, data: todo });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// PATCH /api/todos/:id
app.patch('/api/todos/:id', (req, res) => {
  try {
    const todo = db.prepare('SELECT * FROM todos WHERE id = ?').get(Number(req.params.id));
    if (!todo) return res.status(404).json({ success: false, message: '해당 todo를 찾을 수 없습니다.' });
    const title       = req.body.title       !== undefined ? req.body.title       : todo.title;
    const description = req.body.description !== undefined ? req.body.description : todo.description;
    const done        = req.body.done        !== undefined ? (req.body.done ? 1 : 0) : todo.done;
    db.prepare('UPDATE todos SET title=?, description=?, done=? WHERE id=?')
      .run(title, description, done, Number(req.params.id));
    const updated = db.prepare('SELECT * FROM todos WHERE id = ?').get(Number(req.params.id));
    res.json({ success: true, data: updated });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// DELETE /api/todos/:id
app.delete('/api/todos/:id', (req, res) => {
  try {
    const todo = db.prepare('SELECT * FROM todos WHERE id = ?').get(Number(req.params.id));
    if (!todo) return res.status(404).json({ success: false, message: '해당 todo를 찾을 수 없습니다.' });
    db.prepare('DELETE FROM todos WHERE id = ?').run(Number(req.params.id));
    res.json({ success: true, message: `todo ${req.params.id} 삭제 완료` });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

app.get('/{*splat}', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

if (require.main === module) {
  app.listen(PORT, () => console.log(`서버 실행 중: http://localhost:${PORT}`));
}
module.exports = app;
