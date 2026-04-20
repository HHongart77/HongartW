// ============================================================================
// Korean Budget-Analyzer Chat App — server.js
// ----------------------------------------------------------------------------
// - Serves index.html (static) and exposes /api/* backed by Supabase Postgres.
// - DB credentials read from process.env.DATABASE_URL (.env via dotenv).
// - CommonJS, Express, lazy-init DB pool, dual-mode (local + serverless).
// ============================================================================

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const { Pool, types } = require('pg');

// Keep DATE columns as plain 'YYYY-MM-DD' strings (no timezone shift).
types.setTypeParser(1082, (v) => v);

const app = express();
const PORT = process.env.PORT || 3000;

// ---------------------------------------------------------------------------
// DB pool — lazy init with a single shared Pool instance
// ---------------------------------------------------------------------------
const RAW_DB_URL = (process.env.DATABASE_URL || '').trim();
const HAS_DB_URL = RAW_DB_URL.length > 0;

// Log the DB host (never the full URL / password).
if (HAS_DB_URL) {
  try {
    const u = new URL(RAW_DB_URL);
    console.log(`Database configured: host=${u.hostname}`);
  } catch (_e) {
    console.log('Database configured: host=<unparseable>');
  }
} else {
  console.error(
    '[server.js] WARNING: DATABASE_URL is not set. /api/* will return 503 until it is configured in .env'
  );
}

let pool = null;
let dbInitialized = false;

function getPool() {
  if (!HAS_DB_URL) return null;
  if (!pool) {
    pool = new Pool({
      connectionString: RAW_DB_URL,
      ssl: { rejectUnauthorized: false },
    });
    pool.on('error', (err) => {
      console.error('[pg pool error]', err.code || err.name || 'error');
    });
  }
  return pool;
}

async function initDB() {
  if (dbInitialized) return;
  if (!HAS_DB_URL) throw new Error('DATABASE_URL is not set');
  const p = getPool();
  // Table is pre-created and pre-seeded; just do a cheap ping to validate.
  await p.query('SELECT 1');
  dbInitialized = true;
}

// ---------------------------------------------------------------------------
// Middleware (CORS first, then JSON body, then static)
// ---------------------------------------------------------------------------
app.use(cors());
app.use(express.json());

// Lightweight request logger for /api/* only.
app.use((req, res, next) => {
  if (!req.path.startsWith('/api')) return next();
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    console.log(`${req.method} ${req.originalUrl} -> ${res.statusCode} (${ms}ms)`);
  });
  next();
});

// Belt & suspenders: if any response body string contains the raw DB URL,
// strip it before sending. Cheap insurance against accidental leakage.
app.use((_req, res, next) => {
  const origJson = res.json.bind(res);
  const origSend = res.send.bind(res);
  const scrub = (payload) => {
    if (!HAS_DB_URL) return payload;
    try {
      const str = typeof payload === 'string' ? payload : JSON.stringify(payload);
      if (str.includes(RAW_DB_URL)) {
        const scrubbed = str.split(RAW_DB_URL).join('[REDACTED]');
        return typeof payload === 'string' ? scrubbed : JSON.parse(scrubbed);
      }
    } catch (_e) {
      /* ignore */
    }
    return payload;
  };
  res.json = (body) => origJson(scrub(body));
  res.send = (body) => origSend(scrub(body));
  next();
});

app.use(express.static(__dirname));

// Guard + lazy init for every /api/* request. If no DB URL, refuse cleanly.
app.use('/api', async (_req, res, next) => {
  if (!HAS_DB_URL) {
    return res.status(503).json({
      success: false,
      message:
        'DATABASE_URL is not configured on the server. Create a .env with DATABASE_URL=... and restart.',
    });
  }
  try {
    await initDB();
    next();
  } catch (err) {
    console.error('[initDB]', err.code || err.name || 'error');
    res.status(500).json({ success: false, message: 'Database initialization failed' });
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const TABLE = '"가계부_앱_transactions"';
const won = (n) => Number(n || 0).toLocaleString('ko-KR') + '원';

function isValidDate(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function asIntOrNull(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

// Promise-wrapped query
async function q(text, params = []) {
  const p = getPool();
  return p.query(text, params);
}

// Generic pg error handler that never leaks raw pg messages.
function pgError(tag, err) {
  const code = err && err.code ? err.code : 'ERR';
  console.error(`[${tag}]`, code, err && err.name);
  return { message: 'Database error', code };
}

// --- Date math (UTC-agnostic helpers using local date parts) -----------------
function pad2(n) { return String(n).padStart(2, '0'); }
function fmtDate(d) {
  // Format a JS Date as YYYY-MM-DD using its local Y/M/D parts.
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function parseYmd(s) {
  // Return a Date at local midnight for a YYYY-MM-DD string.
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function endOfMonth(d)   { return new Date(d.getFullYear(), d.getMonth() + 1, 0); }
function startOfWeekMon(d) {
  // ISO week: Monday = 1 ... Sunday = 7. Postgres date_trunc('week', ...) uses Mon.
  const day = d.getDay(); // 0=Sun..6=Sat
  const delta = day === 0 ? -6 : 1 - day; // shift to Monday
  return addDays(d, delta);
}
function endOfWeekMon(d) { return addDays(startOfWeekMon(d), 6); }

// ===========================================================================
// Date-range resolution
// ===========================================================================

// Try to parse a date range out of a Korean question string.
// Returns { from, to } (YYYY-MM-DD strings) or null.
function parseRangeFromQuestion(raw, today) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const s = raw.replace(/\s+/g, '');

  // Explicit ISO pair: "YYYY-MM-DD부터 YYYY-MM-DD까지" (or "~", "-", "에서")
  const isoPair = s.match(
    /(\d{4}-\d{2}-\d{2})\s*(?:부터|에서|~|-|–|from)?\s*(\d{4}-\d{2}-\d{2})/
  );
  if (isoPair) {
    const a = isoPair[1], b = isoPair[2];
    if (isValidDate(a) && isValidDate(b) && a <= b) return { from: a, to: b };
  }

  // "M월 D일부터 M월 D일까지"
  const mdPair = s.match(/(\d{1,2})월(\d{1,2})일[^\d]*?(\d{1,2})월(\d{1,2})일/);
  if (mdPair) {
    const m1 = Number(mdPair[1]);
    const d1 = Number(mdPair[2]);
    let m2 = Number(mdPair[3]);
    const d2 = Number(mdPair[4]);
    const y1 = today.getFullYear();
    let y2 = y1;
    if (m2 < m1) y2 = y1 + 1; // roll year forward
    try {
      const from = fmtDate(new Date(y1, m1 - 1, d1));
      const to = fmtDate(new Date(y2, m2 - 1, d2));
      if (from <= to) return { from, to };
    } catch (_e) { /* ignore */ }
  }

  // "오늘"
  if (s.includes('오늘')) {
    const t = fmtDate(today);
    return { from: t, to: t };
  }
  // "어제"
  if (s.includes('어제')) {
    const y = fmtDate(addDays(today, -1));
    return { from: y, to: y };
  }

  // "이번주" / "이번 주"
  if (s.includes('이번주')) {
    return { from: fmtDate(startOfWeekMon(today)), to: fmtDate(endOfWeekMon(today)) };
  }
  // "지난주" / "저번주"
  if (s.includes('지난주') || s.includes('저번주')) {
    const lastWeekAnchor = addDays(today, -7);
    return {
      from: fmtDate(startOfWeekMon(lastWeekAnchor)),
      to: fmtDate(endOfWeekMon(lastWeekAnchor)),
    };
  }

  // "이번달" / "이번 달"
  if (s.includes('이번달')) {
    return { from: fmtDate(startOfMonth(today)), to: fmtDate(endOfMonth(today)) };
  }
  // "지난달" / "저번달"
  if (s.includes('지난달') || s.includes('저번달')) {
    const anchor = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    return { from: fmtDate(startOfMonth(anchor)), to: fmtDate(endOfMonth(anchor)) };
  }

  // "지난 N일" / "최근 N일"
  const nDays = s.match(/(?:지난|최근|최근에|지난번)(\d{1,3})일/);
  if (nDays) {
    const n = Math.max(1, Math.min(365, Number(nDays[1])));
    return { from: fmtDate(addDays(today, -(n - 1))), to: fmtDate(today) };
  }

  return null;
}

// Resolve the effective range in precedence order: body > question > default(data).
// Returns { from, to, source }.
async function resolveRange(body, question) {
  // 1. Body explicit
  const bFrom = body && body.from;
  const bTo = body && body.to;
  if (bFrom || bTo) {
    if (!isValidDate(bFrom) || !isValidDate(bTo)) {
      throw Object.assign(new Error('from/to는 YYYY-MM-DD 형식이어야 합니다.'), { status: 400 });
    }
    if (bFrom > bTo) {
      throw Object.assign(new Error('from은 to보다 같거나 이전이어야 합니다.'), { status: 400 });
    }
    return { from: bFrom, to: bTo, source: 'body' };
  }

  // 2. Question text
  const today = new Date();
  const parsed = parseRangeFromQuestion(question, today);
  if (parsed) return { ...parsed, source: 'question' };

  // 3. Default: data's own min/max date
  const { rows } = await q(`SELECT MIN(date) AS min_d, MAX(date) AS max_d FROM ${TABLE}`);
  const min_d = rows[0] && rows[0].min_d;
  const max_d = rows[0] && rows[0].max_d;
  if (min_d && max_d) {
    return { from: String(min_d), to: String(max_d), source: 'default' };
  }
  // No data yet — fall back to today.
  const t = fmtDate(today);
  return { from: t, to: t, source: 'default' };
}

// Pretty Korean "M월 D일 ~ M월 D일" style for a range.
function formatRangeKorean(from, to) {
  const a = parseYmd(from);
  const b = parseYmd(to);
  const sameYear = a.getFullYear() === b.getFullYear();
  if (sameYear) {
    return `${a.getMonth() + 1}월 ${a.getDate()}일~${b.getMonth() + 1}월 ${b.getDate()}일`;
  }
  return `${from} ~ ${to}`;
}

// ===========================================================================
// CRUD endpoints
// ===========================================================================

// GET /api/transactions?category=&q=&from=&to=&limit=
app.get('/api/transactions', async (req, res) => {
  try {
    const { category, q: qStr, from, to } = req.query;
    let limit = asIntOrNull(req.query.limit);
    if (limit === null || limit <= 0) limit = 500;
    if (limit > 5000) limit = 5000;

    const where = [];
    const params = [];
    if (category) {
      params.push(category);
      where.push(`category = $${params.length}`);
    }
    if (qStr) {
      params.push(`%${qStr}%`);
      where.push(`description ILIKE $${params.length}`);
    }
    if (from && isValidDate(from)) {
      params.push(from);
      where.push(`date >= $${params.length}`);
    }
    if (to && isValidDate(to)) {
      params.push(to);
      where.push(`date <= $${params.length}`);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    params.push(limit);
    const sql = `
      SELECT id, date, category, description, amount, created_at
      FROM ${TABLE}
      ${whereSql}
      ORDER BY date DESC, id DESC
      LIMIT $${params.length}
    `;
    const { rows } = await q(sql, params);
    res.json({ success: true, data: rows });
  } catch (err) {
    const e = pgError('GET /api/transactions', err);
    res.status(500).json({ success: false, message: e.message, code: e.code });
  }
});

// POST /api/transactions
app.post('/api/transactions', async (req, res) => {
  try {
    const { date, category, description, amount } = req.body || {};
    if (!isValidDate(date)) {
      return res.status(400).json({ success: false, message: 'date는 YYYY-MM-DD 형식이어야 합니다.' });
    }
    if (!category || typeof category !== 'string') {
      return res.status(400).json({ success: false, message: 'category가 필요합니다.' });
    }
    if (!description || typeof description !== 'string') {
      return res.status(400).json({ success: false, message: 'description이 필요합니다.' });
    }
    const amt = asIntOrNull(amount);
    if (amt === null || amt < 0) {
      return res.status(400).json({ success: false, message: 'amount는 0 이상의 정수여야 합니다.' });
    }
    const sql = `
      INSERT INTO ${TABLE} (date, category, description, amount)
      VALUES ($1, $2, $3, $4)
      RETURNING id, date, category, description, amount, created_at
    `;
    const { rows } = await q(sql, [date, category.trim(), description.trim(), amt]);
    res.status(201).json({ success: true, data: rows[0] });
  } catch (err) {
    const e = pgError('POST /api/transactions', err);
    res.status(500).json({ success: false, message: e.message, code: e.code });
  }
});

// PATCH /api/transactions/:id
app.patch('/api/transactions/:id', async (req, res) => {
  try {
    const id = asIntOrNull(req.params.id);
    if (id === null) return res.status(400).json({ success: false, message: 'invalid id' });

    const { date, category, description, amount } = req.body || {};
    const sets = [];
    const params = [];

    if (date !== undefined) {
      if (!isValidDate(date)) {
        return res.status(400).json({ success: false, message: 'date는 YYYY-MM-DD 형식이어야 합니다.' });
      }
      params.push(date);
      sets.push(`date = $${params.length}`);
    }
    if (category !== undefined) {
      if (typeof category !== 'string' || !category.trim()) {
        return res.status(400).json({ success: false, message: 'category가 유효하지 않습니다.' });
      }
      params.push(category.trim());
      sets.push(`category = $${params.length}`);
    }
    if (description !== undefined) {
      if (typeof description !== 'string' || !description.trim()) {
        return res.status(400).json({ success: false, message: 'description이 유효하지 않습니다.' });
      }
      params.push(description.trim());
      sets.push(`description = $${params.length}`);
    }
    if (amount !== undefined) {
      const amt = asIntOrNull(amount);
      if (amt === null || amt < 0) {
        return res.status(400).json({ success: false, message: 'amount는 0 이상의 정수여야 합니다.' });
      }
      params.push(amt);
      sets.push(`amount = $${params.length}`);
    }

    if (!sets.length) {
      return res.status(400).json({ success: false, message: '수정할 필드가 없습니다.' });
    }
    params.push(id);
    const sql = `
      UPDATE ${TABLE}
      SET ${sets.join(', ')}
      WHERE id = $${params.length}
      RETURNING id, date, category, description, amount, created_at
    `;
    const { rows } = await q(sql, params);
    if (!rows.length) return res.status(404).json({ success: false, message: 'not found' });
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    const e = pgError('PATCH /api/transactions/:id', err);
    res.status(500).json({ success: false, message: e.message, code: e.code });
  }
});

// DELETE /api/transactions/:id
app.delete('/api/transactions/:id', async (req, res) => {
  try {
    const id = asIntOrNull(req.params.id);
    if (id === null) return res.status(400).json({ success: false, message: 'invalid id' });
    const { rowCount } = await q(`DELETE FROM ${TABLE} WHERE id = $1`, [id]);
    if (!rowCount) return res.status(404).json({ success: false, message: 'not found' });
    res.json({ success: true });
  } catch (err) {
    const e = pgError('DELETE /api/transactions/:id', err);
    res.status(500).json({ success: false, message: e.message, code: e.code });
  }
});

// ===========================================================================
// GET /api/health
// ===========================================================================
app.get('/api/health', async (_req, res) => {
  const serverTimeUtc = new Date().toISOString();
  try {
    const { rows } = await q(`SELECT COUNT(*)::int AS n FROM ${TABLE}`);
    return res.json({
      success: true,
      data: {
        db: 'ok',
        table: 'ok',
        rowCount: rows[0].n,
        serverTimeUtc,
      },
    });
  } catch (err) {
    // Try to distinguish "missing table" from "DB down".
    const code = err && err.code ? err.code : 'ERR';
    if (code === '42P01') {
      // undefined_table
      return res.status(503).json({
        success: false,
        message: 'DB unreachable',
        data: { db: 'ok', table: 'missing', rowCount: 0, serverTimeUtc },
      });
    }
    console.error('[GET /api/health]', code);
    return res.status(503).json({ success: false, message: 'DB unreachable' });
  }
});

// ===========================================================================
// /api/ask (and /api/analyze alias) — Korean intent matcher, range-scoped
// ===========================================================================

// Intent classifier — returns a canonical intent string, plus optional args.
function classifyIntent(raw) {
  const s = String(raw || '').toLowerCase().replace(/\s+/g, '');
  const has = (...needles) => needles.some((n) => s.includes(n));

  // New: weekdayBreakdown (요일별)
  if (has('요일별', '요일마다') || /요일\s*별/.test(raw || '') || /day\s*of\s*week/i.test(raw || '')) {
    return { intent: 'weekdayBreakdown' };
  }

  // "오늘" → today
  if (has('오늘')) return { intent: 'today' };

  // Week comparisons / week-specific first (before generic "이번달")
  if ((has('이번주') && has('저번주')) || (has('이번주') && has('지난주')) || has('주비교')) {
    return { intent: 'weekCompare' };
  }
  if (has('저번주', '지난주')) return { intent: 'lastWeek' };
  if (has('이번주')) return { intent: 'thisWeek' };

  // 주중 vs 주말 / 평일
  if (has('주중', '주말', '평일')) return { intent: 'weekdayVsWeekend' };

  // 상반월 / 하반월
  if (has('상반월', '하반월', '상반기', '하반기', '전반월', '후반월')) {
    return { intent: 'halfMonth' };
  }

  // Food-specific
  if (s.includes('식비') && (s.includes('가장많') || s.includes('최고')) && s.includes('날')) {
    return { intent: 'foodTopDay' };
  }
  if (s.includes('식비') && s.includes('평균')) return { intent: 'foodAverage' };
  if (s.includes('식비') && (s.includes('총') || s.includes('합') || s.includes('얼마'))) {
    return { intent: 'foodTotal' };
  }

  // Category-specific totals
  const catMap = [
    ['교통', '교통'],
    ['쇼핑', '쇼핑'],
    ['문화생활', '문화생활'],
    ['문화', '문화생활'],
    ['생활용품', '생활용품'],
    ['의료', '의료'],
  ];
  for (const [kw, cat] of catMap) {
    if (s.includes(kw)) return { intent: 'categorySpecific', category: cat };
  }

  // Daily average
  if ((s.includes('하루') || s.includes('일일')) && s.includes('평균')) {
    return { intent: 'dailyAverage' };
  }

  // Frequent places
  if ((s.includes('자주') && (s.includes('가는') || s.includes('간'))) || s.includes('단골')) {
    return { intent: 'frequentPlaces' };
  }

  // Over 100k
  if ((s.includes('10만') || s.includes('십만')) && (s.includes('넘') || s.includes('이상') || s.includes('초과'))) {
    return { intent: 'overHundredK' };
  }

  // Max single
  if ((s.includes('가장비싼') || s.includes('최고액') || s.includes('제일비싼') || s.includes('최대')) && s.includes('지출')) {
    return { intent: 'maxSingle' };
  }
  if (s.includes('가장비싼') || s.includes('제일비싼') || s.includes('최고액')) {
    return { intent: 'maxSingle' };
  }

  // Category breakdown
  if (s.includes('카테고리') && (s.includes('비율') || s.includes('분포') || s.includes('비중'))) {
    return { intent: 'categoryBreakdown' };
  }
  if (s.includes('비율') || s.includes('분포')) {
    return { intent: 'categoryBreakdown' };
  }

  // Category top
  if ((s.includes('가장많') || s.includes('제일많')) && s.includes('카테고리')) {
    return { intent: 'categoryTop' };
  }
  if (s.includes('가장많이쓴') || s.includes('제일많이쓴')) {
    return { intent: 'categoryTop' };
  }

  // Total — "이번달 / 얼마 / 총 / 합계"
  if (has('이번달', '이번달총', '얼마', '총합', '합계', '전체') || s.endsWith('얼마') || s.includes('총')) {
    return { intent: 'total' };
  }

  return { intent: 'fallback' };
}

// --- Intent handlers (all range-scoped) ------------------------------------
// Every handler accepts { from, to } and uses it in WHERE date BETWEEN ...

async function handleTotal({ from, to }) {
  const { rows } = await q(
    `SELECT COALESCE(SUM(amount),0)::bigint AS total,
            COUNT(*)::int             AS cnt,
            COUNT(DISTINCT date)::int AS days
       FROM ${TABLE}
      WHERE date BETWEEN $1 AND $2`,
    [from, to]
  );
  const { total, cnt, days } = rows[0];
  const avg = days > 0 ? Math.round(Number(total) / days) : 0;
  return {
    intent: 'total',
    summary:
      `전체 지출은 총 ${won(total)}이에요. ` +
      `거래 ${cnt}건, 지출한 날은 ${days}일, 하루 평균 ${won(avg)}을(를) 쓰셨어요.`,
    details: { total: Number(total), count: cnt, days, dailyAverage: avg },
  };
}

async function handleToday({ from, to, source }) {
  // If body supplied a range, honor it; otherwise use calendar today.
  const useRange = source === 'body';
  const sql = useRange
    ? `SELECT COALESCE(SUM(amount),0)::bigint AS total, COUNT(*)::int AS cnt
         FROM ${TABLE} WHERE date BETWEEN $1 AND $2`
    : `SELECT COALESCE(SUM(amount),0)::bigint AS total, COUNT(*)::int AS cnt
         FROM ${TABLE} WHERE date = CURRENT_DATE`;
  const params = useRange ? [from, to] : [];
  const { rows } = await q(sql, params);
  const { total, cnt } = rows[0];
  if (Number(total) === 0) {
    return { intent: 'today', summary: '오늘은 아직 지출이 없어요.', details: { total: 0, count: 0 } };
  }
  return {
    intent: 'today',
    summary: `오늘 지출은 총 ${won(total)} (${cnt}건)이에요.`,
    details: { total: Number(total), count: cnt },
  };
}

async function handleThisWeek({ from, to, source }) {
  const useRange = source === 'body';
  const sql = useRange
    ? `SELECT COALESCE(SUM(amount),0)::bigint AS total, COUNT(*)::int AS cnt
         FROM ${TABLE} WHERE date BETWEEN $1 AND $2`
    : `SELECT COALESCE(SUM(amount),0)::bigint AS total, COUNT(*)::int AS cnt
         FROM ${TABLE}
        WHERE date >= date_trunc('week', CURRENT_DATE)
          AND date <  date_trunc('week', CURRENT_DATE) + interval '7 days'`;
  const params = useRange ? [from, to] : [];
  const { rows } = await q(sql, params);
  const { total, cnt } = rows[0];
  return {
    intent: 'thisWeek',
    summary: `이번 주 지출은 총 ${won(total)} (${cnt}건)이에요.`,
    details: { total: Number(total), count: cnt },
  };
}

async function handleLastWeek({ from, to, source }) {
  const useRange = source === 'body';
  const sql = useRange
    ? `SELECT COALESCE(SUM(amount),0)::bigint AS total, COUNT(*)::int AS cnt
         FROM ${TABLE} WHERE date BETWEEN $1 AND $2`
    : `SELECT COALESCE(SUM(amount),0)::bigint AS total, COUNT(*)::int AS cnt
         FROM ${TABLE}
        WHERE date >= date_trunc('week', CURRENT_DATE) - interval '7 days'
          AND date <  date_trunc('week', CURRENT_DATE)`;
  const params = useRange ? [from, to] : [];
  const { rows } = await q(sql, params);
  const { total, cnt } = rows[0];
  return {
    intent: 'lastWeek',
    summary: `지난주 지출은 총 ${won(total)} (${cnt}건)이에요.`,
    details: { total: Number(total), count: cnt },
  };
}

async function handleWeekCompare({ from, to, source }) {
  // Body wins: split the given range in half and compare halves.
  if (source === 'body') {
    const a = parseYmd(from);
    const b = parseYmd(to);
    const mid = new Date(a.getFullYear(), a.getMonth(), a.getDate() + Math.floor((b - a) / (2 * 86400000)));
    const midStr = fmtDate(mid);
    const midNextStr = fmtDate(addDays(mid, 1));
    const { rows } = await q(
      `SELECT
          COALESCE(SUM(amount) FILTER (WHERE date > $3 AND date <= $2), 0)::bigint AS this_week,
          COALESCE(SUM(amount) FILTER (WHERE date >= $1 AND date <= $3), 0)::bigint AS last_week
         FROM ${TABLE}
        WHERE date BETWEEN $1 AND $2`,
      [from, to, midStr]
    );
    const tw = Number(rows[0].this_week);
    const lw = Number(rows[0].last_week);
    return {
      intent: 'weekCompare',
      summary: `후반(${midNextStr}~${to}) ${won(tw)} vs 전반(${from}~${midStr}) ${won(lw)}.`,
      details: { thisWeek: tw, lastWeek: lw, diff: tw - lw },
    };
  }
  const { rows } = await q(
    `SELECT
        COALESCE(SUM(amount) FILTER (
          WHERE date >= date_trunc('week', CURRENT_DATE)
            AND date <  date_trunc('week', CURRENT_DATE) + interval '7 days'
        ), 0)::bigint AS this_week,
        COALESCE(SUM(amount) FILTER (
          WHERE date >= date_trunc('week', CURRENT_DATE) - interval '7 days'
            AND date <  date_trunc('week', CURRENT_DATE)
        ), 0)::bigint AS last_week
      FROM ${TABLE}`
  );
  const tw = Number(rows[0].this_week);
  const lw = Number(rows[0].last_week);
  let verdict;
  if (lw === 0 && tw === 0) verdict = '두 주 모두 지출이 없어요.';
  else if (lw === 0) verdict = `이번 주는 ${won(tw)} 썼고, 지난주는 지출이 없었어요.`;
  else {
    const diff = tw - lw;
    const pct = Math.round((Math.abs(diff) / lw) * 100);
    if (diff > 0) verdict = `이번 주가 지난주보다 ${won(diff)} (${pct}%) 더 많아요.`;
    else if (diff < 0) verdict = `이번 주가 지난주보다 ${won(-diff)} (${pct}%) 덜 썼어요.`;
    else verdict = '두 주 지출이 동일해요.';
  }
  return {
    intent: 'weekCompare',
    summary: `이번 주 ${won(tw)} vs 지난주 ${won(lw)}. ${verdict}`,
    details: { thisWeek: tw, lastWeek: lw, diff: tw - lw },
  };
}

async function handleDailyAverage({ from, to, source }) {
  // Body range wins; otherwise full table.
  const sql = source === 'body'
    ? `SELECT COALESCE(SUM(amount),0)::bigint AS total,
              COUNT(DISTINCT date)::int      AS days
         FROM ${TABLE} WHERE date BETWEEN $1 AND $2`
    : `SELECT COALESCE(SUM(amount),0)::bigint AS total,
              COUNT(DISTINCT date)::int      AS days
         FROM ${TABLE}`;
  const params = source === 'body' ? [from, to] : [];
  const { rows } = await q(sql, params);
  const { total, days } = rows[0];
  const avg = days > 0 ? Math.round(Number(total) / days) : 0;
  return {
    intent: 'dailyAverage',
    summary: `하루 평균 지출은 ${won(avg)}이에요. (지출한 ${days}일 기준, 합계 ${won(total)})`,
    details: { dailyAverage: avg, days, total: Number(total) },
  };
}

async function handleFoodTopDay({ from, to }) {
  const { rows: topRows } = await q(
    `SELECT date, COALESCE(SUM(amount),0)::bigint AS total
       FROM ${TABLE}
      WHERE category = '식비' AND date BETWEEN $1 AND $2
      GROUP BY date
      ORDER BY total DESC, date DESC
      LIMIT 1`,
    [from, to]
  );
  if (!topRows.length) {
    return { intent: 'foodTopDay', summary: '식비 기록이 아직 없어요.', details: null };
  }
  const top = topRows[0];
  const { rows: items } = await q(
    `SELECT id, date, category, description, amount
       FROM ${TABLE}
      WHERE category = '식비' AND date = $1
      ORDER BY amount DESC, id ASC`,
    [top.date]
  );
  const dateStr = String(top.date);
  const itemStr = items.map((r) => `${r.description}(${won(r.amount)})`).join(', ');
  return {
    intent: 'foodTopDay',
    summary: `식비가 가장 많았던 날은 ${dateStr}, 총 ${won(top.total)}이에요. — ${itemStr}`,
    details: { date: dateStr, total: Number(top.total), items },
  };
}

async function handleFoodTotal({ from, to }) {
  const { rows } = await q(
    `SELECT COALESCE(SUM(amount),0)::bigint AS total, COUNT(*)::int AS cnt
       FROM ${TABLE} WHERE category = '식비' AND date BETWEEN $1 AND $2`,
    [from, to]
  );
  const { total, cnt } = rows[0];
  return {
    intent: 'foodTotal',
    summary: `식비는 총 ${won(total)} (${cnt}건)이에요.`,
    details: { total: Number(total), count: cnt },
  };
}

async function handleFoodAverage({ from, to }) {
  const { rows } = await q(
    `SELECT COALESCE(SUM(amount),0)::bigint AS total,
            COUNT(*)::int                   AS cnt,
            COUNT(DISTINCT date)::int       AS days
       FROM ${TABLE} WHERE category = '식비' AND date BETWEEN $1 AND $2`,
    [from, to]
  );
  const { total, cnt, days } = rows[0];
  const perMeal = cnt > 0 ? Math.round(Number(total) / cnt) : 0;
  const perDay = days > 0 ? Math.round(Number(total) / days) : 0;
  return {
    intent: 'foodAverage',
    summary:
      `식비 평균은 건당 ${won(perMeal)}, 하루 ${won(perDay)}이에요. ` +
      `(총 ${won(total)}, ${cnt}건, ${days}일)`,
    details: { perMeal, perDay, total: Number(total), count: cnt, days },
  };
}

async function handleWeekdayVsWeekend({ from, to }) {
  const { rows } = await q(
    `SELECT
        COALESCE(SUM(amount) FILTER (WHERE EXTRACT(DOW FROM date) IN (0,6)), 0)::bigint AS weekend,
        COALESCE(SUM(amount) FILTER (WHERE EXTRACT(DOW FROM date) NOT IN (0,6)), 0)::bigint AS weekday,
        COUNT(*) FILTER (WHERE EXTRACT(DOW FROM date) IN (0,6))::int     AS weekend_cnt,
        COUNT(*) FILTER (WHERE EXTRACT(DOW FROM date) NOT IN (0,6))::int AS weekday_cnt
      FROM ${TABLE}
      WHERE date BETWEEN $1 AND $2`,
    [from, to]
  );
  const r = rows[0];
  const weekday = Number(r.weekday);
  const weekend = Number(r.weekend);
  const total = weekday + weekend;
  const wdPct = total ? Math.round((weekday / total) * 100) : 0;
  const weEffective = 100 - wdPct;
  return {
    intent: 'weekdayVsWeekend',
    summary:
      `주중(평일)은 ${won(weekday)} (${wdPct}%), ` +
      `주말은 ${won(weekend)} (${weEffective}%) 썼어요. ` +
      `거래 건수는 평일 ${r.weekday_cnt}건, 주말 ${r.weekend_cnt}건이에요.`,
    details: {
      weekday,
      weekend,
      weekdayCount: r.weekday_cnt,
      weekendCount: r.weekend_cnt,
      weekdayPercent: wdPct,
      weekendPercent: weEffective,
    },
  };
}

async function handleHalfMonth({ from, to }) {
  const { rows } = await q(
    `SELECT
        COALESCE(SUM(amount) FILTER (WHERE EXTRACT(DAY FROM date) <= 15), 0)::bigint AS first_half,
        COALESCE(SUM(amount) FILTER (WHERE EXTRACT(DAY FROM date) >= 16), 0)::bigint AS second_half,
        COUNT(*) FILTER (WHERE EXTRACT(DAY FROM date) <= 15)::int AS first_cnt,
        COUNT(*) FILTER (WHERE EXTRACT(DAY FROM date) >= 16)::int AS second_cnt
      FROM ${TABLE}
      WHERE date BETWEEN $1 AND $2`,
    [from, to]
  );
  const r = rows[0];
  const fh = Number(r.first_half);
  const sh = Number(r.second_half);
  const total = fh + sh;
  const fhPct = total ? Math.round((fh / total) * 100) : 0;
  const shPct = 100 - fhPct;
  return {
    intent: 'halfMonth',
    summary:
      `상반월(1~15일) ${won(fh)} (${fhPct}%), ` +
      `하반월(16~말일) ${won(sh)} (${shPct}%) 썼어요. ` +
      `건수는 상반월 ${r.first_cnt}건, 하반월 ${r.second_cnt}건이에요.`,
    details: {
      firstHalf: fh,
      secondHalf: sh,
      firstHalfCount: r.first_cnt,
      secondHalfCount: r.second_cnt,
      firstHalfPercent: fhPct,
      secondHalfPercent: shPct,
    },
  };
}

async function handleCategoryBreakdown({ from, to }) {
  const { rows } = await q(
    `SELECT category,
            COALESCE(SUM(amount),0)::bigint AS total,
            COUNT(*)::int                   AS cnt
       FROM ${TABLE}
      WHERE date BETWEEN $1 AND $2
      GROUP BY category
      ORDER BY total DESC`,
    [from, to]
  );
  const totalAll = rows.reduce((acc, r) => acc + Number(r.total), 0);
  const breakdown = rows.map((r) => {
    const amount = Number(r.total);
    const percent = totalAll ? Math.round((amount / totalAll) * 100) : 0;
    return { category: r.category, amount, percent, count: r.cnt };
  });
  const parts = breakdown.map((b) => `${b.category} ${won(b.amount)}(${b.percent}%)`).join(', ');
  return {
    intent: 'categoryBreakdown',
    summary: `카테고리별 지출 비율이에요. 총 ${won(totalAll)} 중 — ${parts}`,
    details: { total: totalAll, breakdown },
  };
}

async function handleCategoryTop({ from, to }) {
  const { rows } = await q(
    `SELECT category, COALESCE(SUM(amount),0)::bigint AS total, COUNT(*)::int AS cnt
       FROM ${TABLE}
      WHERE date BETWEEN $1 AND $2
      GROUP BY category
      ORDER BY total DESC
      LIMIT 1`,
    [from, to]
  );
  if (!rows.length) {
    return { intent: 'categoryTop', summary: '아직 지출 기록이 없어요.', details: null };
  }
  const { category, total, cnt } = rows[0];
  return {
    intent: 'categoryTop',
    summary: `가장 많이 쓴 카테고리는 ${category}이고, 총 ${won(total)} (${cnt}건) 썼어요.`,
    details: { category, total: Number(total), count: cnt },
  };
}

async function handleCategorySpecific(category, { from, to }) {
  const { rows: totRows } = await q(
    `SELECT COALESCE(SUM(amount),0)::bigint AS total, COUNT(*)::int AS cnt
       FROM ${TABLE} WHERE category = $1 AND date BETWEEN $2 AND $3`,
    [category, from, to]
  );
  const { total, cnt } = totRows[0];
  if (Number(total) === 0) {
    return {
      intent: 'categorySpecific',
      summary: `${category} 지출 기록이 아직 없어요.`,
      details: { category, total: 0, count: 0, top: [] },
    };
  }
  const { rows: topRows } = await q(
    `SELECT id, date, description, amount
       FROM ${TABLE}
      WHERE category = $1 AND date BETWEEN $2 AND $3
      ORDER BY amount DESC, date DESC
      LIMIT 3`,
    [category, from, to]
  );
  const topStr = topRows
    .map((r, i) => `${i + 1}) ${r.description} ${won(r.amount)}`)
    .join(', ');
  return {
    intent: 'categorySpecific',
    summary:
      `${category}는 총 ${won(total)} (${cnt}건)이에요. 가장 큰 지출 TOP 3: ${topStr}`,
    details: { category, total: Number(total), count: cnt, top: topRows },
  };
}

async function handleMaxSingle({ from, to }) {
  const { rows } = await q(
    `SELECT id, date, category, description, amount
       FROM ${TABLE}
      WHERE date BETWEEN $1 AND $2
      ORDER BY amount DESC, date DESC
      LIMIT 1`,
    [from, to]
  );
  if (!rows.length) {
    return { intent: 'maxSingle', summary: '아직 지출 기록이 없어요.', details: null };
  }
  const r = rows[0];
  const dateStr = String(r.date);
  return {
    intent: 'maxSingle',
    summary: `가장 비싼 지출은 ${dateStr} ${r.category} - ${r.description}, ${won(r.amount)}이에요.`,
    details: { ...r, date: dateStr },
  };
}

async function handleOverHundredK({ from, to }) {
  const { rows } = await q(
    `SELECT id, date, category, description, amount
       FROM ${TABLE}
      WHERE amount > 100000 AND date BETWEEN $1 AND $2
      ORDER BY amount DESC, date DESC`,
    [from, to]
  );
  if (!rows.length) {
    return {
      intent: 'overHundredK',
      summary: '10만원이 넘는 지출은 없어요.',
      details: { count: 0, items: [] },
    };
  }
  const items = rows.map((r) => ({ ...r, date: String(r.date) }));
  const listStr = items
    .map((r) => `${r.date} ${r.category} ${r.description} ${won(r.amount)}`)
    .join(' / ');
  return {
    intent: 'overHundredK',
    summary: `10만원이 넘는 지출은 총 ${items.length}건이에요 — ${listStr}`,
    details: { count: items.length, items },
  };
}

async function handleFrequentPlaces({ from, to }) {
  const { rows } = await q(
    `SELECT description,
            COUNT(*)::int                   AS cnt,
            COALESCE(SUM(amount),0)::bigint AS total
       FROM ${TABLE}
      WHERE date BETWEEN $1 AND $2
      GROUP BY description
      ORDER BY cnt DESC, total DESC
      LIMIT 3`,
    [from, to]
  );
  if (!rows.length) {
    return { intent: 'frequentPlaces', summary: '아직 기록이 없어요.', details: { top: [] } };
  }
  const top = rows.map((r) => ({ description: r.description, count: r.cnt, total: Number(r.total) }));
  const listStr = top
    .map((t, i) => `${i + 1}) ${t.description} (${t.count}회, ${won(t.total)})`)
    .join(', ');
  return {
    intent: 'frequentPlaces',
    summary: `자주 가는 곳 TOP 3: ${listStr}`,
    details: { top },
  };
}

// Weekday breakdown — ISODOW: 1=Mon .. 7=Sun
const DOW_KO = { 1: '월', 2: '화', 3: '수', 4: '목', 5: '금', 6: '토', 7: '일' };

async function handleWeekdayBreakdown({ from, to }) {
  const { rows } = await q(
    `SELECT EXTRACT(ISODOW FROM date)::int AS dow,
            COALESCE(SUM(amount),0)::bigint AS total,
            COUNT(*)::int                    AS count
       FROM ${TABLE}
      WHERE date BETWEEN $1 AND $2
      GROUP BY dow
      ORDER BY dow`,
    [from, to]
  );
  const byDow = new Map(rows.map((r) => [Number(r.dow), r]));
  const breakdown = [];
  for (let dow = 1; dow <= 7; dow++) {
    const r = byDow.get(dow);
    breakdown.push({
      day: DOW_KO[dow],
      dow,
      total: r ? Number(r.total) : 0,
      count: r ? Number(r.count) : 0,
    });
  }
  const inline = breakdown
    .map((b) => `${b.day} ${won(b.total)}(${b.count}건)`)
    .join(', ');
  return {
    intent: 'weekdayBreakdown',
    summary: `요일별 지출 — ${inline}`,
    details: { breakdown },
  };
}

function handleFallback() {
  return {
    intent: 'fallback',
    summary:
      '아직 그 질문은 답변할 수 없어요. 이런 질문들을 해보세요: ' +
      '"이번달 얼마 썼어?", "오늘 지출 얼마야?", "이번주 vs 지난주", ' +
      '"식비 총 얼마야?", "식비가 가장 많은 날은?", "카테고리 비율 알려줘", ' +
      '"가장 비싼 지출은?", "10만원 넘는 지출 보여줘", "자주 가는 곳은?", "요일별 지출 보여줘"',
    details: {
      examples: [
        '이번달 얼마 썼어?',
        '오늘 지출 얼마야?',
        '이번주 vs 지난주',
        '하루 평균 얼마야?',
        '식비 총 얼마야?',
        '식비가 가장 많은 날은?',
        '주중 vs 주말 지출',
        '상반월 vs 하반월',
        '카테고리 비율 알려줘',
        '가장 많이 쓴 카테고리는?',
        '교통비 얼마 썼어?',
        '가장 비싼 지출은?',
        '10만원 넘는 지출 보여줘',
        '자주 가는 곳은?',
        '요일별 지출 보여줘',
        '4월 10일부터 4월 15일까지 얼마 썼어?',
      ],
    },
  };
}

// --- Shared /api/ask handler ------------------------------------------------
async function askHandler(req, res) {
  try {
    const body = req.body || {};
    const question = typeof body.question === 'string' ? body.question : '';
    if (!question.trim()) {
      return res.status(400).json({ success: false, message: 'question이 필요합니다.' });
    }

    // Resolve the effective date range.
    let range;
    try {
      range = await resolveRange(body, question);
    } catch (err) {
      if (err && err.status === 400) {
        return res.status(400).json({ success: false, message: err.message });
      }
      throw err;
    }

    const cls = classifyIntent(question);
    const rangeArg = { from: range.from, to: range.to, source: range.source };

    let data;
    switch (cls.intent) {
      case 'total':              data = await handleTotal(rangeArg); break;
      case 'today':              data = await handleToday(rangeArg); break;
      case 'thisWeek':           data = await handleThisWeek(rangeArg); break;
      case 'lastWeek':           data = await handleLastWeek(rangeArg); break;
      case 'weekCompare':        data = await handleWeekCompare(rangeArg); break;
      case 'dailyAverage':       data = await handleDailyAverage(rangeArg); break;
      case 'foodTopDay':         data = await handleFoodTopDay(rangeArg); break;
      case 'foodTotal':          data = await handleFoodTotal(rangeArg); break;
      case 'foodAverage':        data = await handleFoodAverage(rangeArg); break;
      case 'weekdayVsWeekend':   data = await handleWeekdayVsWeekend(rangeArg); break;
      case 'halfMonth':          data = await handleHalfMonth(rangeArg); break;
      case 'categoryBreakdown':  data = await handleCategoryBreakdown(rangeArg); break;
      case 'categoryTop':        data = await handleCategoryTop(rangeArg); break;
      case 'categorySpecific':   data = await handleCategorySpecific(cls.category, rangeArg); break;
      case 'maxSingle':          data = await handleMaxSingle(rangeArg); break;
      case 'overHundredK':       data = await handleOverHundredK(rangeArg); break;
      case 'frequentPlaces':     data = await handleFrequentPlaces(rangeArg); break;
      case 'weekdayBreakdown':   data = await handleWeekdayBreakdown(rangeArg); break;
      default:                   data = handleFallback();
    }

    // If range came from the question and we fell back to the generic total
    // summary, prepend the Korean range prefix for clarity.
    if (range.source === 'question' && data && data.intent === 'total' && data.summary) {
      const prefix = formatRangeKorean(range.from, range.to);
      data = { ...data, summary: `${prefix} 동안 ${data.summary}` };
    }

    // Attach range to every successful response.
    data = { ...data, range };

    res.json({ success: true, data });
  } catch (err) {
    const e = pgError('POST /api/ask', err);
    res.status(500).json({ success: false, message: e.message, code: e.code });
  }
}

// Primary endpoint + backwards-compatible alias
app.post('/api/ask', askHandler);
app.post('/api/analyze', askHandler);

// ---------------------------------------------------------------------------
// Static fallback (Express 5 wildcard syntax)
// ---------------------------------------------------------------------------
app.get('/{*splat}', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ---------------------------------------------------------------------------
// Error handler
// ---------------------------------------------------------------------------
app.use((err, _req, res, _next) => {
  console.error('[unhandled]', err && (err.code || err.name || 'error'));
  if (res.headersSent) return;
  res.status(500).json({ success: false, message: 'Internal server error' });
});

// ---------------------------------------------------------------------------
// Dual-mode: listen locally, export for serverless
// ---------------------------------------------------------------------------
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Budget analyzer server running on http://localhost:${PORT}`);
  });
}

module.exports = app;
