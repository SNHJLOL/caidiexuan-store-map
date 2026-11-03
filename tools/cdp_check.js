/* 通过 CDP 检查腾讯地图 baseMap 能力，避免在无 WebGL 的 headless 里靠截图误判 */
const http = require('http');

const PORT = 9333;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function json(path) {
  return new Promise((res, rej) => {
    const req = http.get({ host: '127.0.0.1', port: PORT, path }, (r) => {
      let d = '';
      r.on('data', (c) => (d += c));
      r.on('end', () => {
        try { res(JSON.parse(d)); } catch (e) { rej(new Error('非 JSON: ' + d.slice(0, 200))); }
      });
    });
    req.on('error', rej);
    req.setTimeout(4000, () => req.destroy(new Error('timeout')));
  });
}

const EXPR = `(() => {
  const out = { url: location.href.slice(0, 60) };
  out.tmap = typeof window.TMap;
  out.hasMap = typeof map !== 'undefined' && !!map;
  if (!out.hasMap) return JSON.stringify(out);
  out.setBaseMap = typeof map.setBaseMap;
  out.getBaseMap = typeof map.getBaseMap;
  try { out.before = JSON.stringify(map.getBaseMap()); } catch (e) { out.beforeErr = String(e); }
  try {
    map.setBaseMap({ type: 'vector', features: ['base', 'building2d'] });
    out.minCallOk = true;
  } catch (e) { out.minErr = String(e); }
  try { out.afterMin = JSON.stringify(map.getBaseMap()); } catch (e) { out.afterMinErr = String(e); }
  try {
    map.setBaseMap({ type: 'vector', features: ['base', 'building2d', 'label'] });
    out.midCallOk = true;
  } catch (e) { out.midErr = String(e); }
  try { out.afterMid = JSON.stringify(map.getBaseMap()); } catch (e) { out.afterMidErr = String(e); }
  out.stateBase = (typeof state !== 'undefined') ? state.base : null;
  out.markerLayer = (typeof markerLayer !== 'undefined' && markerLayer) ? 'exists' : 'null';
  return JSON.stringify(out, null, 1);
})()`;

(async () => {
  let list;
  for (let i = 0; i < 25; i++) {
    try {
      list = await json('/json/list');
      if (list && list.some((t) => t.type === 'page' && t.webSocketDebuggerUrl)) break;
    } catch (e) { /* 等浏览器起来 */ }
    await sleep(600);
  }
  const pages = (list || []).filter((t) => t.type === 'page' && t.webSocketDebuggerUrl);
  console.log('检测到页面:', pages.map((p) => p.url.slice(0, 55)));
  const page = pages.find((t) => /static-html/.test(t.url)) || pages[0];
  if (!page) { console.log('未找到可调试页面'); process.exit(1); }
  console.log('target:', page.url.slice(0, 70));

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const send = (method, params) => new Promise((res) => {
    const mid = ++id;
    pending.set(mid, res);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });

  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };

  await new Promise((r) => (ws.onopen = r));
  await send('Runtime.enable', {});
  await sleep(1500); // 让地图把首帧跑完

  const r = await send('Runtime.evaluate', { expression: EXPR, returnByValue: true, awaitPromise: false });
  if (r.result && r.result.exceptionDetails) {
    console.log('执行异常:', JSON.stringify(r.result.exceptionDetails).slice(0, 400));
  } else {
    const v = r.result && r.result.result && r.result.result.value;
    console.log(v || JSON.stringify(r).slice(0, 500));
  }
  ws.close();
  process.exit(0);
})();
