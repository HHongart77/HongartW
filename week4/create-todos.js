const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'my-data', 'todos.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS todos (
    id INTEGER PRIMARY KEY,
    task TEXT NOT NULL,
    done INTEGER NOT NULL DEFAULT 0
  )
`);

const insert = db.prepare('INSERT INTO todos (id, task, done) VALUES (?, ?, ?)');

const todos = [
  { id: 1, task: '장보기 - 우유, 계란, 빵 구매하기', done: 0 },
  { id: 2, task: '운동하기 - 30분 달리기', done: 0 },
  { id: 3, task: '코드 리뷰 완료하기', done: 0 },
  { id: 4, task: '독서 - 책 50페이지 읽기', done: 0 },
  { id: 5, task: '이메일 답장 보내기', done: 0 },
];

for (const todo of todos) {
  insert.run(todo.id, todo.task, todo.done);
}

const rows = db.prepare('SELECT * FROM todos').all();
console.log('생성된 todos:');
rows.forEach(r => console.log(`  [${r.id}] ${r.task} (done: ${r.done})`));

db.close();
