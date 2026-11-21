// Gera a versão web (celular + PC) em dist-web/, pronta para o Cloudflare Pages.
//   node scripts/build-web.mjs
import { promises as fs } from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src', 'renderer');
const WEB = path.join(ROOT, 'web');
const OUT = path.join(ROOT, 'dist-web');

function replaceOnce(text, pattern, replacement, what) {
  const next = text.replace(pattern, replacement);
  if (next === text) throw new Error(`build-web: não encontrei ${what} no index.html`);
  return next;
}

// ---------------------------------------------------------------- ícones PNG (sem dependências)
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size) {
  const bg = [0x14, 0x16, 0x1a];
  const orange = [0xff, 0x7a, 0x1a];
  const dark = [0x14, 0x16, 0x1a];
  const c = size / 2;
  const r = size * 0.36; // dentro da área segura dos ícones "maskable"
  // triângulo de play, centralizado opticamente
  const tx0 = c - r * 0.32;
  const tx1 = c + r * 0.5;
  const th = r * 0.48;
  const rows = [];
  const SS = 4; // supersampling para bordas suaves
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 3);
    for (let x = 0; x < size; x++) {
      let inCircle = 0;
      let inTri = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = x + (sx + 0.5) / SS;
          const py = y + (sy + 0.5) / SS;
          if ((px - c) ** 2 + (py - c) ** 2 <= r * r) inCircle++;
          if (px >= tx0 && px <= tx1) {
            const half = th * (1 - (px - tx0) / (tx1 - tx0));
            if (Math.abs(py - c) <= half) inTri++;
          }
        }
      }
      const n = SS * SS;
      const a = inCircle / n;
      const t = inTri / n;
      for (let i = 0; i < 3; i++) {
        let v = bg[i] * (1 - a) + orange[i] * a;
        v = v * (1 - t) + dark[i] * t;
        row[1 + x * 3 + i] = Math.round(v);
      }
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bits
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(Buffer.concat(rows), { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------- build
await fs.rm(OUT, { recursive: true, force: true });
await fs.mkdir(OUT, { recursive: true });

for (const f of ['i18n.js', 'app.js', 'timeline.js', 'styles.css']) {
  await fs.copyFile(path.join(SRC, f), path.join(OUT, f));
}
for (const f of ['web-api.js', 'mobile.js', 'web.css', 'manifest.webmanifest', '_headers']) {
  await fs.copyFile(path.join(WEB, f), path.join(OUT, f));
}

const build = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
const sw = await fs.readFile(path.join(WEB, 'sw.js'), 'utf8');
if (!sw.includes('__BUILD__')) throw new Error('build-web: sw.js sem __BUILD__');
await fs.writeFile(path.join(OUT, 'sw.js'), sw.replaceAll('__BUILD__', build));

let html = await fs.readFile(path.join(SRC, 'index.html'), 'utf8');
// A CSP da web vai no _headers (precisa liberar a API do YouTube e blob: para arquivos locais).
html = replaceOnce(html, /\s*<meta http-equiv="Content-Security-Policy"[\s\S]*?\/>/, '', 'a CSP');
html = replaceOnce(
  html,
  /<meta charset="utf-8" \/>/,
  `<meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <meta name="theme-color" content="#14161a" />
  <meta name="description" content="Treine solos com loop A-B, velocidade e trechos salvos." />
  <meta name="mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
  <meta name="apple-mobile-web-app-title" content="SoloTracker" />
  <link rel="manifest" href="manifest.webmanifest" />
  <link rel="icon" type="image/png" sizes="192x192" href="icon-192.png" />
  <link rel="apple-touch-icon" href="icon-180.png" />`,
  'o meta charset',
);
html = replaceOnce(
  html,
  /<link rel="stylesheet" href="styles.css" \/>/,
  `<link rel="stylesheet" href="styles.css" />
  <link rel="stylesheet" href="web.css" />
  <script src="web-api.js"></script>`,
  'o styles.css',
);
html = replaceOnce(html, /<script src="app.js"><\/script>/, `<script src="app.js"></script>
  <script src="mobile.js"></script>`, 'o app.js');
// Versão no endereço dos arquivos: o domínio próprio no Cloudflare faz o navegador
// guardar CSS/JS por horas; com ?v=build cada deploy pede arquivos novos.
html = html.replace(/(src|href)="([\w.-]+\.(?:js|css|webmanifest))"/g, `$1="$2?v=${build}"`);
await fs.writeFile(path.join(OUT, 'index.html'), html);

for (const size of [180, 192, 512]) {
  await fs.writeFile(path.join(OUT, `icon-${size}.png`), png(size));
}

const files = await fs.readdir(OUT);
console.log(`Versão web gerada em dist-web/ (${files.length} arquivos, build ${build}).`);
