#!/usr/bin/env node
/**
 * 拉取采蝶轩全量门店（官方小程序接口）
 * GET {base}/store/page?storePage=1&goodsId=&lng=&lat=&pageId=&current=&size=&storeName=&_timestemp=
 * 注意：接口不返回 total（恒为 0），只能翻页到不足一页为止。
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
const BASE = cfg.base.replace(/\/$/, '');
const HEADERS = cfg.headers;
const SIZE = 200;
const REF_LNG = 113.405911;
const REF_LAT = 23.1177;

function get(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: HEADERS, timeout: 25000 }, (res) => {
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (buf += c));
      res.on('end', () => {
        try { resolve(JSON.parse(buf)); } catch (e) { reject(new Error('非 JSON: ' + buf.slice(0, 200))); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

async function main() {
  const all = [];
  for (let current = 1; current <= 30; current++) {
    const qs = new URLSearchParams({
      storePage: '1', goodsId: '', lng: String(REF_LNG), lat: String(REF_LAT),
      pageId: '', current: String(current), size: String(SIZE), storeName: '',
      _timestemp: String(Date.now()),
    });
    const url = `${BASE}/store/page?${qs.toString()}`;
    let r;
    try { r = await get(url); }
    catch (e) { console.error(`第 ${current} 页失败: ${e.message}`); break; }

    if (r.status !== 200) { console.error('接口异常:', JSON.stringify(r).slice(0, 300)); break; }
    const recs = (r.data && r.data.records) || [];
    console.log(`第 ${current} 页: ${recs.length} 条`);
    if (!recs.length) break;
    all.push(...recs);
    if (recs.length < SIZE) break;
    await new Promise((res) => setTimeout(res, 500));
  }

  const seen = new Set();
  const uniq = all.filter((s) => {
    const k = s.storeId;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  const out = path.join(__dirname, '..', 'data', 'stores.json');
  fs.writeFileSync(out, JSON.stringify(uniq, null, 2), 'utf8');
  console.log(`\n合计 ${all.length} 条，去重后 ${uniq.length} 条 → ${out}`);
  if (uniq[0]) console.log('字段:', Object.keys(uniq[0]).join(', '));
}

main().catch((e) => { console.error(e); process.exit(1); });
