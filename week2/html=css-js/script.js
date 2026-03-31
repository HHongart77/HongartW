// ── 1. 다크모드 토글 ──────────────────────────
const themeBtn = document.getElementById('theme-btn');
themeBtn.addEventListener('click', () => {
  document.body.classList.toggle('dark');
  themeBtn.textContent = document.body.classList.contains('dark')
    ? '☀️ 라이트모드'
    : '🌙 다크모드';
});

// ── 2. 카운터 ────────────────────────────────
let count = 0;
const display = document.getElementById('counter-display');

function bump() {
  display.classList.remove('bump');
  void display.offsetWidth; // reflow로 애니메이션 재시작
  display.classList.add('bump');
  setTimeout(() => display.classList.remove('bump'), 150);
}

document.getElementById('count-up').addEventListener('click', () => {
  count++;
  display.textContent = count;
  display.style.color = count > 0 ? '#27ae60' : count < 0 ? '#e74c3c' : '#2980b9';
  bump();
});
document.getElementById('count-down').addEventListener('click', () => {
  count--;
  display.textContent = count;
  display.style.color = count > 0 ? '#27ae60' : count < 0 ? '#e74c3c' : '#2980b9';
  bump();
});
document.getElementById('count-reset').addEventListener('click', () => {
  count = 0;
  display.textContent = count;
  display.style.color = '#2980b9';
  bump();
});

// ── 3. 랜덤 색상 박스 ────────────────────────
const colorBox = document.getElementById('color-box');
const colorLabel = document.getElementById('color-label');
colorBox.addEventListener('click', () => {
  const r = Math.floor(Math.random() * 200 + 30);
  const g = Math.floor(Math.random() * 200 + 30);
  const b = Math.floor(Math.random() * 200 + 30);
  const hex = `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}`;
  colorBox.style.backgroundColor = hex;
  colorLabel.textContent = `현재 색상: ${hex}`;
});

// ── 4. 동적 목록 추가 / 완료 / 삭제 ─────────
const list = document.getElementById('dynamic-list');
const input = document.getElementById('new-item-input');

function addItem(text) {
  const li = document.createElement('li');
  li.classList.add('fade-in');
  li.innerHTML = `<span>${text}</span><button class="del-btn">✕</button>`;
  li.querySelector('span').addEventListener('click', () => li.classList.toggle('done'));
  li.querySelector('.del-btn').addEventListener('click', () => li.remove());
  list.appendChild(li);
}

// 기존 목록 아이템에도 이벤트 바인딩
list.querySelectorAll('li').forEach(li => {
  li.querySelector('span').addEventListener('click', () => li.classList.toggle('done'));
  li.querySelector('.del-btn').addEventListener('click', () => li.remove());
});

document.getElementById('add-item-btn').addEventListener('click', () => {
  const val = input.value.trim();
  if (val) { addItem(val); input.value = ''; input.focus(); }
});
input.addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('add-item-btn').click();
});

// ── 5. 폼 유효성 검사 ────────────────────────
document.querySelector('form').addEventListener('submit', e => {
  e.preventDefault();
  const name  = document.getElementById('name').value.trim();
  const email = document.getElementById('email').value.trim();
  const result = document.getElementById('form-result');

  if (!name || !email) {
    result.textContent = '⚠️ 이름과 이메일을 입력해주세요.';
    result.className = 'error';
  } else {
    result.textContent = `✅ ${name}님, 제출 완료! (${email})`;
    result.className = 'success';
  }
  result.style.display = 'block';
});

// ── 6. 타이핑 애니메이션 ─────────────────────
const messages = [
  'HTML로 구조를 만들고...',
  'CSS로 스타일을 입히고...',
  'JavaScript로 생명을 불어넣는다! 🚀'
];
let msgIdx = 0, charIdx = 0, isDeleting = false;
const typingEl = document.getElementById('typing-text');

function type() {
  const current = messages[msgIdx];
  typingEl.textContent = isDeleting
    ? current.substring(0, charIdx--)
    : current.substring(0, charIdx++);

  let delay = isDeleting ? 50 : 100;

  if (!isDeleting && charIdx === current.length + 1) {
    isDeleting = true;
    delay = 1500;
  } else if (isDeleting && charIdx === 0) {
    isDeleting = false;
    msgIdx = (msgIdx + 1) % messages.length;
    delay = 400;
  }
  setTimeout(type, delay);
}
type();

// ── 7. 스크롤 페이드인 ───────────────────────
const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.style.animation = 'fadeInUp 0.5s ease forwards';
      entry.target.style.opacity = '1';
      observer.unobserve(entry.target);
    }
  });
}, { threshold: 0.15 });

document.querySelectorAll('h3, table, form, blockquote, pre, details').forEach(el => {
  el.style.opacity = '0';
  observer.observe(el);
});
