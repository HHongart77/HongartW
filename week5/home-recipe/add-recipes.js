const { Client } = require('pg');
const client = new Client({
  connectionString: 'postgresql://postgres.wdohgoccwlrkroaxkuue:VY3el1bEQOf7Fgf7@aws-1-us-east-1.pooler.supabase.com:6543/postgres',
  ssl: { rejectUnauthorized: false }
});

async function run() {
  await client.connect();

  // 쌀 재료 없으면 추가 (김치 리조또용)
  await client.query(`
    INSERT INTO ingredients (name, category_id) VALUES ('쌀', 5)
    ON CONFLICT (name) DO NOTHING
  `);

  // 레시피 삽입
  const { rows: r1 } = await client.query(`
    INSERT INTO recipes (name, emoji, time_minutes, difficulty)
    VALUES ('두부김치', '🥢', 20, '쉬움')
    RETURNING id
  `);
  const { rows: r2 } = await client.query(`
    INSERT INTO recipes (name, emoji, time_minutes, difficulty)
    VALUES ('김치 리조또', '🍚', 35, '보통')
    RETURNING id
  `);

  const id1 = r1[0].id;
  const id2 = r2[0].id;
  console.log(`두부김치 id: ${id1}, 김치 리조또 id: ${id2}`);

  // 재료 연결
  await client.query(`
    INSERT INTO recipe_ingredients (recipe_id, ingredient_id)
    SELECT $1, i.id FROM ingredients i
    WHERE i.name = ANY($2::text[])
  `, [id1, ['두부', '김치', '돼지고기', '파', '마늘', '참기름', '간장', '고춧가루']]);

  await client.query(`
    INSERT INTO recipe_ingredients (recipe_id, ingredient_id)
    SELECT $1, i.id FROM ingredients i
    WHERE i.name = ANY($2::text[])
  `, [id2, ['쌀', '김치', '양파', '마늘', '버터', '치즈', '간장', '올리브오일']]);

  // 조리 단계 — 두부김치
  const steps1 = [
    '두부를 1cm 두께로 썰어 키친타월로 물기를 제거합니다.',
    '팬에 기름을 두르고 두부를 앞뒤로 노릇하게 구워 그릇에 담아둡니다.',
    '같은 팬에 돼지고기를 볶다가 잘게 썬 김치와 마늘을 넣고 함께 볶습니다.',
    '간장과 고춧가루로 간을 맞추고 센 불에서 수분을 날립니다.',
    '구운 두부 위에 볶은 김치를 올리고 참기름·파를 뿌려 완성합니다.'
  ];
  // 조리 단계 — 김치 리조또
  const steps2 = [
    '쌀을 씻어 30분 불린 뒤 물기를 뺍니다.',
    '팬에 올리브오일과 버터를 두르고 양파와 마늘을 투명해질 때까지 볶습니다.',
    '김치를 잘게 썰어 넣고 함께 볶아 김치 향을 충분히 냅니다.',
    '불린 쌀을 넣고 볶다가 뜨거운 물(또는 육수)을 한 국자씩 넣어가며 20분간 저어 익힙니다.',
    '쌀이 알단테로 익으면 치즈를 갈아 넣고 간장으로 간을 맞춰 크리미하게 마무리합니다.'
  ];

  for (const [rid, steps] of [[id1, steps1], [id2, steps2]]) {
    for (let i = 0; i < steps.length; i++) {
      await client.query(
        'INSERT INTO recipe_steps (recipe_id, step_order, description) VALUES ($1, $2, $3)',
        [rid, i + 1, steps[i]]
      );
    }
  }

  console.log('✅ 두부김치, 김치 리조또 추가 완료');
  await client.end();
}

run().catch(e => { console.error('❌', e.message); process.exit(1); });
