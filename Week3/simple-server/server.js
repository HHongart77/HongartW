const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = 3000;

// secret.txt에서 비밀번호 읽기
function getSecret() {
  const filePath = path.join(__dirname, "secret.txt");
  return fs.readFileSync(filePath, "utf-8").trim();
}

function serveFile(res, filePath, contentType) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not Found");
      return;
    }
    res.writeHead(200, { "Content-Type": contentType });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  // POST /api/check-password
  if (req.method === "POST" && req.url === "/api/check-password") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        const { password } = JSON.parse(body);
        const secret = getSecret();

        if (password === secret) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            success: true,
            message: "축하합니다! 비밀 메시지를 발견했습니다.\n\n이것은 숨겨진 보물 같은 메시지입니다.\n당신은 진정한 탐험가입니다! 🎉",
          }));
        } else {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            success: false,
            message: "비밀번호가 틀렸습니다. 다시 시도해주세요.",
          }));
        }
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: false, message: "잘못된 요청입니다." }));
      }
    });
    return;
  }

  // GET / → index.html
  if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
    serveFile(res, path.join(__dirname, "index.html"), "text/html");
    return;
  }

  // 404
  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not Found");
});

server.listen(PORT, () => {
  console.log(`서버 실행 중: http://localhost:${PORT}`);
});
