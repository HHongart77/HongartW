const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = 3000;

// ========================================
// 포켓몬 데이터
// ========================================
const POKEMON_DATA = [
  {
    id: 1,
    name: "이상해씨",
    nameEn: "Bulbasaur",
    types: ["풀", "독"],
    height: 0.7,
    weight: 6.9,
    hp: 45,
    attack: 49,
    defense: 49,
    speed: 45,
    description:
      "태어나서부터 등에 식물의 씨앗이 있으며, 씨앗은 몸과 함께 조금씩 자란다.",
    image:
      "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/1.png",
    color: "from-green-400 to-green-600",
    typeBg: ["bg-green-500", "bg-purple-500"],
  },
  {
    id: 4,
    name: "파이리",
    nameEn: "Charmander",
    types: ["불꽃"],
    height: 0.6,
    weight: 8.5,
    hp: 39,
    attack: 52,
    defense: 43,
    speed: 65,
    description:
      "꼬리에 타오르는 불꽃은 생명력의 상징이다. 기운이 넘치면 불꽃이 밝게 타오른다.",
    image:
      "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/4.png",
    color: "from-orange-400 to-red-500",
    typeBg: ["bg-red-500"],
  },
  {
    id: 7,
    name: "꼬부기",
    nameEn: "Squirtle",
    types: ["물"],
    height: 0.5,
    weight: 9.0,
    hp: 44,
    attack: 48,
    defense: 65,
    speed: 43,
    description: "긴 목을 등껍질 속에 넣으면 세찬 물대포를 발사한다.",
    image:
      "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/7.png",
    color: "from-blue-400 to-blue-600",
    typeBg: ["bg-blue-500"],
  },
  {
    id: 25,
    name: "피카츄",
    nameEn: "Pikachu",
    types: ["전기"],
    height: 0.4,
    weight: 6.0,
    hp: 35,
    attack: 55,
    defense: 40,
    speed: 90,
    description:
      "양 볼에 작은 전기 주머니가 있다. 위험을 느끼면 전기를 발산한다.",
    image:
      "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/25.png",
    color: "from-yellow-300 to-yellow-500",
    typeBg: ["bg-yellow-500"],
  },
  {
    id: 39,
    name: "푸린",
    nameEn: "Jigglypuff",
    types: ["노말", "페어리"],
    height: 0.5,
    weight: 5.5,
    hp: 115,
    attack: 45,
    defense: 20,
    speed: 20,
    description:
      "크고 둥근 눈으로 상대를 바라보며 자장가를 불러 잠들게 한다.",
    image:
      "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/39.png",
    color: "from-pink-300 to-pink-500",
    typeBg: ["bg-gray-400", "bg-pink-400"],
  },
];

// ========================================
// MIME 타입 맵
// ========================================
const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
};

// ========================================
// 서버 생성
// ========================================
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  // CORS 헤더
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // ========================================
  // API 라우트
  // ========================================

  // GET /api/pokemon - 전체 목록 (검색 쿼리 지원)
  if (pathname === "/api/pokemon" && req.method === "GET") {
    const query = url.searchParams.get("q");
    let results = POKEMON_DATA;

    if (query) {
      const q = query.trim().toLowerCase();
      results = POKEMON_DATA.filter(
        (p) =>
          p.name.includes(q) ||
          p.nameEn.toLowerCase().includes(q) ||
          String(p.id) === q
      );
    }

    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(results));
    return;
  }

  // GET /api/pokemon/:id - 개별 포켓몬
  const idMatch = pathname.match(/^\/api\/pokemon\/(\d+)$/);
  if (idMatch && req.method === "GET") {
    const id = parseInt(idMatch[1], 10);
    const pokemon = POKEMON_DATA.find((p) => p.id === id);

    if (pokemon) {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(pokemon));
    } else {
      res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "포켓몬을 찾을 수 없습니다." }));
    }
    return;
  }

  // ========================================
  // 정적 파일 서빙
  // ========================================
  let filePath = pathname === "/" ? "/index.html" : pathname;
  filePath = path.join(__dirname, filePath);

  const ext = path.extname(filePath);
  const contentType = MIME_TYPES[ext] || "application/octet-stream";

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("404 Not Found");
      return;
    }
    res.writeHead(200, { "Content-Type": contentType });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`포켓몬 도감 서버가 http://localhost:${PORT} 에서 실행 중입니다.`);
  console.log("");
  console.log("API 엔드포인트:");
  console.log(`  GET /api/pokemon        - 전체 포켓몬 목록`);
  console.log(`  GET /api/pokemon?q=검색어 - 포켓몬 검색`);
  console.log(`  GET /api/pokemon/:id    - 개별 포켓몬 조회`);
});
