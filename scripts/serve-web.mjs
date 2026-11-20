// Servidor estático para testar dist-web/ no PC e no celular (mesma rede Wi-Fi).
//   npm run serve:web      (porta 8788; PORT=xxxx para trocar)
// Obs.: sem HTTPS, o celular não instala o app nem usa o service worker; o resto funciona.
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist-web');
const PORT = Number(process.env.PORT) || 8788;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
};

http
  .createServer(async (req, res) => {
    try {
      let rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (rel.endsWith('/')) rel += 'index.html';
      const file = path.join(ROOT, path.normalize(rel));
      if (!file.startsWith(ROOT + path.sep) || path.basename(file) === '_headers') throw new Error('fora');
      const data = await fs.readFile(file);
      res.writeHead(200, {
        'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
        'Referrer-Policy': 'strict-origin-when-cross-origin',
      });
      res.end(data);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Não encontrado');
    }
  })
  .listen(PORT, '0.0.0.0', () => {
    console.log(`SoloTracker web em http://localhost:${PORT}`);
    for (const list of Object.values(os.networkInterfaces())) {
      for (const a of list || []) {
        if (a.family === 'IPv4' && !a.internal) console.log(`  no celular (mesmo Wi-Fi): http://${a.address}:${PORT}`);
      }
    }
  });
