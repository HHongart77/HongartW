const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'YOUR_API_KEY_HERE';

const SYSTEM_PROMPT = `당신은 따뜻하고 공감 능력이 뛰어난 심리 상담사입니다. 이름은 "마음이"입니다.

상담 원칙:
- 내담자의 감정을 먼저 공감하고 수용합니다
- 판단하지 않고 경청합니다
- 열린 질문을 통해 내담자가 스스로 생각을 정리할 수 있도록 돕습니다
- 필요할 때 인지행동치료(CBT) 기법을 활용합니다
- 위기 상황(자해, 자살 언급)이 감지되면 즉시 전문 상담 기관(자살예방상담전화 1393, 정신건강위기상담전화 1577-0199)을 안내합니다
- 답변은 3~5문장 정도로 간결하되 따뜻하게 합니다
- 이모티콘을 적절히 사용하여 친근한 분위기를 만듭니다
- 의학적 진단이나 약물 처방은 하지 않으며, 필요시 전문가 상담을 권유합니다

첫 인사에서는 자기소개와 함께 편하게 이야기해도 된다고 안내해주세요.`;

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try { resolve(JSON.parse(body)); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

async function callOpenAI(messages) {
  const payload = JSON.stringify({
    model: 'gpt-4o-mini',
    messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages],
    temperature: 0.8,
    max_tokens: 500,
  });

  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.openai.com',
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
      },
    };

    const apiReq = require('https').request(options, (apiRes) => {
      let data = '';
      apiRes.on('data', chunk => data += chunk);
      apiRes.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.error) reject(new Error(json.error.message));
          else resolve(json.choices[0].message.content);
        } catch (e) { reject(e); }
      });
    });

    apiReq.on('error', reject);
    apiReq.write(payload);
    apiReq.end();
  });
}

const server = http.createServer(async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  // API endpoint
  if (req.method === 'POST' && req.url === '/api/chat') {
    try {
      const { messages } = await parseBody(req);
      const reply = await callOpenAI(messages);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ reply }));
    } catch (err) {
      console.error('OpenAI Error:', err.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // Static files
  let filePath = req.url === '/' ? '/index.html' : req.url;
  filePath = path.join(__dirname, filePath);
  const ext = path.extname(filePath);
  const mimeTypes = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css' };

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404);
      res.end('Not Found');
    } else {
      res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'text/plain' });
      res.end(content);
    }
  });
});

server.listen(PORT, () => {
  console.log(`🧠 마음이 심리상담 서버가 http://localhost:${PORT} 에서 실행 중입니다`);
});
