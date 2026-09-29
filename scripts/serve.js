#!/usr/bin/env node
'use strict';
/* Zero-dependency static server for Lunar Patrol.
   Usage: node scripts/serve.js [--port 8080] [--open]   (PORT env var also works) */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const argPort = args.includes('--port') ? Number(args[args.indexOf('--port') + 1]) : null;
const startPort = argPort || Number(process.env.PORT) || 8080;
const shouldOpen = args.includes('--open');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function handler(req, res) {
  let urlPath;
  try { urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
  catch { res.writeHead(400); res.end('Bad request'); return; }
  if (urlPath.endsWith('/')) urlPath += 'index.html';
  const file = path.normalize(path.join(ROOT, urlPath));
  // Refuse anything outside the project folder or inside dot-folders like .git.
  if (!file.startsWith(ROOT + path.sep) || file.split(path.sep).some(p => p.startsWith('.') && p.length > 1)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

function listen(port, triesLeft) {
  const server = http.createServer(handler);
  server.once('error', err => {
    if (err.code === 'EADDRINUSE' && triesLeft > 0) listen(port + 1, triesLeft - 1);
    else { console.error(err.message); process.exit(1); }
  });
  server.listen(port, '127.0.0.1', () => {
    const url = `http://localhost:${port}`;
    console.log(`Lunar Patrol running at ${url}  (Ctrl+C to stop)`);
    if (shouldOpen) {
      const cmd = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
      exec(cmd);
    }
  });
}

listen(startPort, 10);
