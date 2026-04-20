const http = require('http');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const url = require('url');

const PORT = 4000;
const DB_PATH = path.join(__dirname, 'todos.db');

// ─── DB 초기화 ────────────────────────────────────────────────────────────────
const db = new Database(DB_PATH);

// 기존 스키마 마이그레이션: users 테이블 없거나 todos에 user_id 컬럼 없으면 재생성
const hasUsers = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'").get();
const todoCols = db.prepare("PRAGMA table_info(todos)").all().map(c => c.name);
const needsMigration = !hasUsers || !todoCols.includes('user_id');

if (needsMigration) {
  console.log('스키마 마이그레이션 실행 중...');
  db.exec('DROP TABLE IF EXISTS todos;');
  db.exec('DROP TABLE IF EXISTS users;');
}

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id    INTEGER PRIMARY KEY AUTOINCREMENT,
    name  TEXT    NOT NULL,
    email TEXT    UNIQUE NOT NULL
  );

  CREATE TABLE IF NOT EXISTS todos (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    task    TEXT    NOT NULL,
    done    INTEGER NOT NULL DEFAULT 0,
    user_id INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
`);

// 첫 실행 시 시드 데이터 삽입
const userCount = db.prepare('SELECT COUNT(*) AS cnt FROM users').get().cnt;
if (userCount === 0) {
  const addUser = db.prepare('INSERT INTO users (name, email) VALUES (?, ?)');
  const addTodo = db.prepare('INSERT INTO todos (task, done, user_id) VALUES (?, ?, ?)');

  const alice = addUser.run('홍길동', 'hong@example.com');
  const bob   = addUser.run('김철수', 'kim@example.com');
  const carol = addUser.run('이영희', 'lee@example.com');

  addTodo.run('장보기 - 우유, 계란, 빵 구매하기', 0, alice.lastInsertRowid);
  addTodo.run('운동하기 - 30분 달리기',           1, alice.lastInsertRowid);
  addTodo.run('코드 리뷰 완료하기',               0, alice.lastInsertRowid);
  addTodo.run('독서 - 책 50페이지 읽기',          0, bob.lastInsertRowid);
  addTodo.run('이메일 답장 보내기',               1, bob.lastInsertRowid);
  addTodo.run('회의 준비하기',                    0, bob.lastInsertRowid);
  addTodo.run('청소하기',                         0, carol.lastInsertRowid);
  addTodo.run('요리 연습',                        1, carol.lastInsertRowid);

  console.log('시드 데이터 삽입 완료');
}

// ─── 헬퍼 ────────────────────────────────────────────────────────────────────
function sendJSON(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => (body += chunk));
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch (e) { reject(e); }
    });
  });
}

// ─── 라우터 ──────────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const parsed   = url.parse(req.url, true);
  const pathname = parsed.pathname;
  const query    = parsed.query;

  // CORS preflight
  if (req.method === 'OPTIONS') {
    sendJSON(res, 204, {});
    return;
  }

  // ── 정적 파일 ──────────────────────────────────────────────────────────────
  if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
    const file = path.join(__dirname, 'index.html');
    fs.readFile(file, (err, data) => {
      if (err) { sendJSON(res, 404, { error: 'index.html not found' }); return; }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(data);
    });
    return;
  }

  // ── GET /api/users ─────────────────────────────────────────────────────────
  if (req.method === 'GET' && pathname === '/api/users') {
    const users = db.prepare(`
      SELECT u.*, COUNT(t.id) AS todo_count
      FROM users u
      LEFT JOIN todos t ON t.user_id = u.id
      GROUP BY u.id
    `).all();
    sendJSON(res, 200, users);
    return;
  }

  // ── POST /api/users ────────────────────────────────────────────────────────
  if (req.method === 'POST' && pathname === '/api/users') {
    try {
      const { name, email } = await readBody(req);
      if (!name || !email) {
        sendJSON(res, 400, { error: 'name, email 필드가 필요합니다.' });
        return;
      }
      const result = db.prepare('INSERT INTO users (name, email) VALUES (?, ?)').run(name, email);
      const user   = db.prepare('SELECT *, 0 AS todo_count FROM users WHERE id = ?').get(result.lastInsertRowid);
      sendJSON(res, 201, user);
    } catch (e) {
      if (e.message && e.message.includes('UNIQUE')) {
        sendJSON(res, 409, { error: '이미 사용 중인 이메일입니다.' });
      } else {
        sendJSON(res, 400, { error: '잘못된 요청입니다.' });
      }
    }
    return;
  }

  // ── DELETE /api/users/:id ──────────────────────────────────────────────────
  const deleteUserMatch = pathname.match(/^\/api\/users\/(\d+)$/);
  if (req.method === 'DELETE' && deleteUserMatch) {
    const id = Number(deleteUserMatch[1]);
    const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!existing) { sendJSON(res, 404, { error: '해당 유저를 찾을 수 없습니다.' }); return; }
    db.prepare('DELETE FROM users WHERE id = ?').run(id); // todos는 CASCADE로 자동 삭제
    sendJSON(res, 200, { message: '삭제되었습니다.', id });
    return;
  }

  // ── GET /api/todos  (전체 or ?user_id=N) ──────────────────────────────────
  if (req.method === 'GET' && pathname === '/api/todos') {
    let todos;
    if (query.user_id) {
      todos = db.prepare(`
        SELECT t.*, u.name AS user_name
        FROM todos t JOIN users u ON u.id = t.user_id
        WHERE t.user_id = ?
        ORDER BY t.id
      `).all(Number(query.user_id));
    } else {
      todos = db.prepare(`
        SELECT t.*, u.name AS user_name
        FROM todos t JOIN users u ON u.id = t.user_id
        ORDER BY t.id
      `).all();
    }
    sendJSON(res, 200, todos);
    return;
  }

  // ── POST /api/todos ────────────────────────────────────────────────────────
  if (req.method === 'POST' && pathname === '/api/todos') {
    try {
      const { task, user_id } = await readBody(req);
      if (!task || !user_id) {
        sendJSON(res, 400, { error: 'task, user_id 필드가 필요합니다.' });
        return;
      }
      const result = db.prepare('INSERT INTO todos (task, done, user_id) VALUES (?, 0, ?)').run(task, user_id);
      const todo   = db.prepare(`
        SELECT t.*, u.name AS user_name
        FROM todos t JOIN users u ON u.id = t.user_id
        WHERE t.id = ?
      `).get(result.lastInsertRowid);
      sendJSON(res, 201, todo);
    } catch (e) {
      sendJSON(res, 400, { error: '잘못된 요청입니다.' });
    }
    return;
  }

  // ── PATCH /api/todos/:id ───────────────────────────────────────────────────
  const patchMatch = pathname.match(/^\/api\/todos\/(\d+)$/);
  if (req.method === 'PATCH' && patchMatch) {
    const id = Number(patchMatch[1]);
    try {
      const body = await readBody(req);
      const existing = db.prepare('SELECT * FROM todos WHERE id = ?').get(id);
      if (!existing) { sendJSON(res, 404, { error: '해당 todo를 찾을 수 없습니다.' }); return; }

      const task = body.task ?? existing.task;
      const done = body.done !== undefined ? (body.done ? 1 : 0) : existing.done;
      db.prepare('UPDATE todos SET task = ?, done = ? WHERE id = ?').run(task, done, id);

      const updated = db.prepare(`
        SELECT t.*, u.name AS user_name
        FROM todos t JOIN users u ON u.id = t.user_id
        WHERE t.id = ?
      `).get(id);
      sendJSON(res, 200, updated);
    } catch (e) {
      sendJSON(res, 400, { error: '잘못된 요청입니다.' });
    }
    return;
  }

  // ── DELETE /api/todos/:id ──────────────────────────────────────────────────
  const deleteMatch = pathname.match(/^\/api\/todos\/(\d+)$/);
  if (req.method === 'DELETE' && deleteMatch) {
    const id = Number(deleteMatch[1]);
    const existing = db.prepare('SELECT * FROM todos WHERE id = ?').get(id);
    if (!existing) { sendJSON(res, 404, { error: '해당 todo를 찾을 수 없습니다.' }); return; }
    db.prepare('DELETE FROM todos WHERE id = ?').run(id);
    sendJSON(res, 200, { message: '삭제되었습니다.', id });
    return;
  }

  // 404
  sendJSON(res, 404, { error: '존재하지 않는 경로입니다.' });
});

server.listen(PORT, () => {
  console.log(`서버 실행 중: http://localhost:${PORT}`);
  console.log(`DB 파일: ${DB_PATH}`);
});
