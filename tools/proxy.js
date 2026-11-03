#!/usr/bin/env node
/**
 * 极简直通代理：不改内容、不做 TLS 劫持，只记录 CONNECT 目标域名。
 * 目的：找出小程序真正请求的 API 域名。
 */
const http = require('http');
const net = require('net');
const fs = require('fs');
const path = require('path');

const PORT = 8899;
const LOG = path.join(__dirname, '..', 'data', 'proxy-hosts.log');
const RAW = path.join(__dirname, '..', 'data', 'proxy-raw.log');
fs.mkdirSync(path.dirname(LOG), { recursive: true });

const seen = new Set();
function note(line) {
  fs.appendFileSync(RAW, new Date().toISOString() + ' ' + line + '\n');
}

const server = http.createServer((req, res) => {
  // 明文 HTTP 代理
  note(`HTTP ${req.method} ${req.url}`);
  let u;
  try { u = new URL(req.url); } catch { res.writeHead(400); return res.end(); }
  const proxy = http.request(
    { host: u.hostname, port: u.port || 80, path: u.pathname + u.search, method: req.method, headers: req.headers },
    (pr) => { res.writeHead(pr.statusCode, pr.headers); pr.pipe(res); }
  );
  proxy.on('error', () => { res.writeHead(502); res.end(); });
  req.pipe(proxy);
});

server.on('connect', (req, clientSocket, head) => {
  const target = req.url; // host:port
  const host = target.split(':')[0];
  if (!seen.has(host)) {
    seen.add(host);
    fs.appendFileSync(LOG, host + '\n');
    console.log('CONNECT →', host);
  }
  note('CONNECT ' + target);

  clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
  const [h, p] = target.split(':');
  const upstream = net.connect(Number(p) || 443, h, () => {
    if (head && head.length) upstream.write(head);
    clientSocket.pipe(upstream);
    upstream.pipe(clientSocket);
  });
  upstream.on('error', () => clientSocket.destroy());
  clientSocket.on('error', () => upstream.destroy());
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`直通代理已启动 127.0.0.1:${PORT}，域名记录 → ${LOG}`);
});
