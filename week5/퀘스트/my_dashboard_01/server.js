const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const OpenAI = require('openai');

// Lightweight .env loader (no dotenv dep required)
try {
  const envPath = path.join(__dirname, '.env');
  fs.readFileSync(envPath, 'utf8').split(/\r?\n/).forEach((line) => {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  });
} catch (_) {
  /* .env is optional */
}

const app = express();
const PORT = process.env.PORT || 3000;

const TABLE_PREFIX = 'my_dashboard_01';
const USERS_TABLE = `${TABLE_PREFIX}_users`;

const FALLBACK_DB_URL =
  'postgresql://postgres.wdohgoccwlrkroaxkuue:VY3el1bEQOf7Fgf7@aws-1-us-east-1.pooler.supabase.com:6543/postgres';

const JWT_SECRET = (process.env.JWT_SECRET || 'dev-only-secret-change-me-in-prod').trim();
const JWT_EXPIRES_IN = '7d';

const pool = new Pool({
  connectionString: (process.env.DATABASE_URL || FALLBACK_DB_URL).trim(),
  ssl: { rejectUnauthorized: false },
});

app.use(express.json());
app.use(express.static(path.join(__dirname)));

// ---------- Password hashing (scrypt, salt:hash) ----------
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored || typeof stored !== 'string' || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const hashBuf = Buffer.from(hash, 'hex');
  const testBuf = crypto.scryptSync(password, salt, 64);
  if (hashBuf.length !== testBuf.length) return false;
  return crypto.timingSafeEqual(hashBuf, testBuf);
}

// ---------- JWT ----------
function signToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: '로그인이 필요합니다.' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: '유효하지 않은 토큰입니다.' });
  }
}

// ---------- Input validation ----------
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function validateCredentials({ email, password }) {
  if (!email || typeof email !== 'string' || !EMAIL_RE.test(email)) {
    return '이메일 형식이 올바르지 않습니다.';
  }
  if (!password || typeof password !== 'string' || password.length < 8) {
    return '비밀번호는 8자 이상이어야 합니다.';
  }
  return null;
}

// ---------- Lazy DB init ----------
let dbInitialized = false;
let dbInitPromise = null;

async function initDB() {
  if (dbInitialized) return;
  if (dbInitPromise) return dbInitPromise;

  dbInitPromise = (async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ${USERS_TABLE} (
        id            SERIAL      PRIMARY KEY,
        email         TEXT        NOT NULL UNIQUE,
        password_hash TEXT        NOT NULL,
        name          TEXT,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    console.log(`✓ DB ready: ${USERS_TABLE}`);

    // Seed initial accounts (idempotent — only inserts if missing)
    const SEED_ACCOUNTS = [
      { email: 'demo@example.com', password: 'demo1234', name: '데모 사용자' },
      { email: 'rada12@naver.com', password: 'skstoa77!@#$', name: '철홍' },
    ];

    for (const acc of SEED_ACCOUNTS) {
      const { rows: existing } = await pool.query(
        `SELECT id FROM ${USERS_TABLE} WHERE email = $1`,
        [acc.email]
      );
      if (existing.length === 0) {
        await pool.query(
          `INSERT INTO ${USERS_TABLE} (email, password_hash, name)
           VALUES ($1, $2, $3)
           ON CONFLICT (email) DO NOTHING`,
          [acc.email, hashPassword(acc.password), acc.name]
        );
        console.log(`✓ Account seeded: ${acc.email}`);
      } else {
        console.log(`✓ Account already exists: ${acc.email}`);
      }
    }

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

// ---------- Auth API ----------
// POST /api/signup { email, password, name? }
app.post('/api/signup', async (req, res) => {
  const { email, password, name } = req.body || {};
  const invalid = validateCredentials({ email, password });
  if (invalid) return res.status(400).json({ error: invalid });

  try {
    const normalizedEmail = email.trim().toLowerCase();
    const { rows: existing } = await pool.query(
      `SELECT id FROM ${USERS_TABLE} WHERE email = $1`,
      [normalizedEmail]
    );
    if (existing.length) {
      return res.status(409).json({ error: '이미 가입된 이메일입니다.' });
    }

    const { rows } = await pool.query(
      `INSERT INTO ${USERS_TABLE} (email, password_hash, name)
       VALUES ($1, $2, $3)
       RETURNING id, email, name, created_at`,
      [normalizedEmail, hashPassword(password), name?.trim() || null]
    );
    const user = rows[0];
    const token = signToken(user);
    res.status(201).json({ token, user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/login { email, password }
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: '이메일과 비밀번호를 입력해주세요.' });
  }
  try {
    const { rows } = await pool.query(
      `SELECT id, email, password_hash, name, created_at FROM ${USERS_TABLE} WHERE email = $1`,
      [email.trim().toLowerCase()]
    );
    const user = rows[0];
    if (!user || !verifyPassword(password, user.password_hash)) {
      return res.status(401).json({ error: '이메일 또는 비밀번호가 올바르지 않습니다.' });
    }
    const token = signToken(user);
    res.json({
      token,
      user: { id: user.id, email: user.email, name: user.name, created_at: user.created_at },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/me  (requires Authorization: Bearer <token>)
app.get('/api/me', authRequired, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, email, name, created_at FROM ${USERS_TABLE} WHERE id = $1`,
      [req.user.sub]
    );
    if (!rows.length) return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- Expenses API (read-only view into 가계부 앱 DB) ----------
const EXPENSE_TABLE = '"가계부_앱_transactions"';

async function fetchWeeklyExpenses() {
  const fmt = (d) => d.toISOString().slice(0, 10);
  const today = new Date();
  const thisStart = new Date(today); thisStart.setDate(today.getDate() - 6);
  const lastEnd = new Date(thisStart); lastEnd.setDate(thisStart.getDate() - 1);
  const lastStart = new Date(lastEnd); lastStart.setDate(lastEnd.getDate() - 6);

  const range = { start: fmt(thisStart), end: fmt(today) };
  const lastRange = { start: fmt(lastStart), end: fmt(lastEnd) };

  try {
    const { rows: categories } = await pool.query(
      `SELECT category, SUM(amount)::int AS amount
       FROM ${EXPENSE_TABLE}
       WHERE date BETWEEN $1 AND $2
       GROUP BY category
       ORDER BY amount DESC`,
      [range.start, range.end]
    );
    const { rows: lastAgg } = await pool.query(
      `SELECT COALESCE(SUM(amount), 0)::int AS total
       FROM ${EXPENSE_TABLE}
       WHERE date BETWEEN $1 AND $2`,
      [lastRange.start, lastRange.end]
    );
    const total = categories.reduce((s, r) => s + r.amount, 0);
    const lastWeekTotal = lastAgg[0].total;
    const change =
      lastWeekTotal > 0 ? ((total - lastWeekTotal) / lastWeekTotal) * 100 : null;
    return { range, total, categories, lastWeekTotal, change };
  } catch (err) {
    if (err.code === '42P01') {
      return { range, total: 0, categories: [], lastWeekTotal: 0, change: null };
    }
    throw err;
  }
}

// GET /api/expenses/weekly — rolling 7-day window ending today, plus prior 7-day comparison
app.get('/api/expenses/weekly', authRequired, async (_req, res) => {
  try {
    res.json(await fetchWeeklyExpenses());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- Weather (Windy Point Forecast) ----------
const WINDY_API_KEY = (process.env.WINDY_API_KEY || '').trim();
const BRIEFING_LAT = parseFloat(process.env.BRIEFING_LAT || '37.5665');
const BRIEFING_LON = parseFloat(process.env.BRIEFING_LON || '126.9780');

async function fetchCurrentWeather() {
  if (!WINDY_API_KEY) {
    const err = new Error('WINDY_API_KEY missing');
    err.status = 503;
    throw err;
  }
  const res = await fetch('https://api.windy.com/api/point-forecast/v2', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      lat: BRIEFING_LAT,
      lon: BRIEFING_LON,
      model: 'gfs',
      parameters: ['temp', 'wind', 'precip'],
      levels: ['surface'],
      key: WINDY_API_KEY,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Windy API ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  const i = 0; // nearest timestamp
  const tempK = data['temp-surface']?.[i];
  const tempC = tempK != null ? Math.round((tempK - 273.15) * 10) / 10 : null;
  const precipKg = data['past3hprecip-surface']?.[i] ?? 0;
  const uWind = data['wind_u-surface']?.[i];
  const vWind = data['wind_v-surface']?.[i];
  const windMs =
    uWind != null && vWind != null
      ? Math.round(Math.sqrt(uWind * uWind + vWind * vWind) * 10) / 10
      : null;
  return {
    tempC,
    precipMM3h: Math.round(precipKg * 10) / 10,
    windMs,
    summary:
      precipKg > 0.5 ? '비 올 가능성' : precipKg > 0.1 ? '약간 흐림' : '맑은 편',
  };
}

// ---------- AI Briefing (OpenAI, SSE streaming) ----------
const OPENAI_API_KEY = (process.env.OPENAI_API_KEY || '').trim();
const OPENAI_MODEL = (process.env.OPENAI_MODEL || 'gpt-4o-mini').trim();
const WEEKLY_BUDGET_KRW = parseInt(process.env.WEEKLY_BUDGET_KRW || '300000', 10);

let openaiClient = null;
function getOpenAI() {
  if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY missing');
  if (!openaiClient) openaiClient = new OpenAI({ apiKey: OPENAI_API_KEY });
  return openaiClient;
}

const BRIEFING_SYSTEM_PROMPT = `당신은 사용자의 개인 대시보드 비서입니다.
주어진 JSON(오늘 할일, 이번 주 지출)을 바탕으로 2~3문장의 짧고 자연스러운 한국어 브리핑을 작성하세요.
- 톤: 차분하고 따뜻하게, 과장 없이.
- 숫자를 그대로 나열하지 말고, 의미 있는 해석과 가벼운 제안을 곁들이세요.
- 서론·끝인사 없이 본론만 쓰세요.
- 이모지는 사용하지 마세요.`;

// POST /api/briefing — gather context then SSE-stream a short AI summary
app.post('/api/briefing', authRequired, async (req, res) => {
  // 1. Gather context (parallel, tolerate partial failures)
  const [tasksRes, expensesRes, weatherRes] = await Promise.allSettled([
    fetchTodayTasks(),
    fetchWeeklyExpenses(),
    fetchCurrentWeather(),
  ]);

  const tasks = tasksRes.status === 'fulfilled' ? tasksRes.value : null;
  const expenses = expensesRes.status === 'fulfilled' ? expensesRes.value : null;
  const weather = weatherRes.status === 'fulfilled' ? weatherRes.value : null;

  const doneCount = tasks?.items.filter((t) => t.checked).length ?? 0;
  const totalCount = tasks?.items.length ?? 0;

  const context = {
    tasks: tasks
      ? {
          weekday: tasks.weekday,
          total: totalCount,
          done: doneCount,
          remaining: totalCount - doneCount,
          titles: tasks.items.map((t) => t.text),
        }
      : { error: 'Notion 조회 실패' },
    expenses: expenses
      ? {
          thisWeekTotalKRW: expenses.total,
          weeklyBudgetKRW: WEEKLY_BUDGET_KRW,
          budgetUsedPercent:
            WEEKLY_BUDGET_KRW > 0
              ? Math.round((expenses.total / WEEKLY_BUDGET_KRW) * 100)
              : null,
          changeVsLastWeekPercent:
            expenses.change !== null ? Math.round(expenses.change * 10) / 10 : null,
          topCategory: expenses.categories[0]?.category ?? null,
          topCategoryAmountKRW: expenses.categories[0]?.amount ?? null,
        }
      : { error: '지출 조회 실패' },
    weather: weather
      ? {
          tempC: weather.tempC,
          precipMM3h: weather.precipMM3h,
          windMs: weather.windMs,
          summary: weather.summary,
        }
      : null,
  };

  // 2. Start SSE
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  const writeSse = (obj) => {
    try {
      res.write(`data: ${JSON.stringify(obj)}\n\n`);
      if (typeof res.flush === 'function') res.flush();
    } catch {
      /* connection closed */
    }
  };

  writeSse({ type: 'meta', context });

  let clientClosed = false;
  const abortController = new AbortController();
  req.on('close', () => {
    clientClosed = true;
    try { abortController.abort(); } catch {}
  });

  let stream;
  try {
    stream = await getOpenAI().chat.completions.create(
      {
        model: OPENAI_MODEL,
        stream: true,
        temperature: 0.6,
        messages: [
          { role: 'system', content: BRIEFING_SYSTEM_PROMPT },
          { role: 'user', content: '데이터(JSON):\n' + JSON.stringify(context, null, 2) },
        ],
      },
      { signal: abortController.signal }
    );
  } catch (err) {
    console.error('[openai create]', err && (err.status || err.message));
    writeSse({ type: 'error', message: 'AI 호출에 실패했어요.' });
    writeSse({ type: 'done' });
    return res.end();
  }

  try {
    for await (const chunk of stream) {
      if (clientClosed) break;
      const delta = chunk?.choices?.[0]?.delta?.content;
      if (delta) writeSse({ type: 'text', value: delta });
    }
    if (!clientClosed) writeSse({ type: 'done' });
  } catch (err) {
    if (!clientClosed) {
      console.error('[openai stream]', err && (err.message || err.code));
      writeSse({ type: 'error', message: '스트리밍 중 오류가 발생했어요.' });
      writeSse({ type: 'done' });
    }
  } finally {
    try { res.end(); } catch {}
  }
});

// ---------- Notion API proxy (Integration Token, server-side only) ----------
const NOTION_API_KEY = (process.env.NOTION_API_KEY || '').trim();
const NOTION_TODO_PAGE_ID = (process.env.NOTION_TODO_PAGE_ID || '').trim();
const NOTION_VERSION = '2022-06-28';
const WEEKDAY_NAMES = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];

async function notionFetchChildren(blockId) {
  const res = await fetch(
    `https://api.notion.com/v1/blocks/${blockId}/children?page_size=100`,
    {
      headers: {
        Authorization: `Bearer ${NOTION_API_KEY}`,
        'Notion-Version': NOTION_VERSION,
      },
    }
  );
  if (!res.ok) {
    const text = await res.text();
    const err = new Error(`Notion API ${res.status}: ${text.slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  return data.results || [];
}

const plainText = (rich) => (rich || []).map((t) => t.plain_text).join('');

async function fetchTodayTasks() {
  if (!NOTION_API_KEY || !NOTION_TODO_PAGE_ID) {
    const err = new Error('Notion이 설정되지 않았어요.');
    err.status = 503;
    throw err;
  }
  const todayName = WEEKDAY_NAMES[new Date().getDay()];
  const pageIdClean = NOTION_TODO_PAGE_ID.replace(/-/g, '');
  const pageUrl = `https://www.notion.so/${pageIdClean}`;

  const root = await notionFetchChildren(NOTION_TODO_PAGE_ID);
  const columnLists = root.filter((b) => b.type === 'column_list');
  if (columnLists.length === 0) {
    return { weekday: todayName, weekLabel: null, items: [], pageUrl };
  }
  const targetList = columnLists[columnLists.length - 1];
  const idx = root.indexOf(targetList);

  let weekLabel = null;
  for (let i = idx - 1; i >= 0; i--) {
    if (root[i].type === 'heading_1') {
      weekLabel = plainText(root[i].heading_1.rich_text);
      break;
    }
  }

  const columns = await notionFetchChildren(targetList.id);
  const columnContents = await Promise.all(
    columns.map((c) => notionFetchChildren(c.id))
  );

  let items = [];
  for (const children of columnContents) {
    const heading = children.find((b) => b.type === 'heading_3');
    const headingText = heading ? plainText(heading.heading_3.rich_text).trim() : '';
    if (headingText === todayName) {
      items = children
        .filter((b) => b.type === 'to_do')
        .map((b) => ({
          id: b.id,
          text: plainText(b.to_do.rich_text).trim(),
          checked: b.to_do.checked,
          url: `${pageUrl}#${b.id.replace(/-/g, '')}`,
        }))
        .filter((t) => t.text.length > 0)
        .slice(0, 5);
      break;
    }
  }
  return { weekday: todayName, weekLabel, items, pageUrl };
}

// GET /api/tasks — today's to-dos scraped from the "주간 할 일 목록" page
app.get('/api/tasks', authRequired, async (_req, res) => {
  try {
    res.json(await fetchTodayTasks());
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ---------- Local vs serverless ----------
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
