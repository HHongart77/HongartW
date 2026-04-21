const { Client } = require('pg');

const client = new Client({
  connectionString: 'postgresql://postgres.wdohgoccwlrkroaxkuue:VY3el1bEQOf7Fgf7@aws-1-us-east-1.pooler.supabase.com:6543/postgres',
  ssl: { rejectUnauthorized: false }
});

const schema = `
-- 카테고리
CREATE TABLE IF NOT EXISTS categories (
  id SERIAL PRIMARY KEY,
  name VARCHAR(50) NOT NULL,
  emoji VARCHAR(10) NOT NULL
);

-- 재료
CREATE TABLE IF NOT EXISTS ingredients (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  category_id INTEGER REFERENCES categories(id),
  emoji VARCHAR(10)
);

-- 레시피
CREATE TABLE IF NOT EXISTS recipes (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  emoji VARCHAR(10),
  time_minutes INTEGER NOT NULL,
  difficulty VARCHAR(10) CHECK (difficulty IN ('쉬움', '보통', '어려움')) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 레시피-재료 다대다
CREATE TABLE IF NOT EXISTS recipe_ingredients (
  recipe_id INTEGER REFERENCES recipes(id) ON DELETE CASCADE,
  ingredient_id INTEGER REFERENCES ingredients(id) ON DELETE CASCADE,
  amount VARCHAR(50),
  PRIMARY KEY (recipe_id, ingredient_id)
);

-- 조리 단계
CREATE TABLE IF NOT EXISTS recipe_steps (
  id SERIAL PRIMARY KEY,
  recipe_id INTEGER REFERENCES recipes(id) ON DELETE CASCADE,
  step_order INTEGER NOT NULL,
  description TEXT NOT NULL
);
`;

const demoData = `
-- 카테고리
INSERT INTO categories (name, emoji) VALUES
  ('채소', '🥬'),
  ('육류', '🥩'),
  ('해산물', '🐟'),
  ('유제품', '🧀'),
  ('곡물', '🌾'),
  ('양념', '🧂')
ON CONFLICT DO NOTHING;

-- 재료
INSERT INTO ingredients (name, category_id, emoji) VALUES
  ('양파', 1, NULL), ('당근', 1, NULL), ('감자', 1, NULL),
  ('애호박', 1, NULL), ('파', 1, NULL), ('마늘', 1, NULL),
  ('시금치', 1, NULL), ('콩나물', 1, NULL), ('토마토', 1, NULL),
  ('김치', 1, NULL), ('두부', 1, NULL), ('된장', 6, NULL),
  ('돼지고기', 2, NULL), ('소고기', 2, NULL), ('닭고기', 2, NULL),
  ('오징어', 3, NULL), ('새우', 3, NULL), ('미역', 3, NULL), ('김', 3, NULL),
  ('계란', 4, NULL), ('우유', 4, NULL), ('치즈', 4, NULL), ('버터', 4, NULL),
  ('밥', 5, NULL), ('밀가루', 5, NULL), ('파스타면', 5, NULL),
  ('간장', 6, NULL), ('참기름', 6, NULL), ('고추장', 6, NULL),
  ('고춧가루', 6, NULL), ('설탕', 6, NULL), ('소금', 6, NULL),
  ('후추', 6, NULL), ('올리브오일', 6, NULL), ('파슬리', 1, NULL)
ON CONFLICT (name) DO NOTHING;

-- 레시피
INSERT INTO recipes (id, name, emoji, time_minutes, difficulty) VALUES
  (1,  '김치찌개',     '🍲', 30, '쉬움'),
  (2,  '된장찌개',     '🥘', 25, '쉬움'),
  (3,  '계란볶음밥',   '🍳', 15, '쉬움'),
  (4,  '토마토 파스타','🍝', 25, '보통'),
  (5,  '비빔밥',       '🍚', 35, '보통'),
  (6,  '김치볶음밥',   '🌶️', 15, '쉬움'),
  (7,  '해물파전',     '🥞', 20, '보통'),
  (8,  '소고기 미역국','🍜', 40, '보통'),
  (9,  '닭볶음탕',     '🍗', 50, '어려움'),
  (10, '제육볶음',     '🥩', 25, '보통'),
  (11, '치즈 오믈렛',  '🧀', 10, '쉬움'),
  (12, '새우 마늘 볶음','🦐', 15, '쉬움')
ON CONFLICT (id) DO NOTHING;

-- 레시피-재료 연결 (ingredient name -> id 로 조인 삽입)
INSERT INTO recipe_ingredients (recipe_id, ingredient_id)
SELECT r.id, i.id FROM (VALUES
  (1,'김치'),(1,'돼지고기'),(1,'두부'),(1,'파'),(1,'양파'),(1,'마늘'),(1,'고춧가루'),
  (2,'된장'),(2,'두부'),(2,'애호박'),(2,'감자'),(2,'양파'),(2,'파'),(2,'마늘'),
  (3,'밥'),(3,'계란'),(3,'양파'),(3,'당근'),(3,'파'),(3,'간장'),(3,'참기름'),
  (4,'파스타면'),(4,'토마토'),(4,'양파'),(4,'마늘'),(4,'올리브오일'),(4,'소금'),(4,'후추'),
  (5,'밥'),(5,'계란'),(5,'당근'),(5,'시금치'),(5,'애호박'),(5,'콩나물'),(5,'고추장'),(5,'참기름'),
  (6,'밥'),(6,'김치'),(6,'계란'),(6,'파'),(6,'참기름'),(6,'김'),
  (7,'밀가루'),(7,'파'),(7,'오징어'),(7,'새우'),(7,'계란'),(7,'소금'),
  (8,'미역'),(8,'소고기'),(8,'마늘'),(8,'간장'),(8,'참기름'),
  (9,'닭고기'),(9,'감자'),(9,'당근'),(9,'양파'),(9,'고추장'),(9,'고춧가루'),(9,'간장'),(9,'마늘'),
  (10,'돼지고기'),(10,'양파'),(10,'파'),(10,'고추장'),(10,'고춧가루'),(10,'간장'),(10,'마늘'),(10,'설탕'),
  (11,'계란'),(11,'우유'),(11,'치즈'),(11,'소금'),(11,'후추'),(11,'버터'),
  (12,'새우'),(12,'마늘'),(12,'올리브오일'),(12,'버터'),(12,'파슬리'),(12,'후추'),(12,'소금')
) AS v(rid, iname)
JOIN recipes r ON r.id = v.rid
JOIN ingredients i ON i.name = v.iname
ON CONFLICT DO NOTHING;

-- 조리 단계
INSERT INTO recipe_steps (recipe_id, step_order, description) VALUES
  (1,1,'돼지고기를 한 입 크기로 썰어 팬에 볶아 기름을 냅니다.'),
  (1,2,'잘 익은 김치를 넣고 함께 볶아 감칠맛을 더합니다.'),
  (1,3,'물을 자작하게 붓고 끓인 뒤 두부와 양파를 넣습니다.'),
  (1,4,'고춧가루와 다진 마늘로 간을 맞추고 5분간 더 끓입니다.'),
  (1,5,'마지막으로 대파를 올려 마무리합니다.'),
  (2,1,'물에 된장을 풀어 멸치육수를 만듭니다.'),
  (2,2,'감자와 양파를 먼저 넣고 끓입니다.'),
  (2,3,'애호박과 두부를 넣고 중불로 10분간 더 끓입니다.'),
  (2,4,'다진 마늘을 넣어 향을 더합니다.'),
  (2,5,'대파를 올려 구수한 맛을 살립니다.'),
  (3,1,'양파, 당근, 파를 잘게 다져 팬에 볶습니다.'),
  (3,2,'계란을 풀어 스크램블로 익힙니다.'),
  (3,3,'밥을 넣고 고루 섞으며 볶습니다.'),
  (3,4,'간장으로 간을 맞춥니다.'),
  (3,5,'마지막에 참기름을 둘러 향을 입힙니다.'),
  (4,1,'끓는 물에 소금을 넣고 파스타면을 8분간 삶습니다.'),
  (4,2,'팬에 올리브오일을 두르고 다진 마늘과 양파를 볶습니다.'),
  (4,3,'잘게 썬 토마토를 넣고 으깨며 졸입니다.'),
  (4,4,'삶은 면을 넣고 소스와 잘 버무립니다.'),
  (4,5,'소금, 후추로 간을 맞춰 완성합니다.'),
  (5,1,'당근, 애호박을 채 썰어 각각 볶습니다.'),
  (5,2,'시금치는 데쳐서 참기름과 소금으로 무칩니다.'),
  (5,3,'콩나물도 데쳐 간단히 무쳐둡니다.'),
  (5,4,'따뜻한 밥 위에 준비한 나물을 색감 있게 올립니다.'),
  (5,5,'반숙 계란과 고추장, 참기름을 올려 비벼 먹습니다.'),
  (6,1,'김치를 잘게 썰어 팬에 볶습니다.'),
  (6,2,'밥을 넣고 김치와 함께 고루 볶습니다.'),
  (6,3,'참기름으로 고소함을 더합니다.'),
  (6,4,'위에 반숙 계란프라이를 올립니다.'),
  (6,5,'김가루와 파를 뿌려 완성합니다.'),
  (7,1,'밀가루에 물과 계란을 풀어 반죽을 만듭니다.'),
  (7,2,'대파를 길게 썰어 팬에 가지런히 깔아둡니다.'),
  (7,3,'반죽을 붓고 오징어와 새우를 올립니다.'),
  (7,4,'바삭하게 앞뒤로 노릇하게 부칩니다.'),
  (7,5,'간장 소스와 함께 내어 먹습니다.'),
  (8,1,'미역을 물에 30분 불립니다.'),
  (8,2,'소고기를 참기름에 볶다가 불린 미역을 함께 볶습니다.'),
  (8,3,'물을 넉넉히 붓고 센 불에서 끓입니다.'),
  (8,4,'다진 마늘과 간장으로 간을 맞춥니다.'),
  (8,5,'중약불로 20분 이상 푹 끓여 완성합니다.'),
  (9,1,'닭고기를 끓는 물에 데쳐 기름기를 제거합니다.'),
  (9,2,'감자, 당근, 양파를 큼직하게 썹니다.'),
  (9,3,'냄비에 닭과 채소를 넣고 고추장, 고춧가루, 간장, 마늘을 넣습니다.'),
  (9,4,'물을 잠길 만큼 붓고 센 불에서 끓입니다.'),
  (9,5,'중약불로 줄여 30분간 조리며 국물을 졸입니다.'),
  (10,1,'돼지고기에 고추장, 고춧가루, 간장, 마늘, 설탕으로 양념합니다.'),
  (10,2,'양념한 고기를 30분간 재웁니다.'),
  (10,3,'달군 팬에 양파를 먼저 볶습니다.'),
  (10,4,'재운 고기를 넣고 센 불로 빠르게 볶습니다.'),
  (10,5,'대파를 올리고 한 번 더 볶아 마무리합니다.'),
  (11,1,'계란에 우유를 넣고 곱게 풀어줍니다.'),
  (11,2,'소금과 후추로 간을 합니다.'),
  (11,3,'팬에 버터를 녹이고 계란물을 붓습니다.'),
  (11,4,'반쯤 익으면 치즈를 올리고 반으로 접습니다.'),
  (11,5,'약불로 은은하게 익혀 완성합니다.'),
  (12,1,'새우는 등쪽 내장을 제거하고 깨끗이 씻습니다.'),
  (12,2,'팬에 올리브오일과 버터, 편 썬 마늘을 볶습니다.'),
  (12,3,'마늘 향이 올라오면 새우를 넣고 강불에 볶습니다.'),
  (12,4,'소금과 후추로 간을 맞춥니다.'),
  (12,5,'파슬리를 뿌려 마무리합니다.');
`;

async function run() {
  await client.connect();
  console.log('✅ DB 연결 성공');

  console.log('📦 테이블 생성 중...');
  await client.query(schema);
  console.log('✅ 테이블 생성 완료');

  console.log('🌱 데모 데이터 삽입 중...');
  await client.query(demoData);
  console.log('✅ 데모 데이터 삽입 완료');

  const { rows: cats } = await client.query('SELECT COUNT(*) FROM categories');
  const { rows: ings } = await client.query('SELECT COUNT(*) FROM ingredients');
  const { rows: recs } = await client.query('SELECT COUNT(*) FROM recipes');
  const { rows: steps } = await client.query('SELECT COUNT(*) FROM recipe_steps');

  console.log('\n📊 결과:');
  console.log(`  categories: ${cats[0].count}개`);
  console.log(`  ingredients: ${ings[0].count}개`);
  console.log(`  recipes: ${recs[0].count}개`);
  console.log(`  recipe_steps: ${steps[0].count}개`);

  await client.end();
}

run().catch(e => { console.error('❌ 오류:', e.message); process.exit(1); });
