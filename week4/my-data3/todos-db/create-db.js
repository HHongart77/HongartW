const Database = require('better-sqlite3');
const db = new Database('./my-data3/todos.db');

db.exec(`
  CREATE TABLE IF NOT EXISTS todos (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    done INTEGER DEFAULT 0
  )
`);

const insert = db.prepare('INSERT INTO todos (id, title, description, done) VALUES (?, ?, ?, ?)');

const todos = [
  [1, '장보기', '우유, 달걀, 빵 구매하기', 0],
  [2, '운동하기', '30분 조깅', 0],
  [3, '책 읽기', '오늘의 챕터 완독', 0],
  [4, '코드 공부', 'Node.js fs 모듈 실습', 0],
  [5, '청소하기', '방 정리 및 청소기 돌리기', 0],
];

for (const todo of todos) insert.run(...todo);

console.log('todos.db 생성 완료!');
console.table(db.prepare('SELECT * FROM todos').all());
db.close();
