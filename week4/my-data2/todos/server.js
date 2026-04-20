const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3001;
const TODOS_DIR = __dirname;

// ========================================
// 파일 파싱 유틸
// ========================================
function parseTodoFile(filename) {
  const filePath = path.join(TODOS_DIR, filename);
  const content = fs.readFileSync(filePath, 'utf-8').trim();
  const lines = content.split('\n');
  const text = lines[0] ? lines[0].trim() : '';
  const doneRaw = lines[1] ? lines[1].trim() : '';
  const done = doneRaw === 'true';

  return { id: filename, text, done };
}

function getTodos() {
  const files = fs.readdirSync(TODOS_DIR);
  return files
    .filter(f => /^todo\d+$/.test(f))
    .sort()
    .map(parseTodoFile);
}

// ========================================
// 응답 헬퍼
// ========================================
function sendJSON(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(JSON.stringify(data));
}

function sendFile(res, filePath, contentType) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try { resolve(JSON.parse(body || '{}')); }
      catch { resolve({}); }
    });
    req.on('error', reject);
  });
}

// ========================================
// 서버
// ========================================
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  // index.html 서빙
  if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
    return sendFile(res, path.join(TODOS_DIR, 'index.html'), 'text/html');
  }

  // GET /api/todos — 전체 목록
  if (req.method === 'GET' && pathname === '/api/todos') {
    const todos = getTodos();
    return sendJSON(res, 200, { success: true, data: todos });
  }

  // GET /api/todos/:id — 단건 조회
  const matchId = pathname.match(/^\/api\/todos\/(todo\d+)$/);
  if (matchId) {
    const filename = matchId[1];
    const filePath = path.join(TODOS_DIR, filename);

    // GET
    if (req.method === 'GET') {
      if (!fs.existsSync(filePath)) {
        return sendJSON(res, 404, { success: false, error: '해당 todo를 찾을 수 없습니다.' });
      }
      return sendJSON(res, 200, { success: true, data: parseTodoFile(filename) });
    }

    // PUT /api/todos/:id — done 상태 수정
    if (req.method === 'PUT') {
      if (!fs.existsSync(filePath)) {
        return sendJSON(res, 404, { success: false, error: '해당 todo를 찾을 수 없습니다.' });
      }
      const body = await parseBody(req);
      const todo = parseTodoFile(filename);
      const done = body.done !== undefined ? body.done : todo.done;
      fs.writeFileSync(filePath, `${todo.text}\n${done}`);
      return sendJSON(res, 200, { success: true, data: parseTodoFile(filename) });
    }

    // DELETE /api/todos/:id
    if (req.method === 'DELETE') {
      if (!fs.existsSync(filePath)) {
        return sendJSON(res, 404, { success: false, error: '해당 todo를 찾을 수 없습니다.' });
      }
      fs.unlinkSync(filePath);
      return sendJSON(res, 200, { success: true });
    }
  }

  // POST /api/todos — 새 todo 추가
  if (req.method === 'POST' && pathname === '/api/todos') {
    const body = await parseBody(req);
    const text = (body.text || '').trim();
    if (!text) {
      return sendJSON(res, 400, { success: false, error: '내용을 입력해주세요.' });
    }
    const files = fs.readdirSync(TODOS_DIR).filter(f => /^todo\d+$/.test(f));
    const nums = files.map(f => parseInt(f.replace('todo', ''))).sort((a, b) => a - b);
    const nextNum = nums.length > 0 ? nums[nums.length - 1] + 1 : 1;
    const newFilename = `todo${nextNum}`;
    fs.writeFileSync(path.join(TODOS_DIR, newFilename), `${text}\nfalse`);
    return sendJSON(res, 201, { success: true, data: parseTodoFile(newFilename) });
  }

  sendJSON(res, 404, { success: false, error: '존재하지 않는 경로입니다.' });
});

server.listen(PORT, () => {
  console.log(`서버 실행 중: http://localhost:${PORT}`);
  console.log('API 엔드포인트:');
  console.log(`  GET    http://localhost:${PORT}/api/todos`);
  console.log(`  GET    http://localhost:${PORT}/api/todos/todo1`);
  console.log(`  POST   http://localhost:${PORT}/api/todos`);
  console.log(`  PUT    http://localhost:${PORT}/api/todos/todo1`);
  console.log(`  DELETE http://localhost:${PORT}/api/todos/todo1`);
});
