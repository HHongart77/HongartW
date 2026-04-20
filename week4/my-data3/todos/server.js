const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const TODOS_DIR = __dirname;

// ── 유틸 ──────────────────────────────────────────
function getTodoFiles() {
  return fs.readdirSync(TODOS_DIR).filter(f => /^todo\d+$/.test(f));
}

function getNextId() {
  const files = getTodoFiles();
  if (files.length === 0) return 1;
  const ids = files.map(f => parseInt(f.replace('todo', ''), 10));
  return Math.max(...ids) + 1;
}

function readAllTodos() {
  return getTodoFiles().map(filename => {
    const id = parseInt(filename.replace('todo', ''), 10);
    const text = fs.readFileSync(path.join(TODOS_DIR, filename), 'utf-8').trim();
    return { id, text };
  }).sort((a, b) => a.id - b.id);
}

function send(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

function sendFile(res, filepath) {
  const ext = path.extname(filepath);
  const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css' };
  fs.readFile(filepath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not Found'); return; }
    res.writeHead(200, { 'Content-Type': mime[ext] || 'text/plain' });
    res.end(data);
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try { resolve(JSON.parse(body || '{}')); }
      catch { reject(new Error('Invalid JSON')); }
    });
  });
}

// ── 서버 ──────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const { method, url } = req;

  // 정적 파일
  if (url === '/' || url === '/index.html') {
    return sendFile(res, path.join(TODOS_DIR, 'index.html'));
  }

  // GET /api/todos
  if (method === 'GET' && url === '/api/todos') {
    const todos = readAllTodos();
    return send(res, 200, { success: true, data: todos });
  }

  // POST /api/todos
  if (method === 'POST' && url === '/api/todos') {
    try {
      const { text } = await readBody(req);
      if (!text || !text.trim()) return send(res, 400, { success: false, message: 'text는 필수입니다.' });
      const id = getNextId();
      fs.writeFileSync(path.join(TODOS_DIR, `todo${id}`), text.trim(), 'utf-8');
      return send(res, 201, { success: true, data: { id, text: text.trim() } });
    } catch (e) {
      return send(res, 400, { success: false, message: e.message });
    }
  }

  // PUT /api/todos/:id
  const putMatch = url.match(/^\/api\/todos\/(\d+)$/);
  if (method === 'PUT' && putMatch) {
    const id = parseInt(putMatch[1], 10);
    const filepath = path.join(TODOS_DIR, `todo${id}`);
    if (!fs.existsSync(filepath)) return send(res, 404, { success: false, message: '해당 todo를 찾을 수 없습니다.' });
    try {
      const { text } = await readBody(req);
      if (!text || !text.trim()) return send(res, 400, { success: false, message: 'text는 필수입니다.' });
      fs.writeFileSync(filepath, text.trim(), 'utf-8');
      return send(res, 200, { success: true, data: { id, text: text.trim() } });
    } catch (e) {
      return send(res, 400, { success: false, message: e.message });
    }
  }

  // DELETE /api/todos/:id
  const deleteMatch = url.match(/^\/api\/todos\/(\d+)$/);
  if (method === 'DELETE' && deleteMatch) {
    const id = parseInt(deleteMatch[1], 10);
    const filepath = path.join(TODOS_DIR, `todo${id}`);
    if (!fs.existsSync(filepath)) return send(res, 404, { success: false, message: '해당 todo를 찾을 수 없습니다.' });
    fs.unlinkSync(filepath);
    return send(res, 200, { success: true, message: `todo${id} 삭제 완료` });
  }

  res.writeHead(404);
  res.end('Not Found');
});

server.listen(PORT, () => {
  console.log(`서버 실행 중: http://localhost:${PORT}`);
  console.log('API 엔드포인트:');
  console.log('  GET    /api/todos       - 전체 조회');
  console.log('  POST   /api/todos       - 새 todo 추가 (body: { "text": "..." })');
  console.log('  PUT    /api/todos/:id   - todo 수정 (body: { "text": "..." })');
  console.log('  DELETE /api/todos/:id   - todo 삭제');
});
