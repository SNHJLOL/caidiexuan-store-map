#!/usr/bin/env node
/**
 * 拉取采蝶轩商城全量商品
 * 1) GET {base}/categories?storeId=  → 分类树
 * 2) GET {base}/categoryGoods?categoryId=&storeId=&current=&size=  → 该分类商品（需用子分类 id）
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
const BASE = cfg.base.replace(/\/$/, '');
const HEADERS = cfg.headers;
const STORE_ID = process.argv[2] || '50384'; // 默认：番禺南村店

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
const ts = () => Date.now();

async function main() {
  // 1. 分类树
  const catRes = await get(`${BASE}/categories?storeId=${STORE_ID}&_timestemp=${ts()}`);
  if (catRes.status !== 200) throw new Error('分类接口失败: ' + JSON.stringify(catRes).slice(0, 200));
  const tree = catRes.data || [];

  const nodes = []; // {id, name, top, path}
  tree.forEach((top) => {
    nodes.push({ id: top.id, name: top.name, top: top.name, path: top.name, kids: (top.children || []).length });
    (top.children || []).forEach((c) => {
      nodes.push({ id: c.id, name: c.name, top: top.name, path: top.name + ' / ' + c.name, kids: 0 });
    });
  });
  console.log(`分类：一级 ${tree.length} 个，节点合计 ${nodes.length} 个`);

  // 2. 逐分类拉商品
  const map = new Map();
  for (const n of nodes) {
    let current = 1, pages = 1;
    while (current <= pages && current <= 20) {
      const url = `${BASE}/categoryGoods?categoryId=${n.id}&storeId=${STORE_ID}&current=${current}&size=100&_timestemp=${ts()}`;
      let r;
      try { r = await get(url); } catch (e) { console.warn(`  [${n.path}] 请求失败 ${e.message}`); break; }
      if (r.status !== 200 || !r.data) break;
      pages = r.data.pages || 1;
      const recs = r.data.records || [];
      recs.forEach((g) => {
        if (!map.has(g.goodsId)) map.set(g.goodsId, Object.assign({}, g, { catTop: n.top, catPath: n.path }));
      });
      if (!recs.length) break;
      current++;
      await new Promise((res) => setTimeout(res, 250));
    }
    const got = [...map.values()].filter((g) => g.catPath === n.path).length;
    if (got) console.log(`  ${n.path.padEnd(18, ' ')} ${got} 件`);
  }

  const goods = [...map.values()].filter((g) => g.status !== 'D');
  const out = path.join(__dirname, '..', 'data', 'goods.json');
  fs.writeFileSync(out, JSON.stringify(goods, null, 2), 'utf8');

  const prices = goods.map((g) => g.price).filter((p) => p > 0);
  console.log(`\n去重后商品 ${goods.length} 件`);
  console.log(`价格区间 ¥${(Math.min(...prices) / 100).toFixed(2)} ~ ¥${(Math.max(...prices) / 100).toFixed(2)}`);
  console.log(`有封面图 ${goods.filter((g) => g.coverPicUrl).length} 件，有销量 ${goods.filter((g) => g.monthSales > 0).length} 件`);
  console.log('输出 →', out);
}

main().catch((e) => { console.error(e); process.exit(1); });
