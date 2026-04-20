require('dotenv').config();
const { Client } = require('pg');

const connectionString = (process.env.DATABASE_URL || '').trim();
if (!connectionString) {
  console.error('❌ DATABASE_URL is not set. Add it to .env and retry.');
  process.exit(1);
}

const TRANSACTIONS = [
  ['2026-04-01', '식비',     8500,  '편의점 도시락'],
  ['2026-04-01', '교통',     1450,  '지하철'],
  ['2026-04-02', '식비',     12000, '김밥천국 점심'],
  ['2026-04-02', '문화생활', 14000, '영화표'],
  ['2026-04-03', '쇼핑',     48000, '티셔츠 2장'],
  ['2026-04-03', '식비',     6200,  '아메리카노 2잔'],
  ['2026-04-04', '식비',     32000, '주말 외식 저녁'],
  ['2026-04-04', '교통',     12800, '택시'],
  ['2026-04-05', '식비',     18500, '브런치 카페'],
  ['2026-04-05', '생활용품', 9900,  '샴푸'],
  ['2026-04-06', '식비',     7500,  '편의점 점심'],
  ['2026-04-06', '교통',     1450,  '지하철'],
  ['2026-04-07', '식비',     9800,  '회사 근처 백반'],
  ['2026-04-07', '의료',     15000, '감기약'],
  ['2026-04-08', '식비',     11200, '돈까스'],
  ['2026-04-08', '쇼핑',     25900, '무선이어폰 케이스'],
  ['2026-04-09', '식비',     4800,  '빵집'],
  ['2026-04-09', '교통',     2900,  '버스+지하철'],
  ['2026-04-10', '식비',     45000, '동료 저녁 회식'],
  ['2026-04-11', '식비',     58000, '주말 삼겹살'],
  ['2026-04-11', '문화생활', 22000, '전시회'],
  ['2026-04-12', '식비',     16500, '브런치'],
  ['2026-04-12', '쇼핑',     89000, '운동화'],
  ['2026-04-13', '식비',     8900,  '점심 도시락'],
  ['2026-04-13', '교통',     1450,  '지하철'],
  ['2026-04-14', '식비',     10500, '포장 초밥'],
  ['2026-04-14', '생활용품', 14300, '세제/휴지'],
  ['2026-04-15', '식비',     7200,  '편의점'],
  ['2026-04-15', '의료',     8000,  '영양제'],
  ['2026-04-16', '식비',     12900, '직장 근처 분식'],
  ['2026-04-16', '교통',     9800,  '택시'],
  ['2026-04-17', '식비',     6500,  '커피+샌드위치'],
  ['2026-04-17', '쇼핑',     34500, '책 3권'],
  ['2026-04-18', '식비',     62000, '주말 가족 외식'],
  ['2026-04-18', '문화생활', 18000, '노래방'],
  ['2026-04-19', '식비',     21000, '주말 브런치'],
  ['2026-04-19', '교통',     3200,  '버스 왕복'],
  ['2026-04-19', '기타',     5000,  '후원금'],
  ['2026-04-20', '식비',     9800,  '점심 국밥'],
  ['2026-04-20', '교통',     1450,  '지하철'],
  ['2026-04-20', '생활용품', 7400,  '수건'],
];

(async () => {
  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
  await client.connect();
  console.log('✅ Connected');

  console.log('🔨 CREATE TABLE 가계부_앱_transactions');
  await client.query(`
    CREATE TABLE IF NOT EXISTS "가계부_앱_transactions" (
      id          BIGSERIAL PRIMARY KEY,
      date        DATE NOT NULL,
      category    TEXT NOT NULL,
      description TEXT NOT NULL,
      amount      INTEGER NOT NULL CHECK (amount >= 0),
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await client.query(`CREATE INDEX IF NOT EXISTS "가계부_앱_transactions_date_idx" ON "가계부_앱_transactions" (date DESC)`);
  await client.query(`CREATE INDEX IF NOT EXISTS "가계부_앱_transactions_category_idx" ON "가계부_앱_transactions" (category)`);

  const before = await client.query(`SELECT COUNT(*)::int AS n FROM "가계부_앱_transactions"`);
  console.log(`📊 기존 레코드 수: ${before.rows[0].n}`);

  if (before.rows[0].n === 0) {
    console.log(`🌱 시드 ${TRANSACTIONS.length}건 INSERT`);
    const values = [];
    const params = [];
    TRANSACTIONS.forEach(([d, c, a, desc], i) => {
      const b = i * 4;
      values.push(`($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4})`);
      params.push(d, c, a, desc);
    });
    await client.query(
      `INSERT INTO "가계부_앱_transactions" (date, category, amount, description) VALUES ${values.join(',')}`,
      params
    );
  } else {
    console.log('⚠️ 이미 데이터 있음 — 시드 건너뜀');
  }

  const sample = await client.query(
    `SELECT id, date, category, amount, description FROM "가계부_앱_transactions" ORDER BY date DESC, id DESC LIMIT 10`
  );
  console.log(`\n━━━ 최근 10건 샘플 ━━━`);
  console.table(sample.rows);

  const total = await client.query(
    `SELECT COUNT(*)::int AS n, SUM(amount)::int AS total FROM "가계부_앱_transactions"`
  );
  console.log(`\n✅ 최종: ${total.rows[0].n}건 · 합계 ${total.rows[0].total.toLocaleString('ko-KR')}원`);

  await client.end();
})().catch(err => {
  console.error('❌', err);
  process.exit(1);
});
