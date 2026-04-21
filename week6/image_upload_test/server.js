// Module imports
require('dotenv').config();
const express = require('express');
const path = require('path');
const ImageKit = require('imagekit');

// App initialization
const app = express();
const PORT = (process.env.PORT || '3000').toString().trim();

// Environment variables (trimmed to avoid trailing newline issues on hosted platforms)
const IMAGEKIT_PUBLIC_KEY = (process.env.IMAGEKIT_PUBLIC_KEY || '').trim();
const IMAGEKIT_PRIVATE_KEY = (process.env.IMAGEKIT_PRIVATE_KEY || '').trim();
const IMAGEKIT_URL_ENDPOINT = (process.env.IMAGEKIT_URL_ENDPOINT || '').trim();

// ImageKit SDK instance (server-side only — private key never leaves the server)
const imagekit = new ImageKit({
  publicKey: IMAGEKIT_PUBLIC_KEY,
  privateKey: IMAGEKIT_PRIVATE_KEY,
  urlEndpoint: IMAGEKIT_URL_ENDPOINT,
});

// Middleware
app.use(express.json());
app.use(express.static(__dirname));

// API routes
// GET /api/imagekit/auth — returns short-lived auth params for client-side uploads.
// The client calls ImageKit's upload endpoint directly using these params, so the
// private key stays on the server.
app.get('/api/imagekit/auth', (_req, res) => {
  try {
    if (!IMAGEKIT_PUBLIC_KEY || !IMAGEKIT_PRIVATE_KEY || !IMAGEKIT_URL_ENDPOINT) {
      return res.status(500).json({
        success: false,
        message: 'ImageKit environment variables are not configured on the server.',
      });
    }

    const authParams = imagekit.getAuthenticationParameters();
    // authParams shape: { token, expire, signature }

    return res.json({
      success: true,
      data: {
        token: authParams.token,
        expire: authParams.expire,
        signature: authParams.signature,
        publicKey: IMAGEKIT_PUBLIC_KEY,
        urlEndpoint: IMAGEKIT_URL_ENDPOINT,
      },
    });
  } catch (err) {
    console.error('[imagekit/auth] Failed to generate auth params:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to generate ImageKit authentication parameters.',
    });
  }
});

// Generic JSON 404 for unknown API routes (keeps SPA fallback below from swallowing them)
app.use('/api', (_req, res) => {
  res.status(404).json({ success: false, message: 'API endpoint not found' });
});

// Error handling middleware
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error('[server] Unhandled error:', err);
  res.status(500).json({ success: false, message: 'Internal server error' });
});

// Local dev: start listening. Vercel serverless: just export the app.
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

module.exports = app;
