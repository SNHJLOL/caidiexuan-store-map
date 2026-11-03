#!/usr/bin/env node
/**
 * 把门店数据注入模板，产出单文件 HTML
 *
 *   node tools/build.js                     本机预览版（走 WorkBuddy 的本地地图代理）
 *   node tools/build.js --deploy --key=XXX  上线版（走真实腾讯地图 key，产出 deploy/index.html）
 *   node tools/build.js --deploy            上线版但未提供 key，会拒绝执行
 */
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const isDeploy = args.includes('--deploy');
const keyArg = args.find((a) => a.startsWith('--key='));
const keyFile = path.join(__dirname, '.tmap-key');
let tmapKey = keyArg ? keyArg.slice('--key='.length).trim() : '';
// 没在命令行给 key 时，回退到本地保存的 key（该文件只在本地，不进 deploy 目录）
if (!tmapKey && fs.existsSync(keyFile)) tmapKey = fs.readFileSync(keyFile, 'utf8').trim();

const root = path.join(__dirname, '..');
const tpl = fs.readFileSync(path.join(root, 'src', 'template.html'), 'utf8');
const data = JSON.parse(fs.readFileSync(path.join(root, 'data', 'stores.clean.json'), 'utf8'));

const compact = data.map((s) => ({
  id: s.id, code: s.code, name: s.name, addr: s.addr,
  lng: +s.lng.toFixed(6), lat: +s.lat.toFixed(6),
  tel: s.tel, open: s.open, city: s.city, district: s.district,
}));

if (!tpl.includes('/*__DATA__*/[]')) throw new Error('模板缺少数据占位符');

// 地图脚本：预览版靠本地代理注入鉴权，上线版必须带真实 key
const PREVIEW_BLOCK = `<script type="text/javascript">
  window._TMapSecurityConfig = {
    serviceHost: 'http://127.0.0.1:__WB_HTTP_PORT__/_TMapService/_wbt/__WB_TMAP_SECRET__',
  };
</script>
<script src="https://map.qq.com/api/gljs?v=1.exp&libraries=visualization"></script>`;

const SDK_URL = 'https://map.qq.com/api/gljs?v=1.exp&libraries=visualization';

if (!tpl.includes(PREVIEW_BLOCK)) throw new Error('模板里没找到地图脚本块，构建脚本需要同步更新');

let body = tpl.replace('/*__DATA__*/[]', '/**/' + JSON.stringify(compact) + '/**/');

if (!isDeploy) {
  const dest = path.join(root, '采蝶轩门店分布图.html');
  fs.writeFileSync(dest, body, 'utf8');
  console.log(`已生成 ${dest}（本机预览版，走本地地图代理）`);
  console.log(`门店 ${compact.length} 家，文件 ${(Buffer.byteLength(body) / 1024).toFixed(1)}KB`);
} else {
  if (!tmapKey) {
    console.error('缺少腾讯地图 key。用法：node tools/build.js --deploy --key=你的KEY');
    process.exit(1);
  }
  body = body.replace(PREVIEW_BLOCK, `<script src="${SDK_URL}&key=${encodeURIComponent(tmapKey)}"></script>`);
  if (body.includes('__WB_HTTP_PORT__') || body.includes('__WB_TMAP_SECRET__')) {
    throw new Error('上线版仍残留本地代理占位符，构建未完成');
  }
  const outDir = path.join(root, 'deploy');
  fs.mkdirSync(outDir, { recursive: true });
  const dest = path.join(outDir, 'index.html');
  fs.writeFileSync(dest, body, 'utf8');
  console.log(`已生成 ${dest}（上线版，使用腾讯地图 key ${tmapKey.slice(0, 6)}…${tmapKey.slice(-4)}）`);
  console.log(`门店 ${compact.length} 家，文件 ${(Buffer.byteLength(body) / 1024).toFixed(1)}KB`);
  console.log('提示：deploy/ 目录只应包含 index.html，勿把 out/ 与 tools/ 一起上传');
}
