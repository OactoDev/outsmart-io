/**
 * HTTP server — serves static files + handles all API routes.
 * Works locally (dev) and on any persistent Node.js host (Render, Railway, etc.)
 * Usage: node server.js
 */
const http   = require('http');
const fs     = require('fs');
const path   = require('path');
const { URL } = require('url');

// ── Pre-load API modules at startup so errors appear in logs immediately ─────
const apiHandler  = require('./api/index.js');
const { subscribe: sseSubscribe } = require('./api/_lib/events');

// ── Crash guard — prevent the process dying on unhandled async errors ─────────
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});

// ── Live-reload: track SSE clients ───────────────────────────────────────────
const liveReloadClients = new Set();

// Debounce: only fire once per 400ms burst of fs events
let reloadTimer = null;
function notifyReload(filename) {
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => {
    console.log(`[reload] ${filename}`);
    for (const res of liveReloadClients) {
      try { res.write('data: reload\n\n'); } catch {}
    }
  }, 400);
}

// Only react to recognised source-file extensions — ignore reads, .DS_Store, etc.
const WATCH_EXTS = new Set(['.html', '.css', '.js', '.json']);

// File-watching only in dev mode
if (process.env.NODE_ENV !== 'production') {
  for (const dir of ['public', 'api']) {
    const dirPath = path.join(__dirname, dir);
    if (fs.existsSync(dirPath)) {
      fs.watch(dirPath, { recursive: true }, (event, filename) => {
        if (!filename) return;
        if (path.basename(filename).startsWith('.')) return;
        if (!WATCH_EXTS.has(path.extname(filename))) return;
        notifyReload(`${dir}/${filename}`);
      });
    }
  }
}

// Inject live-reload script — reconnects silently, only reloads on explicit 'reload' message
const LIVERELOAD_SCRIPT = `<script>
(function(){
  let active = false;
  function connect() {
    const es = new EventSource('/livereload');
    es.onopen    = () => { active = true; };
    es.onmessage = (e) => { if (e.data === 'reload') location.reload(); };
    es.onerror   = () => { es.close(); if (active) { active = false; setTimeout(connect, 1500); } };
  }
  connect();
})();
</script></body>`;


const PORT = parseInt(process.env.PORT, 10) || 3000;
const ROOT = __dirname;
const IS_DEV = process.env.NODE_ENV !== 'production';

// ── MIME types ──────────────────────────────────────────────────────────────
const MIME = {
  '.html': 'text/html',
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.json': 'application/json',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.gif':  'image/gif',
  '.woff': 'font/woff',
  '.woff2':'font/woff2',
};

// ── Route table (mirrors vercel.json) ───────────────────────────────────────
function resolveStaticPath(urlPath) {
  // /assets/... → public/assets/...
  if (urlPath.startsWith('/assets/'))
    return path.join(ROOT, 'public', urlPath);
  // /js/... → public/js/...
  if (urlPath.startsWith('/js/'))
    return path.join(ROOT, 'public', urlPath);
  // /host or /host.html → public/host.html
  if (urlPath === '/host' || urlPath === '/host.html')
    return path.join(ROOT, 'public', 'host.html');
  // / → public/index.html  (PLAYER screen)
  if (urlPath === '/')
    return path.join(ROOT, 'public', 'index.html');
  // image files at root level → try root first, then public
  const ext = path.extname(urlPath);
  if (['.png','.jpg','.svg','.ico','.gif'].includes(ext)) {
    const rootFile = path.join(ROOT, urlPath);
    if (fs.existsSync(rootFile)) return rootFile;
    return path.join(ROOT, 'public', urlPath);
  }
  // everything else → public/
  return path.join(ROOT, 'public', urlPath);
}

// ── Simple request / response wrapper (Vercel-compat shim) ──────────────────
function buildVercelReq(nodeReq, body, params) {
  const u = new URL(nodeReq.url, `http://localhost:${PORT}`);
  return Object.assign(nodeReq, {
    // Merge dynamic route params into query to match Vercel behaviour
    // (Vercel places [paramName] values in req.query)
    query:  { ...Object.fromEntries(u.searchParams), ...(params || {}) },
    body:   body,
    params: params || {},
  });
}

function buildVercelRes(nodeRes) {
  let statusCode = 200;
  const res = {
    status(code) { statusCode = code; return res; },
    json(data) {
      const body = JSON.stringify(data);
      nodeRes.writeHead(statusCode, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      });
      nodeRes.end(body);
    },
    send(data) {
      nodeRes.writeHead(statusCode, { 'Content-Type': 'text/plain' });
      nodeRes.end(String(data));
    },
    setHeader(k, v) { nodeRes.setHeader(k, v); return res; },
    end(d) { nodeRes.end(d); },
  };
  return res;
}

// ── Parse body ───────────────────────────────────────────────────────────────
function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', chunk => raw += chunk);
    req.on('end', () => {
      if (!raw) return resolve({});
      // Try JSON first
      try { return resolve(JSON.parse(raw)); } catch {}
      // Fall back to application/x-www-form-urlencoded (used by Pusher client)
      try {
        const params = new URLSearchParams(raw);
        const obj = {};
        for (const [k, v] of params) obj[k] = v;
        return resolve(obj);
      } catch {}
      resolve({});
    });
  });
}

// ── Load .env file if present ────────────────────────────────────────────────
(function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim();
      if (!process.env[key]) process.env[key] = val;
    }
  }
})();

// ── Server ───────────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const u   = new URL(req.url, `http://localhost:${PORT}`);
  const urlPath = u.pathname;

  // ── Live-reload SSE endpoint (dev only) ───────────────────────────────────
  if (IS_DEV && urlPath === '/livereload') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });
    res.write('data: connected\n\n');
    liveReloadClients.add(res);
    req.on('close', () => liveReloadClients.delete(res));
    return;
  }

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  // ── SSE events endpoint (real-time room events) ────────────────────────────
  if (urlPath === '/api/events') {
    const room = u.searchParams.get('room');
    if (!room) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'room query param required' }));
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });
    res.write(`event: connected\ndata: {}\n\n`);

    const keepAlive = setInterval(() => {
      try { res.write(`:keepalive\n\n`); } catch {}
    }, 15000);

    const unsub = sseSubscribe(room.toUpperCase(), (msg) => {
      try { res.write(`event: ${msg.event}\ndata: ${JSON.stringify(msg.data)}\n\n`); } catch {}
    });
    req.on('close', () => { unsub(); clearInterval(keepAlive); });
    return;
  }

  // ── Health check (used by Render to verify the service is alive) ────────────
  if (urlPath === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, uptime: process.uptime() }));
    return;
  }

  // ── API routes — all handled by consolidated api/index.js ─────────────────
  if (urlPath.startsWith('/api/')) {
    let body = {};
    try { body = await readBody(req); } catch { /* ignore body parse errors */ }
    const vReq = buildVercelReq(req, body, {});
    const vRes = buildVercelRes(res);
    try {
      await (apiHandler.default || apiHandler)(vReq, vRes);
    } catch (err) {
      console.error('[API error]', req.method, urlPath, err.stack || err.message);
      if (!res.writableEnded) {
        res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ error: String(err.message || err) }));
      }
    }
    return;
  }

  // ── Static files ──────────────────────────────────────────────────────────
  let filePath = resolveStaticPath(urlPath);

  // If it's a directory, serve index.html inside it
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory())
    filePath = path.join(filePath, 'index.html');

  if (!fs.existsSync(filePath)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end(`404 – ${urlPath}`);
    return;
  }

  const ext  = path.extname(filePath);
  const mime = MIME[ext] || 'application/octet-stream';

  if (mime === 'text/html') {
    let html = fs.readFileSync(filePath, 'utf8');
    // Inject live-reload script only in dev mode
    if (IS_DEV) html = html.replace('</body>', LIVERELOAD_SCRIPT);
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
  } else {
    res.writeHead(200, { 'Content-Type': mime });
    fs.createReadStream(filePath).pipe(res);
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🎮  Outsmart.io server (${IS_DEV ? 'dev' : 'production'})`);
  console.log(`   Port: ${PORT}`);
  if (IS_DEV) {
    console.log(`   Player screen  →  http://localhost:${PORT}/`);
    console.log(`   Host screen    →  http://localhost:${PORT}/host`);
  }
  console.log();
});
