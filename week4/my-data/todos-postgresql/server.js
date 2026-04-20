require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 4002;

// ========================================
// DB 연결
// ========================================
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// ========================================
// 미들웨어
// ========================================
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// ========================================
// 테이블 초기화
// ========================================
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      email VARCHAR(255) UNIQUE NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS todos (
      id SERIAL PRIMARY KEY,
      text TEXT NOT NULL,
      done BOOLEAN DEFAULT false,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  console.log('DB 테이블 준비 완료');
}

// ========================================
// Users API
// ========================================

// 모든 유저 조회
app.get('/api/users', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, name, email, created_at FROM users ORDER BY created_at ASC'
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 유저 생성
app.post('/api/users', async (req, res) => {
  const { name, email } = req.body;
  if (!name || !email) {
    return res.status(400).json({ error: 'name과 email은 필수입니다.' });
  }
  try {
    const result = await pool.query(
      'INSERT INTO users (name, email) VALUES ($1, $2) RETURNING *',
      [name, email]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: '이미 존재하는 이메일입니다.' });
    }
    res.status(500).json({ error: err.message });
  }
});

// 유저 삭제 (todos도 CASCADE 삭제)
app.delete('/api/users/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM users WHERE id = $1', [id]);
    res.json({ message: '유저가 삭제되었습니다.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========================================
// Todos API
// ========================================

// 특정 유저의 todo 조회
app.get('/api/users/:userId/todos', async (req, res) => {
  const { userId } = req.params;
  try {
    const result = await pool.query(
      'SELECT * FROM todos WHERE user_id = $1 ORDER BY created_at ASC',
      [userId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 모든 todo 조회 (유저 정보 포함)
app.get('/api/todos', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT t.*, u.name as user_name, u.email as user_email
      FROM todos t
      JOIN users u ON t.user_id = u.id
      ORDER BY t.created_at ASC
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// todo 생성
app.post('/api/todos', async (req, res) => {
  const { text, user_id } = req.body;
  if (!text || !user_id) {
    return res.status(400).json({ error: 'text와 user_id는 필수입니다.' });
  }
  try {
    const result = await pool.query(
      'INSERT INTO todos (text, user_id) VALUES ($1, $2) RETURNING *',
      [text, user_id]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// todo 완료 토글
app.patch('/api/todos/:id', async (req, res) => {
  const { id } = req.params;
  const { done } = req.body;
  try {
    const result = await pool.query(
      'UPDATE todos SET done = $1 WHERE id = $2 RETURNING *',
      [done, id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Todo를 찾을 수 없습니다.' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// todo 삭제
app.delete('/api/todos/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM todos WHERE id = $1', [id]);
    res.json({ message: 'Todo가 삭제되었습니다.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========================================
// 서버 시작
// ========================================
if (require.main === module) {
  initDB()
    .then(() => {
      app.listen(PORT, () => {
        console.log(`서버 실행 중: http://localhost:${PORT}`);
      });
    })
    .catch((err) => {
      console.error('DB 초기화 실패:', err);
      process.exit(1);
    });
} else {
  // Vercel 서버리스 환경
  initDB().catch((err) => console.error('DB 초기화 실패:', err));
}

module.exports = app;
