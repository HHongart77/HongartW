const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;
const DIR = __dirname;

app.use(express.json());
app.use(express.static(DIR));

function getTodoFiles() {
  return fs.readdirSync(DIR).filter(f => /^todo\d+\.json$/.test(f));
}

function readAllTodos() {
  return getTodoFiles()
    .map(f => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf-8')))
    .sort((a, b) => a.id - b.id);
}

function getNextId() {
  const files = getTodoFiles();
  if (files.length === 0) return 1;
  const ids = files.map(f => parseInt(f.replace('todo', '').replace('.json', ''), 10));
  return Math.max(...ids) + 1;
}

// GET /api/todos
app.get('/api/todos', (req, res) => {
  try {
    res.json({ success: true, data: readAllTodos() });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// GET /api/todos/:id
app.get('/api/todos/:id', (req, res) => {
  const filepath = path.join(DIR, `todo${req.params.id}.json`);
  if (!fs.existsSync(filepath)) return res.status(404).json({ success: false, message: '해당 todo를 찾을 수 없습니다.' });
  res.json({ success: true, data: JSON.parse(fs.readFileSync(filepath, 'utf-8')) });
});

// POST /api/todos
app.post('/api/todos', (req, res) => {
  try {
    const { title, description = '' } = req.body;
    if (!title || !title.trim()) return res.status(400).json({ success: false, message: 'title은 필수입니다.' });
    const id = getNextId();
    const todo = { id, title: title.trim(), description: description.trim(), done: false };
    fs.writeFileSync(path.join(DIR, `todo${id}.json`), JSON.stringify(todo, null, 2), 'utf-8');
    res.status(201).json({ success: true, data: todo });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// PATCH /api/todos/:id
app.patch('/api/todos/:id', (req, res) => {
  try {
    const filepath = path.join(DIR, `todo${req.params.id}.json`);
    if (!fs.existsSync(filepath)) return res.status(404).json({ success: false, message: '해당 todo를 찾을 수 없습니다.' });
    const todo = JSON.parse(fs.readFileSync(filepath, 'utf-8'));
    const updated = { ...todo, ...req.body, id: todo.id };
    fs.writeFileSync(filepath, JSON.stringify(updated, null, 2), 'utf-8');
    res.json({ success: true, data: updated });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// DELETE /api/todos/:id
app.delete('/api/todos/:id', (req, res) => {
  try {
    const filepath = path.join(DIR, `todo${req.params.id}.json`);
    if (!fs.existsSync(filepath)) return res.status(404).json({ success: false, message: '해당 todo를 찾을 수 없습니다.' });
    fs.unlinkSync(filepath);
    res.json({ success: true, message: `todo${req.params.id} 삭제 완료` });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

app.get('/{*splat}', (_req, res) => {
  res.sendFile(path.join(DIR, 'index.html'));
});

if (require.main === module) {
  app.listen(PORT, () => console.log(`서버 실행 중: http://localhost:${PORT}`));
}
module.exports = app;
