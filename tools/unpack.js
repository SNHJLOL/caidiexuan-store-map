#!/usr/bin/env node
/**
 * wxapkg 解密 + 解包（支持 V1MMWX 加密格式 / 微信 4.x）
 * 用法: node unpack.js <wxapkg路径> <appid> <输出目录>
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const APPID_RE = /wx[0-9a-f]{16}/i;

function decrypt(buf, wxid) {
  if (buf.slice(0, 6).toString('latin1') !== 'V1MMWX') return { data: buf, encrypted: false };

  const key = crypto.pbkdf2Sync(Buffer.from(wxid, 'utf8'), Buffer.from('saltiest'), 1000, 32, 'sha1');
  const iv = Buffer.from('the iv: 16 bytes');
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  decipher.setAutoPadding(false);

  const head = Buffer.concat([decipher.update(buf.slice(6, 6 + 1024)), decipher.final()]);

  const xorKey = wxid.length >= 2 ? wxid.charCodeAt(wxid.length - 2) : 0x66;
  const rest = Buffer.alloc(buf.length - 1024 - 6);
  for (let i = 0; i < rest.length; i++) rest[i] = buf[1024 + 6 + i] ^ xorKey;

  // 前 1023 字节 + 异或段（第 1024 字节是 AES 填充位，丢弃）
  return { data: Buffer.concat([head.slice(0, 1023), rest]), encrypted: true };
}

function parseWxapkg(buf) {
  if (buf[0] !== 0xbe) throw new Error('不是合法的 wxapkg（首字节应为 0xBE，实际 0x' + buf[0].toString(16) + '）');
  const info1 = buf.readUInt32BE(1);
  const indexLen = buf.readUInt32BE(5);
  const bodyLen = buf.readUInt32BE(9);
  const mark = buf[13];
  const fileCount = buf.readUInt32BE(14);

  const files = [];
  let p = 18;
  for (let i = 0; i < fileCount; i++) {
    const nameLen = buf.readUInt32BE(p); p += 4;
    const name = buf.slice(p, p + nameLen).toString('utf8'); p += nameLen;
    const offset = buf.readUInt32BE(p); p += 4;
    const size = buf.readUInt32BE(p); p += 4;
    files.push({ name, offset, size });
  }
  return { info1, indexLen, bodyLen, mark, fileCount, files };
}

const [,, src, appidArg, outDir] = process.argv;
if (!src || !outDir) {
  console.error('用法: node unpack.js <wxapkg> <appid|auto> <输出目录>');
  process.exit(1);
}

const wxid = (appidArg && appidArg !== 'auto')
  ? appidArg
  : (src.match(APPID_RE) || [null])[0];
if (!wxid) { console.error('无法从路径推断 appid，请显式传入'); process.exit(1); }

const raw = fs.readFileSync(src);
const { data, encrypted } = decrypt(raw, wxid);
const meta = parseWxapkg(data);

console.log(`包: ${path.basename(src)}`);
console.log(`加密: ${encrypted ? 'V1MMWX（已解密）' : '否'}`);
console.log(`原大小: ${(raw.length / 1024).toFixed(1)}KB → 解密后: ${(data.length / 1024).toFixed(1)}KB`);
console.log(`文件数: ${meta.fileCount}`);

let total = 0;
for (const f of meta.files) {
  const target = path.join(outDir, f.name.replace(/^\//, ''));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, data.slice(f.offset, f.offset + f.size));
  total += f.size;
}
console.log(`已解出到: ${outDir}（共 ${(total / 1024).toFixed(1)}KB）`);
