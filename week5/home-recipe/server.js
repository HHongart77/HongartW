// ===== Module imports =====
const express = require('express');
const cors = require('cors');
const path = require('path');
const { Pool } = require('pg');

// ===== App init =====
const app = express();
const PORT = process.env.PORT || 3000;

// ===== DB (Supabase PostgreSQL) =====
const FALLBACK_DB_URL =
  'postgresql://postgres.wdohgoccwlrkroaxkuue:VY3el1bEQOf7Fgf7@aws-1-us-east-1.pooler.supabase.com:6543/postgres';

const pool = new Pool({
  connectionString: (process.env.DATABASE_URL || FALLBACK_DB_URL).trim(),
  ssl: { rejectUnauthorized: false },
});

// ===== Lazy DB init (serverless cold-start friendly) =====
let dbInitialized = false;
async function initDB() {
  if (dbInitialized) return;
  // 테이블은 setup-db.js 에서 이미 생성되었다고 가정하고 연결 확인만 한다.
  await pool.query('SELECT 1');
  dbInitialized = true;
}

// ===== Middleware =====
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// API 라우트 앞에 DB 초기화 미들웨어 적용
app.use('/api', async (_req, res, next) => {
  try {
    await initDB();
    next();
  } catch (err) {
    console.error('DB init failed:', err);
    res
      .status(500)
      .json({ success: false, message: 'Database initialization failed' });
  }
});

// ===== Helpers =====
function ok(res, data) {
  return res.json({ success: true, data });
}
function fail(res, status, message) {
  return res.status(status).json({ success: false, message });
}

// ===== API Routes =====

// 1) 전체 카테고리
app.get('/api/categories', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, name, emoji FROM categories ORDER BY id'
    );
    return ok(res, rows);
  } catch (err) {
    console.error('GET /api/categories', err);
    return fail(res, 500, '카테고리 조회 중 오류가 발생했습니다.');
  }
});

// 2) 전체 재료 (카테고리 JOIN)
app.get('/api/ingredients', async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        i.id,
        i.name,
        i.emoji,
        i.category_id,
        c.name  AS category_name,
        c.emoji AS category_emoji
      FROM ingredients i
      LEFT JOIN categories c ON c.id = i.category_id
      ORDER BY i.category_id, i.id
    `);
    return ok(res, rows);
  } catch (err) {
    console.error('GET /api/ingredients', err);
    return fail(res, 500, '재료 조회 중 오류가 발생했습니다.');
  }
});

// 3) 재료로 매칭 레시피 조회
//    /api/recipes/match?ingredients=계란,양파,당근&sort=match|time|difficulty
app.get('/api/recipes/match', async (req, res) => {
  try {
    const raw = (req.query.ingredients || '').toString().trim();
    const sort = (req.query.sort || 'match').toString();

    // 입력 재료 파싱
    const inputNames = raw
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    if (inputNames.length === 0) {
      return fail(res, 400, 'ingredients 쿼리 파라미터가 필요합니다.');
    }

    // 난이도 정렬용 매핑 (쉬움 < 보통 < 어려움)
    const difficultyOrder = `CASE r.difficulty
      WHEN '쉬움' THEN 1
      WHEN '보통' THEN 2
      WHEN '어려움' THEN 3
      ELSE 4
    END`;

    // 정렬 기준
    let orderBy;
    switch (sort) {
      case 'time':
        orderBy = 'r.time_minutes ASC, percent DESC';
        break;
      case 'difficulty':
        orderBy = `${difficultyOrder} ASC, percent DESC`;
        break;
      case 'match':
      default:
        orderBy = 'percent DESC, matched DESC, r.time_minutes ASC';
        break;
    }

    // 한 쿼리로 레시피별 total / matched / percent 집계
    const sql = `
      WITH input AS (
        SELECT id FROM ingredients WHERE name = ANY($1::text[])
      ),
      stats AS (
        SELECT
          r.id,
          COUNT(ri.ingredient_id)::int AS total,
          COUNT(ri.ingredient_id)
            FILTER (WHERE ri.ingredient_id IN (SELECT id FROM input))::int
            AS matched
        FROM recipes r
        LEFT JOIN recipe_ingredients ri ON ri.recipe_id = r.id
        GROUP BY r.id
      )
      SELECT
        r.id,
        r.name,
        r.emoji,
        r.time_minutes,
        r.difficulty,
        s.total,
        s.matched,
        CASE
          WHEN s.total = 0 THEN 0
          ELSE ROUND((s.matched::numeric / s.total) * 100)::int
        END AS percent
      FROM recipes r
      JOIN stats s ON s.id = r.id
      WHERE s.matched >= 1
      ORDER BY ${orderBy};
    `;

    const { rows } = await pool.query(sql, [inputNames]);
    return ok(res, rows);
  } catch (err) {
    console.error('GET /api/recipes/match', err);
    return fail(res, 500, '레시피 매칭 중 오류가 발생했습니다.');
  }
});

// 4) 레시피 상세 (재료 + 조리 단계)
app.get('/api/recipes/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) {
      return fail(res, 400, '잘못된 레시피 id 입니다.');
    }

    const recipeQ = pool.query(
      `SELECT id, name, emoji, time_minutes, difficulty, created_at
       FROM recipes WHERE id = $1`,
      [id]
    );
    const ingredientsQ = pool.query(
      `SELECT
         i.id,
         i.name,
         i.emoji,
         i.category_id,
         c.name AS category_name,
         ri.amount
       FROM recipe_ingredients ri
       JOIN ingredients i ON i.id = ri.ingredient_id
       LEFT JOIN categories c ON c.id = i.category_id
       WHERE ri.recipe_id = $1
       ORDER BY i.category_id, i.id`,
      [id]
    );
    const stepsQ = pool.query(
      `SELECT id, step_order, description
       FROM recipe_steps
       WHERE recipe_id = $1
       ORDER BY step_order ASC`,
      [id]
    );

    const [recipeR, ingredientsR, stepsR] = await Promise.all([
      recipeQ,
      ingredientsQ,
      stepsQ,
    ]);

    if (recipeR.rows.length === 0) {
      return fail(res, 404, '레시피를 찾을 수 없습니다.');
    }

    const recipe = recipeR.rows[0];
    recipe.ingredients = ingredientsR.rows;
    recipe.steps = stepsR.rows;

    return ok(res, recipe);
  } catch (err) {
    console.error('GET /api/recipes/:id', err);
    return fail(res, 500, '레시피 상세 조회 중 오류가 발생했습니다.');
  }
});

// ===== SPA fallback (Express 5 문법) =====
app.get('/{*splat}', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ===== Error handler =====
app.use((err, _req, res, _next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
});

// ===== Local start / Serverless export =====
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

module.exports = app;
