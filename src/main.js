const { app, BrowserWindow, ipcMain, shell, dialog, net } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const readline = require('readline');
const { spawn } = require('child_process');

// Permite dar play sem gesto do usuário dentro do iframe do YouTube.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

const RENDERER_DIR = path.join(__dirname, 'renderer');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

/**
 * O embed do YouTube exige um Referer HTTP válido (em file:// ele falha com erro 153).
 * Por isso servimos a interface a partir de um servidor local. A página é aberta como
 * http://localhost:<porta> — com 127.0.0.1 como referrer o YouTube recusa o vídeo.
 */
function startStaticServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      // Vídeos baixados (modo offline): /media/<videoId>
      if (urlPath.startsWith('/media/')) {
        const info = findOfflineFile(urlPath.slice('/media/'.length));
        if (!info) res.writeHead(404).end('Not found');
        else serveMedia(req, res, info);
        return;
      }
      // Trilhas separadas: /stems/<videoId>/guitar.flac | backing.flac
      if (urlPath.startsWith('/stems/')) {
        const info = findStemFile(...urlPath.slice('/stems/'.length).split('/'));
        if (!info) res.writeHead(404).end('Not found');
        else serveMedia(req, res, info);
        return;
      }
      const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
      const filePath = path.normalize(path.join(RENDERER_DIR, rel));
      if (!filePath.startsWith(RENDERER_DIR)) {
        res.writeHead(403).end();
        return;
      }
      fs.readFile(filePath, (err, data) => {
        if (err) {
          res.writeHead(404).end('Not found');
          return;
        }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
        res.end(data);
      });
    });
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

// ---------- Modo offline: vídeos baixados com o yt-dlp ----------
const VIDEO_ID_RE = /^[\w-]{11}$/;
const MEDIA_MIME = { '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm', '.mkv': 'video/x-matroska' };
const MEDIA_EXTS = Object.keys(MEDIA_MIME);
const EXE = process.platform === 'win32' ? '.exe' : '';
const videosDir = () => path.join(app.getPath('userData'), 'videos');
const binDir = () => path.join(app.getPath('userData'), 'bin');

/** Arquivo final de um vídeo baixado (<videoId>.<ext>), ou null. */
function findOfflineFile(id) {
  if (!VIDEO_ID_RE.test(id)) return null;
  for (const ext of MEDIA_EXTS) {
    const file = path.join(videosDir(), id + ext);
    try {
      const st = fs.statSync(file);
      if (st.isFile() && st.size > 0) return { file, size: st.size, ext };
    } catch {
      // não existe com essa extensão
    }
  }
  return null;
}

function listOffline() {
  const out = {};
  let names = [];
  try {
    names = fs.readdirSync(videosDir());
  } catch {
    return out;
  }
  names.forEach((name) => {
    const ext = path.extname(name);
    const id = path.basename(name, ext);
    if (!MEDIA_EXTS.includes(ext) || out[id]) return;
    const info = findOfflineFile(id);
    if (info) out[id] = { size: info.size };
  });
  return out;
}

/** Remove arquivos temporários de um download (e o arquivo final, se all=true). */
function removeVideoFiles(id, { all = false } = {}) {
  if (!VIDEO_ID_RE.test(id)) return;
  let names = [];
  try {
    names = fs.readdirSync(videosDir());
  } catch {
    return;
  }
  names
    .filter((name) => name.startsWith(`${id}.`))
    .filter((name) => all || !(MEDIA_EXTS.includes(path.extname(name)) && path.basename(name, path.extname(name)) === id))
    .forEach((name) => {
      try {
        fs.unlinkSync(path.join(videosDir(), name));
      } catch {
        // arquivo em uso ou já removido
      }
    });
}

/** Serve um arquivo de vídeo com suporte a Range (necessário para o seek). */
function serveMedia(req, res, info) {
  const { file, size, ext } = info;
  const headers = { 'Content-Type': info.mime || MEDIA_MIME[ext], 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' };
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  let start = 0;
  let end = size - 1;
  let status = 200;
  if (m && (m[1] || m[2])) {
    if (m[1]) {
      start = Number(m[1]);
      if (m[2]) end = Math.min(Number(m[2]), size - 1);
    } else {
      start = Math.max(0, size - Number(m[2])); // últimos N bytes
    }
    if (start > end || start >= size) {
      res.writeHead(416, { 'Content-Range': `bytes */${size}` }).end();
      return;
    }
    status = 206;
    headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
  }
  headers['Content-Length'] = end - start + 1;
  res.writeHead(status, headers);
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  const stream = fs.createReadStream(file, { start, end });
  stream.on('error', () => res.destroy());
  res.on('close', () => stream.destroy());
  stream.pipe(res);
}

function findOnPath(name) {
  for (const raw of (process.env.PATH || '').split(path.delimiter)) {
    const dir = raw.replace(/^"|"$/g, '');
    if (!dir) continue;
    const file = path.join(dir, name + EXE);
    if (fs.existsSync(file)) return file;
  }
  return null;
}

function runQuiet(cmd, args) {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, { windowsHide: true, stdio: 'ignore' });
    proc.on('error', () => resolve(false));
    proc.on('close', (code) => resolve(code === 0));
  });
}

let ytdlpChecked = false;
/**
 * Usa o yt-dlp do PATH (ex.: `winget install yt-dlp.yt-dlp`). Se não houver, baixa o
 * executável oficial para userData/bin e o atualiza a cada 7 dias.
 */
async function ensureYtDlp(report) {
  const system = findOnPath('yt-dlp');
  if (system) return system;
  const own = path.join(binDir(), `yt-dlp${EXE}`);
  if (!fs.existsSync(own)) {
    report('Baixando o yt-dlp (só na primeira vez)…');
    const asset = { win32: 'yt-dlp.exe', darwin: 'yt-dlp_macos' }[process.platform] || 'yt-dlp';
    const res = await net.fetch(`https://github.com/yt-dlp/yt-dlp/releases/latest/download/${asset}`);
    if (!res.ok) throw new Error(`Não foi possível baixar o yt-dlp (HTTP ${res.status}).`);
    const buf = Buffer.from(await res.arrayBuffer());
    fs.mkdirSync(binDir(), { recursive: true });
    fs.writeFileSync(`${own}.tmp`, buf, { mode: 0o755 });
    fs.renameSync(`${own}.tmp`, own);
  } else if (!ytdlpChecked && Date.now() - fs.statSync(own).mtimeMs > 7 * 864e5) {
    report('Atualizando o yt-dlp…');
    await runQuiet(own, ['-U']);
    const now = new Date();
    try {
      fs.utimesSync(own, now, now);
    } catch {
      // sem problema: tenta de novo na próxima vez
    }
  }
  ytdlpChecked = true;
  return own;
}

const findFfmpeg = () => {
  const own = path.join(binDir(), `ffmpeg${EXE}`);
  return findOnPath('ffmpeg') || (fs.existsSync(own) ? own : null);
};

const downloads = new Map(); // videoId -> { proc, canceled }

function killTree(proc) {
  if (!proc || proc.exitCode != null) return;
  // No Windows o yt-dlp.exe abre um processo filho; taskkill /T encerra os dois.
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { windowsHide: true });
  else proc.kill('SIGTERM');
}

function runYtDlp(ytdlp, args, job, report, hasFfmpeg) {
  return new Promise((resolve) => {
    const proc = spawn(ytdlp, args, { windowsHide: true });
    job.proc = proc;
    const errors = [];
    let lastPct = -1;
    let part = 1;
    const onLine = (line) => {
      const t = line.trim();
      if (!t) return;
      const m = /^\[download\]\s+(\d+(?:\.\d+)?)%/.exec(t);
      if (m) {
        const pct = Number(m[1]);
        if (pct + 5 < lastPct) part += 1; // começou o próximo arquivo (ex.: o áudio)
        lastPct = pct;
        const what = hasFfmpeg ? (part === 1 ? 'vídeo' : 'áudio') : 'vídeo';
        report(`Baixando ${what}…`, pct);
      } else if (/^\[Merger\]/.test(t)) {
        report('Juntando áudio e vídeo…', 100);
      } else if (/^(ERROR|WARNING):/.test(t) || /no such option/i.test(t)) {
        errors.push(t);
        if (errors.length > 8) errors.shift();
      }
    };
    readline.createInterface({ input: proc.stdout }).on('line', onLine);
    readline.createInterface({ input: proc.stderr }).on('line', onLine);
    proc.on('error', (err) => resolve({ ok: false, error: err.message }));
    proc.on('close', (code) => {
      if (job.canceled) resolve({ ok: false, canceled: true });
      else if (code === 0) resolve({ ok: true });
      else {
        const errLines = errors.filter((e) => !e.startsWith('WARNING')).join('\n') || errors.join('\n');
        resolve({ ok: false, error: errLines || `yt-dlp terminou com código ${code}.` });
      }
    });
  });
}

async function downloadVideo(id) {
  if (!VIDEO_ID_RE.test(id)) return { ok: false, error: 'ID de vídeo inválido.' };
  if (downloads.has(id)) return { ok: false, error: 'Este vídeo já está sendo baixado.' };
  const existing = findOfflineFile(id);
  if (existing) return { ok: true, info: { size: existing.size } };

  const job = { proc: null, canceled: false };
  downloads.set(id, job);
  const report = (stage, percent = null) => win?.webContents.send('offline:progress', { videoId: id, stage, percent });
  try {
    const ytdlp = await ensureYtDlp(report);
    if (job.canceled) return { ok: false, canceled: true };
    const ffmpeg = findFfmpeg();
    fs.mkdirSync(videosDir(), { recursive: true });

    // Com ffmpeg: melhor qualidade até 1080p (vídeo + áudio separados, juntados em .mp4).
    // Sem ffmpeg: o YouTube só oferece arquivo único em até 360p.
    const format = ffmpeg ? 'bv*[height<=1080][vcodec^=avc1]+ba[ext=m4a]/bv*[height<=1080]+ba/b[ext=mp4]/b' : 'b[ext=mp4]/b';
    const base = ['--no-playlist', '--newline', '--no-mtime', '--no-continue', '-f', format, '-o', path.join(videosDir(), `${id}.%(ext)s`)];
    if (ffmpeg) base.push('--merge-output-format', 'mp4', '--ffmpeg-location', ffmpeg);
    const url = ['--', `https://www.youtube.com/watch?v=${id}`];
    // O YouTube exige um runtime de JavaScript; o yt-dlp usa o Deno por padrão e o Node se for habilitado.
    const jsArgs = findOnPath('node') ? ['--js-runtimes', 'node'] : [];

    report('Conectando ao YouTube…', 0);
    let result = await runYtDlp(ytdlp, [...base, ...jsArgs, ...url], job, report, !!ffmpeg);
    if (!result.ok && !result.canceled && jsArgs.length && /js-runtimes|no such option/i.test(result.error)) {
      // yt-dlp antigo, sem essa opção: tenta de novo sem ela.
      result = await runYtDlp(ytdlp, [...base, ...url], job, report, !!ffmpeg);
    }
    if (!result.ok) {
      removeVideoFiles(id);
      return result;
    }
    removeVideoFiles(id); // sobras (.part, .f137.mp4 etc.)
    const info = findOfflineFile(id);
    if (!info) return { ok: false, error: 'O download terminou, mas o arquivo de vídeo não foi encontrado.' };
    return { ok: true, info: { size: info.size }, hd: !!ffmpeg };
  } catch (err) {
    removeVideoFiles(id);
    return { ok: false, error: err.message || String(err) };
  } finally {
    downloads.delete(id);
  }
}

ipcMain.handle('offline:list', () => listOffline());
ipcMain.handle('offline:download', (_e, id) => downloadVideo(String(id)));
ipcMain.handle('offline:cancel', (_e, id) => {
  const job = downloads.get(String(id));
  if (!job) return false;
  job.canceled = true;
  killTree(job.proc);
  return true;
});
ipcMain.handle('offline:remove', (_e, id) => {
  removeVideoFiles(String(id), { all: true });
  removeStems(String(id)); // as trilhas separadas dependem do vídeo baixado
  return !findOfflineFile(String(id));
});

// ---------- Stems: separar a guitarra com o Demucs (só modo offline) ----------
/*
 * Usa um ambiente Python próprio (userData/stems-env) com PyTorch (CPU), Demucs e PyAV.
 * O script src/stems/separate.py lê o áudio do vídeo baixado, separa com o modelo
 * htdemucs_6s e grava duas trilhas: guitar.flac e backing.flac (todo o resto).
 */
const STEM_NAMES = ['guitar', 'backing'];
const STEMS_ENV_VERSION = '1';
const stemsDir = () => path.join(app.getPath('userData'), 'stems');
const stemsEnvDir = () => path.join(app.getPath('userData'), 'stems-env');
const stemsEnvPython = () =>
  path.join(stemsEnvDir(), process.platform === 'win32' ? 'Scripts' : 'bin', `python${EXE}`);
const stemsEnvMarker = () => path.join(stemsEnvDir(), '.solotracker-ok');
const SEPARATE_SCRIPT = path.join(__dirname, 'stems', 'separate.py');

function findStemFile(id, name) {
  const m = /^(\w+)\.flac$/.exec(name || '');
  if (!VIDEO_ID_RE.test(id || '') || !m || !STEM_NAMES.includes(m[1])) return null;
  const file = path.join(stemsDir(), id, name);
  try {
    const st = fs.statSync(file);
    return st.isFile() && st.size > 0 ? { file, size: st.size, ext: '.flac', mime: 'audio/flac' } : null;
  } catch {
    return null;
  }
}

const hasStems = (id) => STEM_NAMES.every((n) => findStemFile(id, `${n}.flac`));

function listStems() {
  const out = {};
  let names = [];
  try {
    names = fs.readdirSync(stemsDir());
  } catch {
    return out;
  }
  names.filter((id) => VIDEO_ID_RE.test(id) && hasStems(id)).forEach((id) => (out[id] = true));
  return out;
}

function removeStems(id) {
  if (!VIDEO_ID_RE.test(id)) return;
  [id, `${id}.tmp`].forEach((dir) => fs.rmSync(path.join(stemsDir(), dir), { recursive: true, force: true }));
}

const stemsEnvReady = () => {
  try {
    return fs.readFileSync(stemsEnvMarker(), 'utf8').trim() === STEMS_ENV_VERSION && fs.existsSync(stemsEnvPython());
  } catch {
    return false;
  }
};

/** Roda um comando guardando as últimas linhas da saída; onLine recebe cada linha (\n ou \r). */
function runLogged(cmd, args, job, { onLine = () => {}, env } = {}) {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, {
      windowsHide: true,
      env: { ...process.env, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8', ...env },
    });
    if (job) job.proc = proc;
    let tail = [];
    const feed = (stream) => {
      let buf = '';
      stream.on('data', (chunk) => {
        buf += chunk.toString('utf8');
        const parts = buf.split(/\r\n|\r|\n/);
        buf = parts.pop();
        parts.forEach((line) => {
          const t = line.trim();
          if (!t) return;
          tail.push(t);
          if (tail.length > 30) tail = tail.slice(-30);
          onLine(t);
        });
      });
    };
    feed(proc.stdout);
    feed(proc.stderr);
    proc.on('error', (err) => resolve({ ok: false, error: err.message }));
    proc.on('close', (code) => {
      if (job?.canceled) resolve({ ok: false, canceled: true });
      else if (code === 0) resolve({ ok: true, tail });
      else resolve({ ok: false, error: tail.filter((l) => !/%\|/.test(l)).slice(-12).join('\n') || `código ${code}` });
    });
  });
}

/** Python 3.9–3.12 (as versões com PyTorch 2.5 para Windows). */
async function findPython() {
  const candidates = [];
  const python = findOnPath('python');
  if (python) candidates.push([python, []]);
  const launcher = findOnPath('py');
  if (launcher) ['3.12', '3.11', '3.10', '3.9'].forEach((v) => candidates.push([launcher, [`-${v}`]]));
  for (const [cmd, pre] of candidates) {
    const res = await runLogged(cmd, [...pre, '-c', 'import sys; print("PYVER %d.%d" % sys.version_info[:2])'], null);
    const m = res.ok && /PYVER 3\.(\d+)/.exec(res.tail.join('\n'));
    if (m && Number(m[1]) >= 9 && Number(m[1]) <= 12) return [cmd, pre];
  }
  return null;
}

async function ensureStemsEnv(job, report) {
  if (stemsEnvReady()) return;
  report('Procurando o Python…');
  const py = await findPython();
  if (!py) throw new Error('É preciso ter o Python 3.9 a 3.12 instalado (python.org ou "winget install Python.Python.3.12").');
  const steps = [
    ['Criando o ambiente Python…', py[0], [...py[1], '-m', 'venv', stemsEnvDir()]],
    [
      'Instalando o PyTorch (~250 MB, só na primeira vez)…',
      stemsEnvPython(),
      ['-m', 'pip', 'install', '--disable-pip-version-check', 'torch==2.5.1', 'torchaudio==2.5.1', '--index-url', 'https://download.pytorch.org/whl/cpu'],
    ],
    ['Instalando o Demucs…', stemsEnvPython(), ['-m', 'pip', 'install', '--disable-pip-version-check', '--no-deps', 'demucs==4.0.1']],
    [
      'Instalando dependências…',
      stemsEnvPython(),
      ['-m', 'pip', 'install', '--disable-pip-version-check', 'dora-search', 'einops', 'julius', 'openunmix', 'pyyaml', 'tqdm', 'soundfile', 'av', 'numpy<2.3'],
    ],
  ];
  for (const [label, cmd, args] of steps) {
    if (job.canceled) throw Object.assign(new Error('cancelado'), { canceled: true });
    report(label);
    const res = await runLogged(cmd, args, job);
    if (res.canceled) throw Object.assign(new Error('cancelado'), { canceled: true });
    if (!res.ok) throw new Error(`${label.replace(/….*$/, '')} falhou:\n${res.error}`);
  }
  // Opcional (o Demucs só usa para exportar MP3); sem ele o script cria um módulo vazio.
  await runLogged(stemsEnvPython(), ['-m', 'pip', 'install', '--disable-pip-version-check', '--only-binary=:all:', 'lameenc'], job);
  fs.writeFileSync(stemsEnvMarker(), STEMS_ENV_VERSION);
}

const stemJobs = new Map(); // videoId -> { proc, canceled }

async function separateStems(id) {
  if (!VIDEO_ID_RE.test(id)) return { ok: false, error: 'ID de vídeo inválido.' };
  if (stemJobs.has(id)) return { ok: false, error: 'A separação deste vídeo já está em andamento.' };
  if (hasStems(id)) return { ok: true };
  const media = findOfflineFile(id);
  if (!media) return { ok: false, error: 'Baixe o vídeo (modo offline) antes de separar a guitarra.' };

  const job = { proc: null, canceled: false };
  stemJobs.set(id, job);
  const report = (stage, percent = null) => win?.webContents.send('stems:progress', { videoId: id, stage, percent });
  const tmpDir = path.join(stemsDir(), `${id}.tmp`);
  try {
    await ensureStemsEnv(job, report);
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });
    let stage = 'Preparando…';
    report(stage);
    const res = await runLogged(stemsEnvPython(), ['-u', SEPARATE_SCRIPT, '--input', media.file, '--outdir', tmpDir], job, {
      env: { TORCH_HOME: path.join(stemsEnvDir(), 'torch') },
      onLine: (line) => {
        if (line.startsWith('STAGE ')) {
          stage = line.slice(6);
          report(stage);
          return;
        }
        const m = /(\d{1,3})%\|/.exec(line); // barras de progresso (tqdm / download do modelo)
        if (m) report(stage, Number(m[1]));
      },
    });
    if (!res.ok) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      return res;
    }
    const final = path.join(stemsDir(), id);
    fs.rmSync(final, { recursive: true, force: true });
    fs.renameSync(tmpDir, final);
    return hasStems(id) ? { ok: true } : { ok: false, error: 'A separação terminou, mas as trilhas não foram encontradas.' };
  } catch (err) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    if (err.canceled || job.canceled) return { ok: false, canceled: true };
    return { ok: false, error: err.message || String(err) };
  } finally {
    stemJobs.delete(id);
  }
}

ipcMain.handle('stems:list', () => listStems());
ipcMain.handle('stems:status', () => ({ envReady: stemsEnvReady() }));
ipcMain.handle('stems:separate', (_e, id) => separateStems(String(id)));
ipcMain.handle('stems:cancel', (_e, id) => {
  const job = stemJobs.get(String(id));
  if (!job) return false;
  job.canceled = true;
  killTree(job.proc);
  return true;
});
ipcMain.handle('stems:remove', (_e, id) => {
  removeStems(String(id));
  return !hasStems(String(id));
});

app.on('before-quit', () => {
  [...downloads.values(), ...stemJobs.values()].forEach((job) => {
    job.canceled = true;
    killTree(job.proc);
  });
});

// ---------- Persistência simples em JSON (userData) ----------
const storePath = () => path.join(app.getPath('userData'), 'solotracker-data.json');

function readStore() {
  try {
    return JSON.parse(fs.readFileSync(storePath(), 'utf8'));
  } catch {
    return {};
  }
}

function writeStore(data) {
  const tmp = storePath() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, storePath());
}

// ---------- Janela e ponte com o vídeo ----------
let win = null;
let bridgeFrame = null; // frame do iframe do YouTube que contém o <video>

async function createWindow() {
  const port = await startStaticServer();

  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 820,
    minHeight: 600,
    backgroundColor: '#14161a',
    title: 'SoloTracker',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      // Faz o preload rodar também dentro do iframe do YouTube, onde ele
      // atua como "ponte" controlando o elemento <video> diretamente.
      nodeIntegrationInSubFrames: true,
    },
  });

  // Links externos abrem no navegador padrão, nunca dentro do app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  win.on('closed', () => {
    win = null;
    bridgeFrame = null;
  });

  const initial = process.env.SOLOTRACKER_URL ? `#${encodeURIComponent(process.env.SOLOTRACKER_URL)}` : '';
  await win.loadURL(`http://localhost:${port}/${initial}`);

  if (process.env.SOLOTRACKER_DEBUG) win.webContents.openDevTools({ mode: 'detach' });
}

ipcMain.on('bridge:ready', (event) => {
  bridgeFrame = event.senderFrame;
  win?.webContents.send('video:event', { type: 'bridge-ready' });
});

ipcMain.on('bridge:event', (event, payload) => {
  if (event.senderFrame !== bridgeFrame) return;
  win?.webContents.send('video:event', payload);
});

ipcMain.on('video:cmd', (event, cmd) => {
  if (event.sender !== win?.webContents) return;
  try {
    if (bridgeFrame && !bridgeFrame.isDestroyed()) bridgeFrame.send('bridge:cmd', cmd);
  } catch {
    bridgeFrame = null;
  }
});

ipcMain.handle('store:load', () => readStore());
ipcMain.handle('store:save', (_e, data) => {
  writeStore(data);
  return true;
});
// ---------- Exportar / importar projetos (arquivos .json) ----------
const PROJECT_FILTERS = [{ name: 'Projeto SoloTracker', extensions: ['json'] }];

ipcMain.handle('project:export', async (_e, { fileName, data }) => {
  const safe = String(fileName || 'projeto').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 120);
  const res = await dialog.showSaveDialog(win, {
    title: 'Exportar projeto',
    defaultPath: path.join(app.getPath('documents'), `${safe}.solotracker.json`),
    filters: PROJECT_FILTERS,
  });
  if (res.canceled || !res.filePath) return false;
  fs.writeFileSync(res.filePath, JSON.stringify(data, null, 2));
  return true;
});

ipcMain.handle('project:import', async () => {
  const res = await dialog.showOpenDialog(win, {
    title: 'Importar projetos',
    properties: ['openFile', 'multiSelections'],
    filters: PROJECT_FILTERS,
  });
  if (res.canceled) return [];
  return res.filePaths
    .map((p) => {
      try {
        return JSON.parse(fs.readFileSync(p, 'utf8'));
      } catch {
        return null;
      }
    })
    .filter(Boolean);
});

ipcMain.handle('open-external', (_e, url) => {
  if (/^https:\/\/(www\.)?(youtube\.com|youtu\.be)\//.test(url)) shell.openExternal(url);
});

app.whenReady().then(() => {
  // O YouTube recusa o player quando o user agent contém "Electron/x" ou o nome do app.
  // Usamos o user agent do Chromium embutido, sem esses sufixos.
  app.userAgentFallback = app.userAgentFallback
    .replace(/\s?Electron\/\S+/i, '')
    .replace(new RegExp(`\\s?${app.getName()}\\/\\S+`, 'i'), '');
  createWindow();
});
app.on('window-all-closed', () => app.quit());
