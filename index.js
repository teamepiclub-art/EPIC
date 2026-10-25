// This file exists solely as a Vercel entrypoint placeholder.
// The actual API logic lives in the /api/ directory (serverless functions).
// Static files are served from /public/ by Vercel's CDN automatically.
//
// For local development, use: node local-server.js

module.exports = (req, res) => {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/plain');
  res.end('EPIC Club Portal - OK');
};
