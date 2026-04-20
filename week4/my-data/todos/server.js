const express = require('express');
const path = require('path');
const fs = require('fs');
const app = express();
const PORT = process.env.PORT || 3000;

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------
app.use(express.json());

// CORS — allow all origins
app.use((_req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (_req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Serve the React frontend from ../app
app.use(express.static(path.join(__dirname, '..', 'app')));

// ---------------------------------------------------------------------------
// In-memory data store — loaded from todo1~5 files
// ---------------------------------------------------------------------------
function loadTodosFromFiles() {
  const result = [];
  for (let i = 1; i <= 5; i++) {
    const filePath = path.join(__dirname, `todo${i}`);
    if (fs.existsSync(filePath)) {
      const task = fs.readFileSync(filePath, 'utf-8').trim();
      result.push({ id: i, title: task, completed: false, createdAt: new Date().toISOString() });
    }
  }
  return result;
}

let todos = loadTodosFromFiles();
let nextId = todos.length + 1;

// ---------------------------------------------------------------------------
// API Routes
// ---------------------------------------------------------------------------

// GET /api/todos — list all todos
app.get('/api/todos', (_req, res) => {
  res.json({ success: true, data: todos });
});

// POST /api/todos — create a new todo
app.post('/api/todos', (req, res) => {
  try {
    const { title } = req.body;

    if (!title || typeof title !== 'string' || !title.trim()) {
      return res.status(400).json({ success: false, message: 'title is required and must be a non-empty string' });
    }

    const todo = {
      id: nextId++,
      title: title.trim(),
      completed: false,
      createdAt: new Date().toISOString(),
    };

    todos.push(todo);
    res.status(201).json({ success: true, data: todo });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to create todo' });
  }
});

// PUT /api/todos/:id — update a todo
app.put('/api/todos/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const todo = todos.find((t) => t.id === id);

    if (!todo) {
      return res.status(404).json({ success: false, message: `Todo with id ${id} not found` });
    }

    const { title, completed } = req.body;

    if (title !== undefined) {
      if (typeof title !== 'string' || !title.trim()) {
        return res.status(400).json({ success: false, message: 'title must be a non-empty string' });
      }
      todo.title = title.trim();
    }

    if (completed !== undefined) {
      if (typeof completed !== 'boolean') {
        return res.status(400).json({ success: false, message: 'completed must be a boolean' });
      }
      todo.completed = completed;
    }

    res.json({ success: true, data: todo });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to update todo' });
  }
});

// DELETE /api/todos/:id — delete a todo
app.delete('/api/todos/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const index = todos.findIndex((t) => t.id === id);

    if (index === -1) {
      return res.status(404).json({ success: false, message: `Todo with id ${id} not found` });
    }

    const [removed] = todos.splice(index, 1);
    res.json({ success: true, data: removed });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to delete todo' });
  }
});

// ---------------------------------------------------------------------------
// SPA fallback — serve index.html for non-API routes
// ---------------------------------------------------------------------------
app.get('/{*path}', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'app', 'index.html'));
});

// ---------------------------------------------------------------------------
// Start server (local) / Export app (Vercel serverless)
// ---------------------------------------------------------------------------
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Todo API server running on http://localhost:${PORT}`);
    console.log(`Serving static files from ${path.join(__dirname, '..', 'app')}`);
  });
}

module.exports = app;
