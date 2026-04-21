require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const ImageKit = require('imagekit');

const app = express();
const PORT = (process.env.PORT || '3000').toString().trim();

const MEMOS_TABLE = 'memo_app_memos';

const FALLBACK_DB_URL =
  'postgresql://postgres.ybwjaugezfpzbzvatvcl:xulf70bFh3msKS17@aws-1-ap-southeast-1.pooler.supabase.com:6543/postgres';

const pool = new Pool({
  connectionString: (process.env.DATABASE_URL || FALLBACK_DB_URL).trim(),
  ssl: { rejectUnauthorized: false },
});

// ---------- ImageKit ----------
const IK_PUBLIC_KEY   = (process.env.IMAGEKIT_PUBLIC_KEY   || '').trim();
const IK_PRIVATE_KEY  = (process.env.IMAGEKIT_PRIVATE_KEY  || '').trim();
const IK_URL_ENDPOINT = (process.env.IMAGEKIT_URL_ENDPOINT || '').trim();

let imagekit = null;
function getImageKit() {
  if (imagekit) return imagekit;
  if (!IK_PUBLIC_KEY || !IK_PRIVATE_KEY || !IK_URL_ENDPOINT) {
    throw new Error('ImageKit 환경변수가 설정되지 않았습니다. .env 확인 필요.');
  }
  imagekit = new ImageKit({
    publicKey: IK_PUBLIC_KEY,
    privateKey: IK_PRIVATE_KEY,
    urlEndpoint: IK_URL_ENDPOINT,
  });
  return imagekit;
}

app.use(express.json());
app.use(express.static(path.join(__dirname)));

// ---------- Lazy DB init ----------
let dbInitialized = false;
let dbInitPromise = null;

async function initDB() {
  if (dbInitialized) return;
  if (dbInitPromise) return dbInitPromise;

  dbInitPromise = (async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ${MEMOS_TABLE} (
        id         SERIAL      PRIMARY KEY,
        title      TEXT        NOT NULL DEFAULT '',
        content    TEXT        NOT NULL DEFAULT '',
        color      TEXT        NOT NULL DEFAULT 'yellow',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    // Idempotent migration: add `images` JSONB column for existing tables
    await pool.query(`
      ALTER TABLE ${MEMOS_TABLE}
      ADD COLUMN IF NOT EXISTS images JSONB NOT NULL DEFAULT '[]'::jsonb
    `);
    console.log(`✓ DB ready: ${MEMOS_TABLE}`);
    dbInitialized = true;
  })();

  try {
    await dbInitPromise;
  } catch (err) {
    dbInitPromise = null;
    throw err;
  }
}

app.use('/api', async (_req, res, next) => {
  try {
    await initDB();
    next();
  } catch (err) {
    console.error('DB init failed:', err.message);
    res.status(500).json({ error: 'Database initialization failed' });
  }
});

// ---------- Memos API ----------
const VALID_COLORS = ['yellow', 'pink', 'blue', 'green', 'purple', 'orange'];

// Normalize `images` body field into a safe JSONB-ready array.
// Accepts: array of { url, fileId?, thumbnailUrl?, name? }.
// Drops items missing a url, clamps to 20 images, and strips any other keys.
function normalizeImages(raw) {
  if (!Array.isArray(raw)) return [];
  const cleaned = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const url = typeof item.url === 'string' ? item.url.trim() : '';
    if (!url) continue;
    cleaned.push({
      url,
      fileId:       typeof item.fileId === 'string' ? item.fileId : '',
      thumbnailUrl: typeof item.thumbnailUrl === 'string' ? item.thumbnailUrl : '',
      name:         typeof item.name === 'string' ? item.name : '',
    });
    if (cleaned.length >= 20) break;
  }
  return cleaned;
}

app.get('/api/memos', async (req, res) => {
  const { q } = req.query;
  try {
    let rows;
    if (q && q.trim()) {
      const pattern = `%${q.trim()}%`;
      ({ rows } = await pool.query(
        `SELECT id, title, content, color, images, created_at, updated_at
         FROM ${MEMOS_TABLE}
         WHERE title ILIKE $1 OR content ILIKE $1
         ORDER BY updated_at DESC`,
        [pattern]
      ));
    } else {
      ({ rows } = await pool.query(
        `SELECT id, title, content, color, images, created_at, updated_at
         FROM ${MEMOS_TABLE}
         ORDER BY updated_at DESC`
      ));
    }
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/memos', async (req, res) => {
  const { title, content, color, images } = req.body || {};
  const t = (title ?? '').toString().trim();
  const c = (content ?? '').toString();
  const imgs = normalizeImages(images);
  if (!t && !c.trim() && imgs.length === 0) {
    return res.status(400).json({ error: '제목, 내용, 이미지 중 하나는 필요합니다.' });
  }
  const col = VALID_COLORS.includes(color) ? color : 'yellow';
  try {
    const { rows } = await pool.query(
      `INSERT INTO ${MEMOS_TABLE} (title, content, color, images)
       VALUES ($1, $2, $3, $4::jsonb)
       RETURNING id, title, content, color, images, created_at, updated_at`,
      [t, c, col, JSON.stringify(imgs)]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/memos/:id', async (req, res) => {
  const { id } = req.params;
  const { title, content, color, images } = req.body || {};
  const fields = [];
  const values = [];
  let i = 1;
  if (title !== undefined) {
    fields.push(`title = $${i++}`);
    values.push(String(title).trim());
  }
  if (content !== undefined) {
    fields.push(`content = $${i++}`);
    values.push(String(content));
  }
  if (color !== undefined) {
    if (!VALID_COLORS.includes(color)) {
      return res.status(400).json({ error: '유효하지 않은 색상입니다.' });
    }
    fields.push(`color = $${i++}`);
    values.push(color);
  }
  if (images !== undefined) {
    fields.push(`images = $${i++}::jsonb`);
    values.push(JSON.stringify(normalizeImages(images)));
  }
  if (!fields.length) {
    return res.status(400).json({ error: '수정할 내용이 없습니다.' });
  }
  fields.push(`updated_at = NOW()`);
  values.push(id);
  try {
    const { rows } = await pool.query(
      `UPDATE ${MEMOS_TABLE} SET ${fields.join(', ')}
       WHERE id = $${i}
       RETURNING id, title, content, color, images, created_at, updated_at`,
      values
    );
    if (!rows.length) return res.status(404).json({ error: '없는 메모입니다.' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- ImageKit auth ----------
app.get('/api/imagekit/auth', (_req, res) => {
  try {
    const params = getImageKit().getAuthenticationParameters();
    res.json({
      success: true,
      data: {
        token: params.token,
        expire: params.expire,
        signature: params.signature,
        publicKey: IK_PUBLIC_KEY,
        urlEndpoint: IK_URL_ENDPOINT,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.delete('/api/memos/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM ${MEMOS_TABLE} WHERE id = $1`,
      [id]
    );
    if (!rowCount) return res.status(404).json({ error: '없는 메모입니다.' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

if (require.main === module) {
  initDB()
    .then(() => {
      app.listen(PORT, () =>
        console.log(`🚀  http://localhost:${PORT}`)
      );
    })
    .catch((err) => {
      console.error('DB 초기화 실패:', err.message);
      process.exit(1);
    });
}

module.exports = app;
