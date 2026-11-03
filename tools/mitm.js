#!/usr/bin/env node
/**
 * 自建 MITM 代理（无第三方依赖，用本机 openssl 现签证书）
 * 目的：抓小程序 HTTPS 请求的完整 URL 与请求头。
 * 监听 127.0.0.1:8897
 */
const http = require('http');
const https = require('https');
const tls = require('tls');
const net = require('net');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const PORT = 8897;
const DIR = path.join(__dirname, '..', 'data', 'ca');
const CERTDIR = path.join(DIR, 'hosts');
const LOG = path.join(__dirname, '..', 'data', 'mitm-requests.log');
fs.mkdirSync(CERTDIR, { recursive: true });

const CA_KEY = path.join(DIR, 'ca.key');
const CA_CRT = path.join(DIR, 'ca.crt');

function ensureCA() {
  if (fs.existsSync(CA_KEY) && fs.existsSync(CA_CRT)) return;
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes',
    '-keyout', CA_KEY, '-out', CA_CRT, '-days', '3650',
    '-subj', '/CN=Local Debug CA/O=LocalDebug'], { stdio: 'ignore' });
  console.log('已生成 CA:', CA_CRT);
}

const certCache = new Map();
function leafFor(host) {
  if (certCache.has(host)) return certCache.get(host);
  const safe = host.replace(/[^a-zA-Z0-9._-]/g, '_');
  const key = path.join(CERTDIR, safe + '.key');
  const crt = path.join(CERTDIR, safe + '.crt');
  if (!fs.existsSync(crt) || !fs.existsSync(key)) {
    const csr = path.join(CERTDIR, safe + '.csr');
    const ext = path.join(CERTDIR, safe + '.ext');
    fs.writeFileSync(ext, `subjectAltName=DNS:${host}\nbasicConstraints=CA:FALSE\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n`);
    execFileSync('openssl', ['req', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', csr, '-subj', `/CN=${host}`], { stdio: 'ignore' });
    execFileSync('openssl', ['x509', '-req', '-in', csr, '-CA', CA_CRT, '-CAkey', CA_KEY,
      '-CAcreateserial', '-out', crt, '-days', '365', '-extfile', ext], { stdio: 'ignore' });
  }
  const pair = { key: fs.readFileSync(key), cert: fs.readFileSync(crt) };
  certCache.set(host, pair);
  return pair;
}

function note(line) {
  fs.appendFileSync(LOG, line + '\n');
  console.log(line);
}

// 转发实际请求
function forward(req, body, host, port) {
  const headers = Object.assign({}, req.headers);
  delete headers['proxy-connection'];
  return new Promise((resolve) => {
    const r = https.request({
      host, port: port || 443, path: req.url, method: req.method,
      headers, servername: host, ALPNProtocols: ['http/1.1'],
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    r.on('error', (e) => resolve({ status: 0, headers: {}, body: Buffer.from('ERR ' + e.message) }));
    if (body && body.length) r.write(body);
    r.end();
  });
}

// 处理解密后的请求
function makeHandler(host, port) {
  return async (req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    await new Promise((r) => req.on('end', r));
    const body = Buffer.concat(chunks);

    const interesting = /^\/(store|search|member|oath|goods|layout)/.test(req.url);
    if (interesting) {
      note(`\n### ${req.method} https://${host}${req.url}`);
      note('HEADERS ' + JSON.stringify(req.headers));
      if (body.length) note('BODY ' + body.toString('utf8').slice(0, 500));
    }

    const out = await forward(req, body, host, port);
    if (interesting) {
      note(`<<< ${out.status} ${JSON.stringify(out.headers)}`);
      note('RESP ' + out.body.toString('utf8').slice(0, 1500));
    }
    res.writeHead(out.status || 502, out.headers);
    res.end(out.body);
  };
}

const server = http.createServer((req, res) => {
  // 明文 HTTP
  note(`HTTP ${req.method} ${req.url}`);
  let u;
  try { u = new URL(req.url); } catch { res.writeHead(400); return res.end(); }
  const pr = http.request({ host: u.hostname, port: u.port || 80, path: u.pathname + u.search, method: req.method, headers: req.headers }, (r) => {
    res.writeHead(r.statusCode, r.headers); r.pipe(res);
  });
  pr.on('error', () => { res.writeHead(502); res.end(); });
  req.pipe(pr);
});

server.on('connect', (req, clientSocket, head) => {
  const [host, p] = req.url.split(':');
  const port = Number(p) || 443;
  clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');

  let pair;
  try { pair = leafFor(host); }
  catch (e) { clientSocket.destroy(); return; }

  const tlsSocket = new tls.TLSSocket(clientSocket, {
    isServer: true,
    secureContext: tls.createSecureContext({ key: pair.key, cert: pair.cert }),
    ALPNProtocols: ['http/1.1'],
  });

  const hostServer = http.createServer(makeHandler(host, port));
  hostServer.emit('connection', tlsSocket);
  tlsSocket.on('error', () => {});
});

ensureCA();
server.listen(PORT, '127.0.0.1', () => console.log(`MITM 代理已启动 127.0.0.1:${PORT}`));
