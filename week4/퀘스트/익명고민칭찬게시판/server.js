// Anonymous Bulletin Board — Server
// Serves static files (index.html) and provides a small REST API
// for anonymous posts categorized as worry / praise / cheer.

const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// ---------------------------------------------------------------------------
// In-memory data store (resets on restart)
// ---------------------------------------------------------------------------
const VALID_CATEGORIES = ['worry', 'praise', 'cheer'];
const MAX_CONTENT_LENGTH = 500;

const now = Date.now();
let posts = [
  {
    id: 'seed-1',
    category: 'cheer',
    content: '요즘 다들 많이 힘드시죠? 그래도 여러분, 오늘 하루도 잘 버텨냈어요. 정말 수고했어요! 🌿',
    empathy: 12,
    createdAt: now - 1000 * 60 * 3,
  },
  {
    id: 'seed-2',
    category: 'worry',
    content:
      '진로 때문에 너무 고민이에요. 주변 친구들은 다 방향이 정해진 것 같은데 저만 아직 헤매고 있는 것 같아서 마음이 복잡합니다.',
    empathy: 5,
    createdAt: now - 1000 * 60 * 20,
  },
  {
    id: 'seed-3',
    category: 'praise',
    content: '오늘 지하철에서 무거운 짐 들어주신 분, 정말 감사했어요. 덕분에 하루가 따뜻했습니다. ✨',
    empathy: 23,
    createdAt: now - 1000 * 60 * 60 * 2,
  },
];

// Simple id generator: timestamp + random suffix
function generateId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// ---------------------------------------------------------------------------
// API Routes
// ---------------------------------------------------------------------------

// GET /api/posts?sort=latest|empathy
app.get('/api/posts', (req, res) => {
  try {
    const sort = req.query.sort === 'empathy' ? 'empathy' : 'latest';
    const sorted = [...posts].sort((a, b) => {
      if (sort === 'empathy') {
        // Higher empathy first; tie-breaker: newer first
        if (b.empathy !== a.empathy) return b.empathy - a.empathy;
        return b.createdAt - a.createdAt;
      }
      // latest: newer first
      return b.createdAt - a.createdAt;
    });
    res.json({ success: true, data: sorted });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch posts' });
  }
});

// POST /api/posts
app.post('/api/posts', (req, res) => {
  try {
    const { category, content } = req.body || {};

    if (!VALID_CATEGORIES.includes(category)) {
      return res.status(400).json({
        success: false,
        message: 'category는 worry, praise, cheer 중 하나여야 합니다.',
      });
    }

    if (typeof content !== 'string' || content.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'content는 비어있지 않은 문자열이어야 합니다.',
      });
    }

    if (content.length > MAX_CONTENT_LENGTH) {
      return res.status(400).json({
        success: false,
        message: `content는 최대 ${MAX_CONTENT_LENGTH}자까지 작성 가능합니다.`,
      });
    }

    const newPost = {
      id: generateId(),
      category,
      content: content.trim(),
      empathy: 0,
      createdAt: Date.now(),
    };

    posts.push(newPost);
    res.status(201).json({ success: true, data: newPost });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to create post' });
  }
});

// POST /api/posts/:id/empathy
app.post('/api/posts/:id/empathy', (req, res) => {
  try {
    const { id } = req.params;
    const post = posts.find((p) => p.id === id);

    if (!post) {
      return res.status(404).json({ success: false, message: 'Post not found' });
    }

    post.empathy += 1;
    res.json({ success: true, data: post });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to update empathy' });
  }
});

// ---------------------------------------------------------------------------
// SPA fallback — serve index.html for non-API GET routes
// ---------------------------------------------------------------------------
app.get('/{*splat}', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ---------------------------------------------------------------------------
// Error handler (last)
// ---------------------------------------------------------------------------
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ success: false, message: 'Internal server error' });
});

// ---------------------------------------------------------------------------
// Dual-mode: local listen / Vercel serverless export
// ---------------------------------------------------------------------------
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

module.exports = app;
