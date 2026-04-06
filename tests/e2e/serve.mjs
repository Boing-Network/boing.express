/**
 * Minimal static file server for extension E2E (window.boing checks).
 * Listens on 127.0.0.1:3333 — must match playwright.config webServer.
 */
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const staticRoot = path.join(__dirname, 'static');
const port = 3333;

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
  let p = url.pathname === '/' ? '/dapp.html' : url.pathname;
  const filePath = path.join(staticRoot, path.normalize(p).replace(/^(\.\.(\/|\\|$))+/, ''));
  if (!filePath.startsWith(staticRoot)) {
    res.writeHead(403);
    res.end();
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': mime[ext] ?? 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(port, '127.0.0.1', () => {
  console.log(`e2e static server http://127.0.0.1:${port}/`);
});
