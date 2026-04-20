const BASE = 'http://127.0.0.1:4800';

async function ask(body) {
  const r = await fetch(`${BASE}/api/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = await r.json();
  return { status: r.status, ...j };
}

function line(title) { console.log('\n━━━', title); }

(async () => {
  // Intent tests — default range (whole seed)
  const cases = [
    ['이번달 얼마 썼어?',            'total'],
    ['카테고리별 비율',              'categoryBreakdown'],
    ['가장 많이 쓴 카테고리',        'categoryTop'],
    ['식비 가장 많은 날',            'foodTopDay'],
    ['식비 총 얼마 썼어?',           'foodTotal'],
    ['주중 vs 주말 비교',            'weekdayVsWeekend'],
    ['요일별 지출 보여줘',           'weekdayBreakdown'],
    ['상반월 vs 하반월',             'halfMonth'],
    ['가장 비싼 지출은?',            'maxSingle'],
    ['10만원 넘는 지출',             'overHundredK'],
    ['자주 가는 곳은?',              'frequentPlaces'],
    ['교통비는 얼마?',               'categorySpecific'],
  ];
  for (const [q, expected] of cases) {
    const r = await ask({ question: q });
    const ok = r.data?.intent === expected;
    console.log(`${ok ? '✅' : '❌'} "${q}" → ${r.data?.intent} (expected ${expected}) | range=${r.data?.range?.from}..${r.data?.range?.to} (${r.data?.range?.source})`);
    if (!ok) console.log('  summary:', (r.data?.summary || r.message || '').slice(0, 200));
  }

  line('날짜 범위 - 질문 파싱');
  const q1 = await ask({ question: '4월 10일부터 4월 15일까지 얼마 썼어?' });
  console.log('question:', '4월 10일부터 4월 15일까지');
  console.log('range:', q1.data?.range);
  console.log('summary:', q1.data?.summary);

  line('날짜 범위 - body 명시');
  const q2 = await ask({ question: '카테고리별 비율', from: '2026-04-01', to: '2026-04-10' });
  console.log('range:', q2.data?.range);
  console.log('summary:', q2.data?.summary?.slice(0, 260));

  line('요일별 breakdown 상세');
  const q3 = await ask({ question: '요일별' });
  console.log('summary:', q3.data?.summary);
  console.table(q3.data?.details?.breakdown);

  line('잘못된 날짜 (from > to) → 400');
  const q4 = await ask({ question: '총합', from: '2026-04-15', to: '2026-04-01' });
  console.log('status:', q4.status, 'success:', q4.success, 'message:', q4.message);

  line('fallback (이상한 질문)');
  const q5 = await ask({ question: '외계인이 나타나면?' });
  console.log('intent:', q5.data?.intent);
  console.log('summary:', q5.data?.summary?.slice(0, 160));

  line('CORS preflight 체크');
  const pf = await fetch(`${BASE}/api/ask`, {
    method: 'OPTIONS',
    headers: {
      'Origin': 'http://example.com',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type',
    },
  });
  console.log('status:', pf.status);
  console.log('ACAO:', pf.headers.get('access-control-allow-origin'));
  console.log('ACAM:', pf.headers.get('access-control-allow-methods'));

  line('alias /api/analyze 동일 응답');
  const a1 = await (await fetch(`${BASE}/api/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question: '이번달 얼마 썼어?' }),
  })).json();
  console.log('intent via alias:', a1.data?.intent, '| summary match:', a1.data?.summary?.slice(0, 80));
})().catch(e => { console.error('❌', e); process.exit(1); });
