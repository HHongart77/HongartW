// Demo data seeder — 40대 직장인 남성, 4인 가족 기준 (4월 2026).
// Skips if transactions already exist (safe to re-run).
//
// Usage: node seed.js   (reads DATABASE_URL from .env)
// To reset:  TRUNCATE transactions RESTART IDENTITY;  then re-run.

try { require('dotenv').config(); } catch (_e) {}

const { Pool } = require('pg');

const connectionString = (process.env.DATABASE_URL || '').trim();
if (!connectionString) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
});

// 4월 2026 — 40대 차장급 직장인, 4인 가족(자녀 1, 부모 봉양) 시나리오.
// 의도적으로 지출 > 수입 → 잔액 마이너스.
const DEMO = [
  // ───── 수입 ─────
  { date: '2026-04-01', type: 'income',  category: '기타',     amount:  200000, memo: '분기 인센티브' },
  { date: '2026-04-10', type: 'income',  category: '용돈',     amount:   50000, memo: '부모님 용돈' },
  { date: '2026-04-25', type: 'income',  category: '급여',     amount: 3200000, memo: '4월 급여' },

  // ───── 주거 (월 고정비) ─────
  { date: '2026-04-05', type: 'expense', category: '주거',     amount:  850000, memo: '월세' },
  { date: '2026-04-10', type: 'expense', category: '주거',     amount:  285000, memo: '아파트 관리비' },
  { date: '2026-04-15', type: 'expense', category: '주거',     amount:   95000, memo: '통신비 (인터넷+휴대폰)' },

  // ───── 식비 (점심·회식·가족외식·카페) ─────
  { date: '2026-04-02', type: 'expense', category: '식비',     amount:  110000, memo: '팀 회식 (삼겹살)' },
  { date: '2026-04-03', type: 'expense', category: '식비',     amount:   13000, memo: '점심 (구내식당)' },
  { date: '2026-04-06', type: 'expense', category: '식비',     amount:   12000, memo: '점심 (김밥천국)' },
  { date: '2026-04-08', type: 'expense', category: '식비',     amount:   98000, memo: '주간 장보기' },
  { date: '2026-04-09', type: 'expense', category: '식비',     amount:    5500, memo: '아아 한 잔' },
  { date: '2026-04-12', type: 'expense', category: '식비',     amount:  145000, memo: '부모님 모시고 한정식' },
  { date: '2026-04-18', type: 'expense', category: '식비',     amount:   88000, memo: '입사동기 술자리' },
  { date: '2026-04-21', type: 'expense', category: '식비',     amount:   13000, memo: '점심 (샐러드)' },
  { date: '2026-04-23', type: 'expense', category: '식비',     amount:    6500, memo: '스타벅스' },
  { date: '2026-04-26', type: 'expense', category: '식비',     amount:   95000, memo: '주말 가족 외식' },

  // ───── 교통 (보험·주유·통행료) ─────
  { date: '2026-04-06', type: 'expense', category: '교통',     amount:  580000, memo: '자동차 보험료 갱신' },
  { date: '2026-04-08', type: 'expense', category: '교통',     amount:   18000, memo: '고속도로 통행료' },
  { date: '2026-04-11', type: 'expense', category: '교통',     amount:   32000, memo: '택시 + 버스' },
  { date: '2026-04-15', type: 'expense', category: '교통',     amount:   95000, memo: '셀프 주유' },
  { date: '2026-04-22', type: 'expense', category: '교통',     amount:   80000, memo: '주유' },

  // ───── 의료 ─────
  { date: '2026-04-17', type: 'expense', category: '의료',     amount:   28000, memo: '병원 진료' },
  { date: '2026-04-20', type: 'expense', category: '의료',     amount:  180000, memo: '건강검진 추가검사' },

  // ───── 문화생활 ─────
  { date: '2026-04-13', type: 'expense', category: '문화생활', amount:  220000, memo: '주말 골프 라운딩' },
  { date: '2026-04-22', type: 'expense', category: '문화생활', amount:   20000, memo: '메가박스' },
  { date: '2026-04-25', type: 'expense', category: '문화생활', amount:   35000, memo: '가족 영화관람' },

  // ───── 쇼핑 (가족 위주) ─────
  { date: '2026-04-09', type: 'expense', category: '쇼핑',     amount:   95000, memo: '아들 운동화' },
  { date: '2026-04-14', type: 'expense', category: '쇼핑',     amount:  125000, memo: '봄 정장 셔츠' },
  { date: '2026-04-16', type: 'expense', category: '쇼핑',     amount:  250000, memo: '아내 결혼기념일 선물' },

  // ───── 기타 (40대 핵심: 학원·보험·경조사·적금·부모님) ─────
  { date: '2026-04-05', type: 'expense', category: '기타',     amount:  650000, memo: '자녀 학원비 (수학+영어)' },
  { date: '2026-04-11', type: 'expense', category: '기타',     amount:  180000, memo: '암보험 + 종신보험' },
  { date: '2026-04-19', type: 'expense', category: '기타',     amount:  100000, memo: '친구 결혼식 축의금' },
  { date: '2026-04-19', type: 'expense', category: '기타',     amount:   15000, memo: '편의점' },
  { date: '2026-04-25', type: 'expense', category: '기타',     amount:  300000, memo: '부모님 용돈 송금' },
  { date: '2026-04-25', type: 'expense', category: '기타',     amount:  500000, memo: '정기 적금 자동이체' },
];

(async () => {
  const client = await pool.connect();
  try {
    const { rows: existing } = await client.query('SELECT COUNT(*)::int AS n FROM transactions');
    if (existing[0].n > 0) {
      console.log(`⚠ transactions already has ${existing[0].n} rows — skipping seed.`);
      console.log('  Run TRUNCATE first if you want to reset:');
      console.log('  TRUNCATE transactions RESTART IDENTITY;');
      return;
    }

    await client.query('BEGIN');
    for (const d of DEMO) {
      const cat = await client.query(
        'SELECT id FROM categories WHERE name = $1 AND type = $2',
        [d.category, d.type]
      );
      if (cat.rows.length === 0) {
        throw new Error(`Category not found: ${d.category} (${d.type})`);
      }
      await client.query(
        `INSERT INTO transactions (type, amount, category_id, date, memo)
         VALUES ($1, $2, $3, $4, $5)`,
        [d.type, d.amount, cat.rows[0].id, d.date, d.memo]
      );
    }
    await client.query('COMMIT');

    console.log(`✓ Inserted ${DEMO.length} demo transactions.\n`);

    const sum = await client.query(`
      SELECT type, SUM(amount)::numeric(14,2) AS total, COUNT(*)::int AS n
        FROM transactions
       WHERE date >= '2026-04-01' AND date < '2026-05-01'
       GROUP BY type
       ORDER BY type
    `);
    console.log('2026-04 합계:');
    console.table(sum.rows.map(r => ({ ...r, total: Number(r.total).toLocaleString('ko-KR') })));

    const bal = await client.query(`
      SELECT
        COALESCE(SUM(CASE WHEN type='income'  THEN amount END), 0)::numeric(14,2) AS income,
        COALESCE(SUM(CASE WHEN type='expense' THEN amount END), 0)::numeric(14,2) AS expense
      FROM transactions
      WHERE date >= '2026-04-01' AND date < '2026-05-01'
    `);
    const inc = Number(bal.rows[0].income);
    const exp = Number(bal.rows[0].expense);
    console.log(`\n수입: ₩${inc.toLocaleString('ko-KR')}`);
    console.log(`지출: ₩${exp.toLocaleString('ko-KR')}`);
    console.log(`잔액: ₩${(inc - exp).toLocaleString('ko-KR')} ${inc - exp < 0 ? '(마이너스)' : ''}`);

    const byCat = await client.query(`
      SELECT c.name AS category, SUM(t.amount)::numeric(14,2) AS total, COUNT(*)::int AS n
        FROM transactions t JOIN categories c ON c.id = t.category_id
       WHERE t.date >= '2026-04-01' AND t.date < '2026-05-01' AND t.type='expense'
       GROUP BY c.name
       ORDER BY total DESC
    `);
    console.log('\n카테고리별 지출:');
    console.table(byCat.rows.map(r => ({
      category: r.category,
      n: r.n,
      total: '₩' + Number(r.total).toLocaleString('ko-KR'),
    })));
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_e) {}
    console.error('Seed failed:', err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();
