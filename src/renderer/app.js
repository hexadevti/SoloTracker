/* global Timeline, fmtTime */
'use strict';

const $ = (id) => document.getElementById(id);
const api = window.solo;
I18N.translateDom(document); // textos fixos do index.html (i18n.js)
// Versão web (web/web-api.js): sem yt-dlp nem Demucs; "offline" = arquivo guardado no navegador.
const WEB = api.platform === 'web';
// Layout de celular (só na versão web): textos falam em toques em vez de teclas.
const TOUCH = document.documentElement.classList.contains('mobile');
const isYtId = (id) => /^[\w-]{11}$/.test(id || '');
// Na web, "offline" usa um arquivo do aparelho; no Electron, o vídeo baixado.
const FILE_WORD = WEB ? tr('arquivo salvo') : tr('vídeo baixado');

const DEFAULT_SETTINGS = {
  step: 2,
  bigStep: 10,
  fineStep: 0.1,
  jog: 2, // segundos por 100px arrastados
  gap: 0,
  preroll: 0,
  volume: 1,
};
const RATE_MIN = 0.25;
const RATE_MAX = 1.5;
const SPEED_PRESETS = [50, 60, 70, 75, 80, 90, 100];
const EXPORT_FORMAT = 'solotracker-project';

/*
 * Modelo de dados (salvo em userData/solotracker-data.json):
 * {
 *   version: 2, settings, lastProjectId,
 *   projects: { [id]: { id, name, nameEdited, videoId, videoTitle,
 *                       mode: 'online' | 'offline',   (offline = toca o arquivo baixado)
 *                       guitarOn,                     (com trilhas separadas: guitarra ligada?)
 *                       sections: [{ id, name, a, b, rate }],
 *                       last: { time, rate, loop }, created, updated } }
 * }
 */
const S = {
  projectId: null,
  time: 0,
  duration: 0,
  paused: true,
  rate: 1,
  playRate: null, // velocidade real informada pelo player (o YouTube na web pode arredondar)
  statusAt: 0,
  holdUntil: 0,
  dragTime: null,
  inGap: false,
  loop: { a: null, b: null, enabled: false },
  activeSectionId: null,
  capture: null, // null | 'a' | 'b'  (fluxo N → Enter → Enter)
  reps: 0,
  offline: {}, // videoId -> { size }  (vídeos baixados)
  downloads: {}, // videoId -> { stage, percent }  (downloads em andamento)
  stems: {}, // videoId -> true  (guitarra já separada)
  separating: {}, // videoId -> { stage, percent }  (separação em andamento)
  store: { version: 2, settings: { ...DEFAULT_SETTINGS }, projects: {}, lastProjectId: null },
};

// ---------------------------------------------------------------- utilidades
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round2 = (v) => Math.round(v * 100) / 100;
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const send = (type, data = {}) => api.send({ type, ...data });
const settings = () => S.store.settings;
const project = () => (S.projectId ? S.store.projects[S.projectId] : null);
const activeSection = () => project()?.sections.find((s) => s.id === S.activeSectionId) || null;
const hasLoop = () => S.loop.a != null && S.loop.b != null;

function parseVideoId(input) {
  const text = (input || '').trim();
  if (/^[\w-]{11}$/.test(text)) return { id: text, start: null };
  let url;
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\.|^m\.|^music\./, '');
  let id = null;
  if (host === 'youtu.be') id = url.pathname.slice(1, 12);
  else if (host.endsWith('youtube.com') || host.endsWith('youtube-nocookie.com')) {
    id = url.searchParams.get('v');
    if (!id) {
      const m = url.pathname.match(/\/(?:embed|shorts|live|v)\/([\w-]{11})/);
      if (m) id = m[1];
    }
  }
  if (!id || !/^[\w-]{11}$/.test(id)) return null;
  return { id, start: parseStart(url.searchParams.get('t') || url.searchParams.get('start')) };
}

function parseStart(t) {
  if (!t) return null;
  if (/^\d+(\.\d+)?$/.test(t)) return Number(t);
  const m = t.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  if (!m) return null;
  return (Number(m[1]) || 0) * 3600 + (Number(m[2]) || 0) * 60 + (Number(m[3]) || 0);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// ---------------------------------------------------------------- persistência
let saveTimer = null;
function saveSoon() {
  clearTimeout(saveTimer);
  $('saveState').textContent = project() ? tr('Salvando…') : '';
  saveTimer = setTimeout(async () => {
    await api.saveStore(S.store);
    $('saveState').textContent = project() ? tr('Salvo ✓') : '';
  }, 400);
}

/** Marca o projeto atual como modificado e salva. */
function touch() {
  const p = project();
  if (p) p.updated = Date.now();
  saveSoon();
}

function newProjectObj(videoId, name = '', videoTitle = '') {
  const now = Date.now();
  return {
    id: uid(),
    name: name || videoTitle || tr('Nova música'),
    nameEdited: !!name,
    videoId,
    videoTitle,
    sections: [],
    last: {},
    created: now,
    updated: now,
  };
}

/** Converte o formato antigo (dados por vídeo) para projetos. */
function migrateStore(data) {
  const store = {
    version: 2,
    settings: { ...DEFAULT_SETTINGS, ...(data.settings || {}) },
    projects: data.projects || {},
    lastProjectId: data.lastProjectId || null,
  };
  if (!data.projects && data.videos) {
    const byVideo = {};
    Object.entries(data.videos).forEach(([videoId, v]) => {
      const p = newProjectObj(videoId, '', v.title || '');
      p.sections = (v.loops || []).map((l) => ({ id: l.id || uid(), name: l.name, a: l.a, b: l.b, rate: l.rate || 1 }));
      p.last = v.last || {};
      p.updated = v.updated || p.updated;
      store.projects[p.id] = p;
      byVideo[videoId] = p.id;
    });
    if (data.recent && data.recent[0]) store.lastProjectId = byVideo[data.recent[0]] || null;
  }
  return store;
}

// ---------------------------------------------------------------- avisos
function toast(msg, ms = 1100) {
  const el = $('jogBadge');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.add('hidden'), ms);
}

// Tempo atual suavizado (interpola entre os status vindos da ponte).
function nowTime() {
  if (S.dragTime != null) return S.dragTime;
  let t = S.time;
  if (!S.paused && !S.inGap) t += ((performance.now() - S.statusAt) / 1000) * (S.playRate || S.rate);
  if (S.duration) t = Math.min(t, S.duration);
  const { a, b, enabled } = S.loop;
  if (enabled && a != null && b != null && t > b) t = b;
  return t;
}

// ---------------------------------------------------------------- comandos do player
function seek(t) {
  if (!S.projectId) return;
  t = clamp(t, 0, S.duration || Infinity);
  S.time = t;
  S.statusAt = performance.now();
  S.holdUntil = performance.now() + 300;
  send('seek', { time: t });
}

/** Setas, roda do mouse e botões ⟲ ⟳. Passar do fim do trecho solta o loop. */
function seekBy(delta) {
  const t = nowTime() + delta;
  const { b, enabled } = S.loop;
  if (!S.capture && hasLoop() && t > b + 0.01 && (enabled || S.activeSectionId)) {
    releaseLoop();
    seek(t);
    return;
  }
  seek(t);
  toast(`${delta > 0 ? '+' : '−'}${round2(Math.abs(delta))}s`);
}

let pendingSeek = null;
let seekTimer = null;
function seekThrottled(t) {
  S.dragTime = t;
  pendingSeek = t;
  if (seekTimer) return;
  seekTimer = setTimeout(() => {
    seekTimer = null;
    if (pendingSeek != null) {
      send('seek', { time: pendingSeek });
      pendingSeek = null;
    }
  }, 45);
}
/*
 * Início/fim de um arraste da posição. Na web, o player do YouTube continua tocando
 * (sem som) durante o arraste: pausado, ele cobre o vídeo com a camada de pausa.
 */
function scrubStart(wasPlaying) {
  if (WEB) send('scrubStart');
  else if (wasPlaying) send('pause');
}
function scrubEnd(play) {
  if (WEB) send('scrubEnd', { play });
  else if (play) send('play');
}
function endDragSeek(t) {
  clearTimeout(seekTimer);
  seekTimer = null;
  pendingSeek = null;
  S.dragTime = null;
  seek(t);
}

/*
 * Arrastar a posição para fora do trecho solta o loop. Durante o arraste o loop fica
 * suspenso (sem pular de volta para o A); ao soltar fora do trecho, o trecho é
 * desselecionado e o loop é limpo. Se voltar para dentro antes de soltar, nada muda.
 * Para voltar ao loop: clicar no trecho ou digitar o número dele.
 */
let loopSuspended = false;

/** Desseleciona o trecho e limpa o loop (o vídeo passa a tocar livre). */
function releaseLoop() {
  S.activeSectionId = null;
  S.loop = { a: null, b: null, enabled: false };
  resetReps();
  applyLoop();
  renderSections();
  toast(tr('Fora do trecho — loop livre'));
}

function scrubLoopCheck(t, phase) {
  if (S.capture || !hasLoop()) return;
  const { a, b, enabled } = S.loop;
  const outside = t < a - 0.01 || t > b + 0.01;
  if (phase !== 'end') {
    if (outside && enabled) {
      S.loop.enabled = false;
      loopSuspended = true;
      send('setLoop', { a, b, enabled: false });
    } else if (!outside && loopSuspended) {
      S.loop.enabled = true;
      loopSuspended = false;
      send('setLoop', { a, b, enabled: true });
    }
    return;
  }
  const suspended = loopSuspended;
  loopSuspended = false;
  if (outside && (suspended || enabled || S.activeSectionId)) {
    releaseLoop();
  } else if (!outside && suspended) {
    S.loop.enabled = true; // soltou dentro do trecho: o loop continua
    send('setLoop', { a, b, enabled: true });
  }
}

function togglePlay() {
  if (S.projectId) send('toggle');
}

/**
 * Define a velocidade. Com sync=true (padrão), a velocidade é gravada no trecho
 * selecionado — exceto durante o treino progressivo, que muda a velocidade sozinho.
 */
function setRate(r, { silent = false, sync = true } = {}) {
  S.rate = round2(clamp(r, RATE_MIN, RATE_MAX));
  send('setRate', { rate: S.rate });
  const pct = Math.round(S.rate * 100);
  $('speedRange').value = pct;
  $('speedValue').textContent = `${pct}%`;
  document.querySelectorAll('#speedPresets button').forEach((b) => {
    b.classList.toggle('active', Number(b.dataset.pct) === pct);
  });
  const p = project();
  if (p) {
    p.last.rate = S.rate;
    saveSoon();
  }
  const sec = sync && !S.capture ? activeSection() : null;
  if (sec && sec.rate !== S.rate) {
    sec.rate = S.rate;
    touch();
    updateSectionRange(sec);
  }
  if (!silent) toast(sec ? tr('Velocidade {pct}% · {name}', { pct, name: sec.name }) : tr('Velocidade {pct}%', { pct }));
}

// ---------------------------------------------------------------- loop
/**
 * Envia o loop para o player e atualiza a interface.
 * Com save=true, persiste o estado e sincroniza o trecho ativo (ajustes de A/B
 * em um trecho selecionado são gravados nele automaticamente).
 */
function applyLoop({ save = true } = {}) {
  const { a, b, enabled } = S.loop;
  send('setLoop', { a, b, enabled: enabled && a != null && b != null });
  $('loopA').textContent = a != null ? fmtTime(a, true) : '--';
  $('loopB').textContent = b != null ? fmtTime(b, true) : '--';
  const btn = $('btnLoop');
  btn.textContent = `Loop: ${enabled ? 'ON' : 'OFF'}`;
  btn.classList.toggle('on', enabled);
  $('zoomWrap').classList.toggle('hidden', !hasLoop());
  $('repCounter').classList.toggle('hidden', !(enabled && hasLoop()));
  updateRepCounter();

  if (!hasLoop()) S.activeSectionId = null;
  if (save) {
    const sec = activeSection();
    if (sec && !S.capture && (sec.a !== a || sec.b !== b)) {
      sec.a = a;
      sec.b = b;
      sortSections();
      renderSections();
    }
    const p = project();
    if (p) {
      p.last.loop = { ...S.loop };
      touch();
    }
  }
  updateActiveSectionLabel();
}

function setA(t) {
  t = round2(t);
  const { b } = S.loop;
  if (b != null && t >= b - 0.05) {
    S.loop = { a: t, b: null, enabled: false };
  } else {
    S.loop.a = t;
    if (b != null) S.loop.enabled = true;
  }
  resetReps();
  applyLoop();
  toast(tr('Início = {t}', { t: fmtTime(t, true) }));
}

function setB(t) {
  t = round2(t);
  let { a } = S.loop;
  if (a == null) a = 0;
  if (t <= a + 0.05) S.loop = { a: t, b: a, enabled: true }; // marcou o fim antes do início: inverte
  else S.loop = { a, b: t, enabled: true };
  if (S.loop.b - S.loop.a < 0.05) S.loop.b = round2(S.loop.a + 0.05);
  resetReps();
  applyLoop();
  toast(tr('Fim = {t}', { t: fmtTime(S.loop.b, true) }));
}

function nudge(which, dir) {
  const step = settings().fineStep * dir;
  const { a, b } = S.loop;
  if (which === 'a' && a != null) {
    const max = b != null ? b - 0.05 : S.duration;
    S.loop.a = round2(clamp(a + step, 0, max));
    applyLoop();
    seek(S.loop.a);
  } else if (which === 'b' && b != null) {
    S.loop.b = round2(clamp(b + step, (a ?? 0) + 0.05, S.duration || Infinity));
    applyLoop();
    // Para conferir o fim, toca a partir de ~1,5s antes do B.
    seek(Math.max(S.loop.a ?? 0, S.loop.b - 1.5));
  }
}

function toggleLoop() {
  if (!hasLoop()) {
    toast(TOUCH ? tr('Crie um trecho primeiro (＋ Novo trecho)') : tr('Crie um trecho primeiro (N)'));
    return;
  }
  S.loop.enabled = !S.loop.enabled;
  resetReps();
  applyLoop();
}

function clearLoop() {
  S.activeSectionId = null;
  S.loop = { a: null, b: null, enabled: false };
  resetReps();
  applyLoop();
  renderSections();
}

function goToA() {
  const target = S.loop.a != null ? S.loop.a - settings().preroll : 0;
  seek(Math.max(0, target));
}

function resetReps() {
  S.reps = 0;
  updateRepCounter();
}

function updateRepCounter() {
  $('repCounter').textContent = tr('Repetição {n}', { n: S.reps + 1 });
}

function updateActiveSectionLabel() {
  const sec = activeSection();
  const el = $('activeSection');
  el.classList.toggle('hidden', !sec);
  if (sec) el.textContent = sec.name;
}

// ---------------------------------------------------------------- novo trecho: N → Enter → Enter
function startCapture() {
  if (!project()) return;
  S.capture = 'a';
  S.activeSectionId = null;
  S.loop = { a: null, b: null, enabled: false };
  resetReps();
  applyLoop({ save: false });
  renderSections();
  updateCaptureUi();
}

function cancelCapture() {
  S.capture = null;
  S.loop = { a: null, b: null, enabled: false };
  applyLoop({ save: false });
  updateCaptureUi();
  toast(tr('Novo trecho cancelado'));
}

function captureMark() {
  const t = round2(nowTime());
  if (S.capture === 'a') {
    S.loop = { a: t, b: null, enabled: false };
    applyLoop({ save: false });
    S.capture = 'b';
    updateCaptureUi();
    toast(tr('Início = {t}', { t: fmtTime(t, true) }));
    return;
  }
  // Marcando o fim: cria e salva o trecho.
  const a0 = S.loop.a;
  let a = Math.min(a0, t);
  let b = Math.max(a0, t);
  if (b - a < 0.2) {
    toast(tr('Trecho muito curto — deixe tocar um pouco antes de marcar o fim'));
    return;
  }
  a = round2(a);
  b = round2(b);
  const p = project();
  // Nome = só o número, na ordem de criação (não reaproveita números de trechos apagados).
  p.sectionSeq = Math.max(p.sectionSeq || 0, p.sections.length) + 1;
  const sec = { id: uid(), name: String(p.sectionSeq), a, b, rate: S.rate };
  p.sections.push(sec);
  sortSections();
  S.capture = null;
  S.activeSectionId = sec.id;
  S.loop = { a, b, enabled: true };
  resetReps();
  applyLoop();
  updateCaptureUi();
  renderSections();
  goToA();
  send('play');
  toast(tr('{name} salvo', { name: sec.name }));
}

function updateCaptureUi() {
  const el = $('captureBanner');
  const btn = $('btnNewSection');
  $('btnClearLoop').textContent = S.capture ? tr('Cancelar') : tr('Limpar');
  if (!S.capture) {
    el.classList.add('hidden');
    btn.classList.remove('recording');
    btn.textContent = tr('＋ Novo trecho');
    return;
  }
  btn.classList.add('recording');
  btn.textContent = S.capture === 'a' ? tr('● Marcar início') : tr('● Marcar fim');
  el.classList.remove('hidden');
  if (TOUCH) {
    el.innerHTML =
      S.capture === 'a'
        ? `<span class="dot"></span> ${tr('NOVO TRECHO — toque em <b>Marcar início</b>')}`
        : `<span class="dot"></span> ${tr('Início {t} — toque em <b>Marcar fim</b>', { t: fmtTime(S.loop.a, true) })}`;
    return;
  }
  el.innerHTML =
    S.capture === 'a'
      ? `<span class="dot"></span> ${tr('NOVO TRECHO — <kbd>Enter</kbd> marca o <b>início</b> · <kbd>Esc</kbd> cancela')}`
      : `<span class="dot"></span> ${tr('Início {t} — <kbd>Enter</kbd> marca o <b>fim</b> · <kbd>Esc</kbd> cancela', { t: fmtTime(S.loop.a, true) })}`;
}

// ---------------------------------------------------------------- trechos do projeto
function sortSections() {
  const p = project();
  if (p) p.sections.sort((x, y) => x.a - y.a || x.b - y.b);
}

function openSection(sec) {
  S.capture = null;
  updateCaptureUi();
  S.activeSectionId = sec.id;
  S.loop = { a: sec.a, b: sec.b, enabled: true };
  resetReps();
  applyLoop();
  if (sec.rate) setRate(sec.rate, { silent: true });
  goToA();
  send('play');
  renderSections();
  toast(sec.name);
}

const sectionRangeText = (sec) =>
  `${fmtTime(sec.a, true)} → ${fmtTime(sec.b, true)} · ${Math.round((sec.rate || 1) * 100)}%`;

/** Atualiza só a linha de tempo/velocidade do trecho (sem redesenhar a lista). */
function updateSectionRange(sec) {
  const el = document.querySelector(`#sectionList li[data-id="${sec.id}"] .range`);
  if (el) el.textContent = sectionRangeText(sec);
}

let lastSectionTap = { id: null, at: 0 };
function renderSections(editId = null) {
  sortSections(); // lista sempre em ordem de tempo (início, depois fim)
  const p = project();
  const list = $('sectionList');
  list.innerHTML = '';
  const sections = p ? p.sections : [];
  $('sectionListEmpty').classList.toggle('hidden', sections.length > 0 || !p);

  sections.forEach((sec, i) => {
    const li = document.createElement('li');
    li.className = `loop-item${sec.id === S.activeSectionId ? ' active' : ''}`;
    li.dataset.id = sec.id;
    li.innerHTML = `
      <span class="idx">${i < 10 ? (i + 1) % 10 : ''}</span>
      <div class="info">
        <span class="name"></span>
        <span class="range">${sectionRangeText(sec)}</span>
      </div>
      <button class="btn tiny" data-act="rename" title="${tr('Renomear')}">✎</button>
      <button class="btn tiny danger" data-act="delete" title="${tr('Excluir')}">✕</button>
    `;
    li.querySelector('.name').textContent = sec.name;
    li.addEventListener('click', (e) => {
      if (e.target.closest('input')) return;
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'delete') {
        if (!window.confirm(tr('Excluir "{name}"?', { name: sec.name }))) return;
        p.sections = p.sections.filter((x) => x.id !== sec.id);
        if (S.activeSectionId === sec.id) S.activeSectionId = null;
        touch();
        renderSections();
        updateActiveSectionLabel();
      } else if (act === 'rename') {
        startRename(li, sec);
      } else {
        // 1 toque: abre o trecho (no selecionado, volta ao início). 2 toques seguidos no
        // trecho selecionado: tira a seleção.
        const now = performance.now();
        const twice = lastSectionTap.id === sec.id && now - lastSectionTap.at < 400;
        lastSectionTap = twice ? { id: null, at: 0 } : { id: sec.id, at: now };
        if (twice && sec.id === S.activeSectionId && !S.capture) {
          clearLoop();
          toast(tr('Saiu do trecho'));
        } else {
          openSection(sec);
        }
      }
    });
    li.addEventListener('dblclick', (e) => {
      if (e.target.closest('.name')) startRename(li, sec);
    });
    list.appendChild(li);
    if (sec.id === editId) startRename(li, sec);
  });
}

function startRename(li, sec) {
  const nameEl = li.querySelector('.name');
  if (!nameEl) return;
  const input = document.createElement('input');
  input.type = 'text';
  input.value = sec.name;
  input.className = 'rename';
  nameEl.replaceWith(input);
  input.focus();
  input.select();
  let done = false;
  const commit = (ok) => {
    if (done) return;
    done = true;
    if (ok && input.value.trim()) {
      sec.name = input.value.trim();
      touch();
    }
    renderSections();
    updateActiveSectionLabel();
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') commit(true);
    if (e.key === 'Escape') commit(false);
    e.stopPropagation();
  });
  input.addEventListener('blur', () => commit(true));
}

function onLoopWrapped() {
  S.reps += 1;
  updateRepCounter();
}

// ---------------------------------------------------------------- projetos
/** Abre o projeto mais recente desse vídeo, ou cria um novo. */
function openFromUrl(parsed) {
  const existing = Object.values(S.store.projects)
    .filter((p) => p.videoId === parsed.id)
    .sort((x, y) => y.updated - x.updated)[0];
  if (existing) {
    openProject(existing.id, { start: parsed.start });
  } else {
    const p = newProjectObj(parsed.id);
    S.store.projects[p.id] = p;
    openProject(p.id, { start: parsed.start });
    toast(tr('Novo projeto criado'));
  }
}

function createProject(videoId, name) {
  const p = newProjectObj(videoId, name);
  S.store.projects[p.id] = p;
  openProject(p.id);
  toast(tr('Novo projeto criado'));
}

function openProject(id, { start = null, autoplay = true } = {}) {
  const p = S.store.projects[id];
  if (!p) return;
  S.projectId = id;
  S.store.lastProjectId = id;
  p.updated = Date.now();

  S.capture = null;
  updateCaptureUi();
  S.time = start ?? p.last.time ?? 0;
  S.duration = p.duration || 0;
  S.videoLoaded = false;
  S.paused = true;
  S.activeSectionId = null;
  S.loop = p.last.loop && p.last.loop.a != null ? { ...p.last.loop } : { a: null, b: null, enabled: false };
  // Se o loop restaurado bate com um trecho salvo, ele volta a ser o trecho ativo.
  const match = p.sections.find((s) => s.a === S.loop.a && s.b === S.loop.b);
  if (match) S.activeSectionId = match.id;
  resetReps();
  applyLoop({ save: false });
  setRate(p.last.rate || 1, { silent: true, sync: false });

  loadPlayer(p, start ?? p.last.time ?? 0, autoplay);

  $('videoTitle').textContent = p.videoTitle || '';
  $('urlInput').value = '';
  $('projectName').disabled = false;
  $('projectName').value = p.name;
  $('btnExport').disabled = false;
  document.title = `${p.name} — SoloTracker`;
  updateModeButton();
  renderSections();
  saveSoon();
}

/** Carrega o vídeo do projeto no iframe: embed do YouTube (online) ou player local (offline). */
function loadPlayer(p, startAt, autoplay) {
  const fileProject = !isYtId(p.videoId);
  if (fileProject && !S.offline[p.videoId]) {
    showMissingFile(p);
    return;
  }
  if (p.mode === 'offline' && !S.offline[p.videoId]) {
    p.mode = 'online';
    toast(WEB ? tr('Arquivo não encontrado neste aparelho — tocando pelo YouTube') : tr('Vídeo baixado não encontrado — tocando pelo YouTube'));
    saveSoon();
  }
  if (api.loadPlayer) {
    // Web: o player (YouTube IFrame API ou <video> local) fica na própria página.
    S.time = startAt;
    S.statusAt = performance.now();
    S.paused = true;
    S.videoLoaded = false;
    $('placeholder').classList.add('hidden');
    $('errorBox').classList.add('hidden');
    $('ytFrame').classList.add('hidden');
    $('jogOverlay').classList.remove('hidden');
    api.loadPlayer({ mode: fileProject ? 'offline' : p.mode || 'online', videoId: p.videoId, start: startAt, autoplay });
    return;
  }
  let src;
  if (p.mode === 'offline') {
    const params = new URLSearchParams({ v: p.videoId });
    if (startAt > 0) params.set('start', String(round2(startAt)));
    if (!autoplay) params.set('st_paused', '1');
    if (S.stems[p.videoId]) {
      params.set('stems', '1');
      if (p.guitarOn === false) params.set('guitar', '0');
    }
    src = `/player.html?${params}`;
  } else {
    const params = new URLSearchParams({
      autoplay: '1',
      controls: '0',
      rel: '0',
      playsinline: '1',
      iv_load_policy: '3',
      disablekb: '1',
      fs: '0',
      modestbranding: '1',
    });
    if (startAt > 1) params.set('start', String(Math.floor(startAt)));
    if (!autoplay) params.set('st_paused', '1'); // a ponte pausa assim que o vídeo começar
    src = `https://www.youtube.com/embed/${p.videoId}?${params}`;
  }
  S.time = startAt;
  S.statusAt = performance.now();
  S.paused = true;
  S.videoLoaded = false;
  $('placeholder').classList.add('hidden');
  $('errorBox').classList.add('hidden');
  $('ytFrame').classList.remove('hidden');
  $('jogOverlay').classList.remove('hidden');
  $('ytFrame').src = src;
}

/** Projeto de arquivo (web) cujo arquivo não está neste aparelho: pede para escolher. */
function showMissingFile(p) {
  if (api.unloadPlayer) api.unloadPlayer();
  S.paused = true;
  S.videoLoaded = false;
  $('placeholder').classList.add('hidden');
  $('jogOverlay').classList.add('hidden');
  const box = $('errorBox');
  box.innerHTML = '';
  const msg = document.createElement('p');
  msg.textContent = p.fileName
    ? tr('O arquivo deste projeto ({name}) não está salvo neste aparelho.', { name: p.fileName })
    : tr('O arquivo deste projeto não está salvo neste aparelho.');
  const btn = document.createElement('button');
  btn.className = 'btn primary';
  btn.textContent = tr('📂 Escolher arquivo');
  btn.onclick = () => attachFile(p);
  box.append(msg, btn);
  box.classList.remove('hidden');
}

/** Web: escolhe um arquivo de vídeo/áudio do aparelho, guarda no navegador e toca. */
async function attachFile(p) {
  const vid = p.videoId;
  S.downloads[vid] = { stage: tr('Escolhendo o arquivo…'), percent: null };
  updateModeButton();
  // Chamado direto no clique: o seletor de arquivos precisa do gesto do usuário.
  const res = await api.offline.download(vid);
  delete S.downloads[vid];
  if (res.ok) {
    S.offline[vid] = res.info;
    if (!isYtId(vid)) p.fileName = res.info.name;
    p.mode = 'offline';
    touch();
    if (p.id === S.projectId) loadPlayer(p, isYtId(vid) ? nowTime() : p.last.time || 0, true);
    toast(tr('Arquivo salvo neste aparelho — tocando offline'));
  } else if (!res.canceled) {
    window.alert(`${tr('Não foi possível usar o arquivo.')}\n\n${tr(res.error)}`);
  }
  updateModeButton();
  if (libraryOpen()) renderLibrary();
}

/** Web: cria um projeto a partir de um arquivo do aparelho (sem YouTube). */
async function createFileProject() {
  const id = `file-${uid()}`;
  const res = await api.offline.download(id);
  if (!res.ok) {
    if (!res.canceled) window.alert(`${tr('Não foi possível usar o arquivo.')}\n\n${tr(res.error)}`);
    return;
  }
  S.offline[id] = res.info;
  const title = res.info.name.replace(/\.[^.]+$/, '');
  const p = newProjectObj(id, '', title);
  p.mode = 'offline';
  p.fileName = res.info.name;
  S.store.projects[p.id] = p;
  closeLibrary();
  openProject(p.id);
  toast(tr('Novo projeto criado'));
}

// ---------------------------------------------------------------- online / offline
const fmtSize = (bytes) => `${Math.round(bytes / 1048576)} MB`;

function updateModeButton() {
  updateGuitarButton();
  const btn = $('btnMode');
  const p = project();
  btn.disabled = !p;
  btn.classList.remove('offline', 'busy');
  if (!p) {
    btn.textContent = WEB ? '▶ YouTube' : '🌐 Online';
    btn.title = '';
    return;
  }
  const dl = S.downloads[p.videoId];
  const file = S.offline[p.videoId];
  if (WEB) {
    if (dl) {
      btn.classList.add('busy');
      btn.textContent = tr('📂 Escolhendo…');
      btn.title = tr('Clique para cancelar.');
    } else if (p.mode === 'offline' || !isYtId(p.videoId)) {
      btn.classList.add('offline');
      btn.textContent = tr('📂 Arquivo');
      btn.title = file
        ? tr('Tocando "{name}" ({size}), salvo neste aparelho.', { name: file.name, size: fmtSize(file.size) }) +
          (isYtId(p.videoId) ? `\n${tr('Clique para voltar a tocar pelo YouTube.')}` : '')
        : tr('Arquivo não encontrado neste aparelho.');
    } else {
      btn.textContent = '▶ YouTube';
      btn.title = file
        ? tr('Tocando pelo YouTube. Clique para tocar o arquivo salvo neste aparelho.')
        : tr('Tocando pelo YouTube. Clique para escolher um arquivo de vídeo ou áudio deste aparelho (velocidade livre e loop preciso).');
    }
    return;
  }
  if (dl) {
    btn.classList.add('busy');
    btn.textContent = dl.percent != null ? `⏳ ${Math.floor(dl.percent)}%` : tr('⏳ Baixando…');
    btn.title = `${tr(dl.stage || 'Baixando…')}\n${tr('Clique para cancelar.')}`;
  } else if (p.mode === 'offline') {
    btn.classList.add('offline');
    btn.textContent = '💾 Offline';
    btn.title = tr('Tocando o vídeo baixado ({size}), sem acessar o YouTube.\nClique para voltar a tocar pelo YouTube (online).', { size: fmtSize(file?.size || 0) });
  } else {
    btn.textContent = '🌐 Online';
    btn.title = file
      ? tr('Tocando pelo YouTube. O vídeo já está baixado: clique para tocar offline.')
      : tr('Tocando pelo YouTube. Clique para baixar o vídeo e tocar offline.');
  }
}

/** Troca o modo de um projeto e, se for o atual, recarrega o player na mesma posição. */
function setMode(p, mode) {
  if (p.mode === mode || (mode === 'online' && !isYtId(p.videoId))) return;
  p.mode = mode;
  touch();
  if (p.id === S.projectId) loadPlayer(p, nowTime(), !S.paused);
  updateModeButton();
  if (libraryOpen()) renderLibrary();
}

async function toggleMode() {
  const p = project();
  if (!p) return;
  const vid = p.videoId;
  if (S.downloads[vid]) {
    if (window.confirm(WEB ? tr('Cancelar a escolha do arquivo?') : tr('Cancelar o download deste vídeo?'))) api.offline.cancel(vid);
    return;
  }
  if (!isYtId(vid)) {
    // Projeto de arquivo: não tem versão online.
    if (!S.offline[vid]) attachFile(p);
    else toast(tr('Este projeto toca um arquivo salvo neste aparelho'));
    return;
  }
  if (p.mode === 'offline') {
    setMode(p, 'online');
    toast(tr('Online — tocando pelo YouTube'));
    return;
  }
  if (S.offline[vid]) {
    setMode(p, 'offline');
    toast(WEB ? tr('Tocando o arquivo salvo neste aparelho') : tr('Offline — tocando o vídeo baixado'));
    return;
  }
  if (WEB) {
    attachFile(p);
    return;
  }

  S.downloads[vid] = { stage: tr('Preparando…'), percent: null };
  updateModeButton();
  toast(tr('Baixando o vídeo…'));
  const res = await api.offline.download(vid);
  delete S.downloads[vid];
  if (res.ok) {
    S.offline[vid] = res.info;
    setMode(p, 'offline');
    toast(res.hd === false ? tr('Baixado em 360p (instale o ffmpeg para HD) — tocando offline') : tr('Baixado — tocando offline'));
  } else if (res.canceled) {
    toast(tr('Download cancelado'));
  } else {
    window.alert(
      `${tr('Não foi possível baixar o vídeo.')}\n\n${tr(res.error)}\n\n` +
        tr('Se o YouTube pedir para confirmar que você não é um robô, espere um pouco e tente de novo.'),
    );
  }
  updateModeButton();
  if (libraryOpen()) renderLibrary();
}

// ---------------------------------------------------------------- stems (guitarra separada)
/** Botão da guitarra: só aparece no modo offline (ou enquanto a separação roda). */
function updateGuitarButton() {
  const btn = $('btnGuitar');
  const p = project();
  const job = p && S.separating[p.videoId];
  btn.classList.toggle('hidden', !api.stems || !p || (p.mode !== 'offline' && !job));
  btn.classList.remove('on', 'off', 'busy');
  if (!p) return;
  if (job) {
    btn.classList.add('busy');
    const stage = tr(job.stage || 'Separando…').replace(/\s*\(.*?\)/g, '');
    btn.textContent = job.percent != null ? `⏳ ${stage.replace(/…$/, '')} ${Math.floor(job.percent)}%` : `⏳ ${stage}`;
    btn.title = `${tr(job.stage || 'Separando a guitarra…')}\n${tr('Clique para cancelar.')}`;
  } else if (S.stems[p.videoId]) {
    const on = p.guitarOn !== false;
    btn.classList.add(on ? 'on' : 'off');
    btn.textContent = on ? tr('🎸 Guitarra: ON') : tr('🎸 Guitarra: OFF');
    btn.title = on ? tr('Clique para tirar a guitarra do áudio (G).') : tr('Clique para voltar a guitarra do áudio (G).');
  } else {
    btn.textContent = tr('🎸 Separar guitarra');
    btn.title = tr('Separa a trilha de guitarra do áudio com IA (Demucs), para poder ligar e desligar a guitarra.\nLeva alguns minutos por música.');
  }
}

async function onGuitarButton() {
  const p = project();
  if (!p) return;
  const vid = p.videoId;
  if (S.separating[vid]) {
    if (window.confirm(tr('Cancelar a separação da guitarra?'))) api.stems.cancel(vid);
    return;
  }
  if (p.mode !== 'offline') return;
  if (S.stems[vid]) {
    toggleGuitar();
    return;
  }
  const { envReady } = await api.stems.status();
  if (
    !envReady &&
    !window.confirm(
      tr('Na primeira vez o app instala o separador de áudio (Demucs + PyTorch, cerca de 1 GB em %APPDATA%/solotracker/stems-env). É preciso ter o Python 3.9–3.12 instalado.\n\nContinuar?'),
    )
  ) {
    return;
  }
  S.separating[vid] = { stage: tr('Preparando…'), percent: null };
  updateGuitarButton();
  const res = await api.stems.separate(vid);
  delete S.separating[vid];
  if (res.ok) {
    S.stems[vid] = true;
    const cur = project();
    if (cur && cur.videoId === vid && cur.mode === 'offline') loadPlayer(cur, nowTime(), !S.paused);
    toast(tr('Guitarra separada — use G para ligar/desligar'));
  } else if (res.canceled) {
    toast(tr('Separação cancelada'));
  } else {
    window.alert(`${tr('Não foi possível separar a guitarra.')}\n\n${tr(res.error)}`);
  }
  updateGuitarButton();
  if (libraryOpen()) renderLibrary();
}

function toggleGuitar() {
  const p = project();
  if (!api.stems) {
    toast(tr('Separar a guitarra só funciona no app para PC'));
    return;
  }
  if (!p || p.mode !== 'offline' || !S.stems[p.videoId]) {
    toast(p && p.mode === 'offline' ? tr('Separe a guitarra primeiro (botão 🎸)') : tr('Disponível só no modo offline'));
    return;
  }
  p.guitarOn = p.guitarOn === false;
  send('setGuitar', { on: p.guitarOn });
  touch();
  updateGuitarButton();
  toast(p.guitarOn ? tr('Guitarra ligada') : tr('Guitarra desligada'));
}

/** Apaga o arquivo baixado (e as trilhas separadas); projetos desse vídeo em modo offline voltam para online. */
async function removeOfflineFile(videoId) {
  Object.values(S.store.projects)
    .filter((p) => p.videoId === videoId && p.mode === 'offline')
    .forEach((p) => setMode(p, 'online'));
  await api.offline.remove(videoId);
  delete S.offline[videoId];
  delete S.stems[videoId];
  // Projeto de arquivo aberto sem o arquivo: mostra o pedido para escolher outro.
  const cur = project();
  if (cur && cur.videoId === videoId && !isYtId(videoId)) loadPlayer(cur, 0, false);
  updateModeButton();
  if (libraryOpen()) renderLibrary();
}

function closeCurrentProjectView() {
  S.projectId = null;
  S.store.lastProjectId = null;
  if (api.unloadPlayer) api.unloadPlayer();
  else $('ytFrame').src = 'about:blank';
  $('errorBox').classList.add('hidden');
  $('ytFrame').classList.add('hidden');
  $('jogOverlay').classList.add('hidden');
  $('placeholder').classList.remove('hidden');
  $('projectName').value = '';
  $('projectName').disabled = true;
  $('btnExport').disabled = true;
  updateModeButton();
  $('videoTitle').textContent = '';
  $('saveState').textContent = '';
  document.title = 'SoloTracker';
  S.loop = { a: null, b: null, enabled: false };
  S.duration = 0;
  S.time = 0;
  applyLoop({ save: false });
  renderSections();
}

function deleteProject(id) {
  const p = S.store.projects[id];
  if (!p) return;
  // O vídeo baixado é apagado junto se nenhum outro projeto usa o mesmo vídeo.
  const lastUser =
    S.offline[p.videoId] && !Object.values(S.store.projects).some((o) => o.id !== id && o.videoId === p.videoId);
  const fileNote = lastUser ? ` ${tr('O {file} ({size}) também será apagado.', { file: FILE_WORD, size: fmtSize(S.offline[p.videoId].size) })}` : '';
  if (!window.confirm(tr('Excluir o projeto "{name}" e seus {n} trecho(s)?', { name: p.name, n: p.sections.length }) + fileNote)) return;
  delete S.store.projects[id];
  if (S.projectId === id) closeCurrentProjectView();
  if (lastUser) removeOfflineFile(p.videoId);
  saveSoon();
  renderLibrary();
}

function exportData(p) {
  const yt = isYtId(p.videoId);
  return {
    format: EXPORT_FORMAT,
    version: 1,
    exportedAt: new Date().toISOString(),
    project: {
      name: p.name,
      videoId: yt ? p.videoId : null,
      videoTitle: p.videoTitle,
      url: yt ? `https://www.youtube.com/watch?v=${p.videoId}` : null,
      // Projeto de arquivo (web): o arquivo não vai junto, só o nome dele.
      ...(yt ? {} : { localFile: p.fileName || p.videoTitle || p.name }),
      sections: p.sections.map(({ name, a, b, rate }) => ({ name, a, b, rate })),
    },
  };
}

async function exportProject(p) {
  if (!p) return;
  const ok = await api.exportProject(p.name, exportData(p), I18N.lang);
  if (ok) toast(tr('Projeto exportado'));
}

async function importProjects() {
  const files = await api.importProjects(I18N.lang);
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
  let imported = 0;
  let lastId = null;
  files.forEach((data) => {
    const src = data && data.format === EXPORT_FORMAT ? data.project : null;
    if (!src) return;
    const yt = isYtId(src.videoId);
    // Projetos de arquivo só existem na versão web.
    if (!yt && !(WEB && src.localFile)) return;
    const p = newProjectObj(yt ? src.videoId : `file-${uid()}`, String(src.name || '').slice(0, 200), String(src.videoTitle || ''));
    if (!yt) {
      p.mode = 'offline';
      p.fileName = String(src.localFile).slice(0, 300);
    }
    p.sections = (Array.isArray(src.sections) ? src.sections : [])
      .map((s) => ({ id: uid(), name: String(s.name || tr('Trecho')).slice(0, 200), a: num(s.a), b: num(s.b), rate: clamp(num(s.rate) || 1, RATE_MIN, RATE_MAX) }))
      .filter((s) => s.a != null && s.b != null && s.b > s.a && s.a >= 0);
    p.sections.forEach((s, i) => { if (!s.name) s.name = String(i + 1); });
    S.store.projects[p.id] = p;
    lastId = p.id;
    imported += 1;
  });
  if (files.length && !imported) toast(tr('Nenhum projeto válido nos arquivos'));
  if (imported) {
    saveSoon();
    renderLibrary();
    toast(tr('{n} projeto(s) importado(s)', { n: imported }));
    if (imported === 1) {
      closeLibrary();
      openProject(lastId);
    }
  }
}

// ---------------------------------------------------------------- biblioteca (modal)
const libraryOpen = () => !$('libraryModal').classList.contains('hidden');

function openLibrary() {
  $('libraryModal').classList.remove('hidden');
  $('libSearch').value = '';
  renderLibrary();
  if (!TOUCH) $('libSearch').focus(); // no celular, não abre o teclado sozinho
}

function closeLibrary() {
  $('libraryModal').classList.add('hidden');
  document.activeElement?.blur();
}

function renderLibrary() {
  const q = $('libSearch').value.trim().toLowerCase();
  const all = Object.values(S.store.projects).sort((x, y) => y.updated - x.updated);
  const items = all.filter((p) => !q || `${p.name} ${p.videoTitle}`.toLowerCase().includes(q));
  const list = $('libList');
  list.innerHTML = '';
  $('libEmpty').classList.toggle('hidden', items.length > 0);
  $('libEmpty').textContent = all.length
    ? tr('Nenhum projeto encontrado.')
    : WEB
      ? tr('Nenhum projeto ainda. Crie um com um link do YouTube ou com 📂 Arquivo (vídeo ou música do aparelho).')
      : tr('Nenhum projeto ainda. Crie um com um link do YouTube.');

  items.forEach((p) => {
    const li = document.createElement('li');
    li.className = `lib-item${p.id === S.projectId ? ' active' : ''}`;
    const date = new Date(p.updated).toLocaleDateString(I18N.locale, { day: '2-digit', month: '2-digit', year: 'numeric' });
    const sectionsPreview = p.sections.slice(0, 4).map((s) => escapeHtml(s.name)).join(' · ');
    const file = S.offline[p.videoId];
    const yt = isYtId(p.videoId);
    let offlineTag = '';
    if (WEB) {
      if (file) offlineTag = `<span class="offline-tag">📂 ${yt && p.mode !== 'offline' ? tr('salvo') : tr('arquivo')} (${fmtSize(file.size)})</span> · `;
      else if (!yt) offlineTag = `<span class="missing-tag">📂 ${tr('arquivo não está neste aparelho')}</span> · `;
    } else if (file) {
      offlineTag = `<span class="offline-tag">${p.mode === 'offline' ? '💾 offline' : tr('💾 baixado')} (${fmtSize(file.size)})${S.stems[p.videoId] ? tr(' · 🎸 separada') : ''}</span> · `;
    }
    const rmTitle = WEB
      ? yt
        ? tr('Apagar o arquivo salvo neste aparelho (o projeto volta a tocar pelo YouTube)')
        : tr('Apagar o arquivo salvo neste aparelho (os trechos continuam)')
      : tr('Apagar o vídeo baixado (o projeto volta a tocar pelo YouTube)');
    li.innerHTML = `
      ${yt ? `<img alt="" src="https://i.ytimg.com/vi/${p.videoId}/mqdefault.jpg" />` : '<div class="lib-thumb">🎵</div>'}
      <div class="info">
        <span class="name">${escapeHtml(p.name)}</span>
        <span class="muted small-text">${escapeHtml(p.videoTitle && p.videoTitle !== p.name ? p.videoTitle : '')}</span>
        <span class="small-text meta">${offlineTag}${tr('{n} trecho(s)', { n: p.sections.length })} · ${date}${sectionsPreview ? ` · <span class="muted">${sectionsPreview}${p.sections.length > 4 ? '…' : ''}</span>` : ''}</span>
      </div>
      ${file ? `<button class="btn tiny" data-act="rmfile" title="${rmTitle}">🗑 ${WEB ? tr('arquivo') : tr('vídeo')}</button>` : ''}
      <button class="btn tiny" data-act="rename" title="${tr('Renomear')}">✎</button>
      <button class="btn tiny" data-act="export" title="${tr('Exportar para arquivo')}">⤓</button>
      <button class="btn tiny danger" data-act="delete" title="${tr('Excluir projeto')}">✕</button>
    `;
    li.addEventListener('click', (e) => {
      if (e.target.closest('input')) return;
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'delete') deleteProject(p.id);
      else if (act === 'rmfile') {
        if (window.confirm(tr('Apagar o {file} de "{name}" ({size})?', { file: FILE_WORD, name: p.name, size: fmtSize(file.size) }))) removeOfflineFile(p.videoId);
      } else if (act === 'export') exportProject(p);
      else if (act === 'rename') startProjectRename(li, p);
      else {
        closeLibrary();
        if (p.id !== S.projectId) openProject(p.id);
      }
    });
    list.appendChild(li);
  });
}

function startProjectRename(li, p) {
  const nameEl = li.querySelector('.name');
  const input = document.createElement('input');
  input.type = 'text';
  input.value = p.name;
  input.className = 'rename';
  nameEl.replaceWith(input);
  input.focus();
  input.select();
  let done = false;
  const commit = (ok) => {
    if (done) return;
    done = true;
    if (ok && input.value.trim()) {
      p.name = input.value.trim();
      p.nameEdited = true;
      if (p.id === S.projectId) {
        $('projectName').value = p.name;
        document.title = `${p.name} — SoloTracker`;
      }
      saveSoon();
    }
    renderLibrary();
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') commit(true);
    if (e.key === 'Escape') commit(false);
    e.stopPropagation();
  });
  input.addEventListener('blur', () => commit(true));
}

// ---------------------------------------------------------------- eventos da ponte
api.onEvent((ev) => {
  switch (ev.type) {
    case 'bridge-ready':
      // Novo iframe: reenvia o estado atual.
      send('setRate', { rate: S.rate });
      send('setGap', { seconds: settings().gap });
      send('setVolume', { volume: settings().volume });
      send('setGuitar', { on: project()?.guitarOn !== false });
      applyLoop({ save: false });
      break;
    case 'stems-error':
      toast(tr('Não foi possível carregar as trilhas separadas — tocando o áudio original'));
      break;
    case 'status': {
      const now = performance.now();
      if (now < S.holdUntil && Math.abs(ev.time - S.time) > 0.3) break;
      if (S.dragTime == null) {
        S.time = ev.time;
        S.statusAt = now;
      }
      if (ev.duration > 0) {
        if (!S.videoLoaded) $('errorBox').classList.add('hidden');
        S.videoLoaded = true;
        S.duration = ev.duration;
        // Guarda a duração para desenhar a linha do tempo antes do vídeo carregar.
        const p = project();
        if (p && Math.abs((p.duration || 0) - ev.duration) > 0.5) {
          p.duration = ev.duration;
          saveSoon();
        }
      }
      S.paused = ev.paused;
      S.inGap = ev.gap;
      if (ev.rate > 0) S.playRate = ev.rate;
      break;
    }
    case 'rate-limited':
      // YouTube na web: a API só aceita algumas velocidades.
      toast(tr('O YouTube tocou a {pct}% (mais próxima). Use um arquivo para velocidade livre', { pct: Math.round(ev.actual * 100) }), 3500);
      break;
    case 'need-tap':
      toast(TOUCH ? tr('Toque no vídeo para começar') : tr('Clique no vídeo para começar'), 3000);
      break;
    case 'meta': {
      $('videoTitle').textContent = ev.title;
      const p = project();
      if (p && p.videoTitle !== ev.title) {
        p.videoTitle = ev.title;
        if (!p.nameEdited) {
          p.name = ev.title;
          $('projectName').value = p.name;
          document.title = `${p.name} — SoloTracker`;
        }
        saveSoon();
      }
      break;
    }
    case 'loop':
      onLoopWrapped();
      break;
    case 'gap': {
      const el = $('gapBadge');
      S.inGap = ev.active;
      if (ev.active) {
        el.textContent = tr('Prepare-se…');
        el.classList.remove('hidden');
      } else {
        el.classList.add('hidden');
      }
      break;
    }
    case 'error': {
      const p = project();
      const box = $('errorBox');
      box.innerHTML = '';
      const msg = document.createElement('p');
      msg.textContent = tr(ev.message);
      const hint = document.createElement('p');
      hint.className = 'muted';
      const btn = document.createElement('button');
      btn.className = 'btn';
      const alt = document.createElement('button');
      alt.className = 'btn';
      if (p && WEB && (p.mode === 'offline' || !isYtId(p.videoId))) {
        hint.textContent = tr('O navegador não conseguiu tocar este arquivo (formato não suportado?). Escolha outro arquivo.');
        btn.textContent = tr('📂 Escolher outro arquivo');
        btn.onclick = () => attachFile(p);
        alt.textContent = tr('▶ Tocar pelo YouTube');
        alt.onclick = () => setMode(p, 'online');
        box.append(msg, hint, btn);
        if (isYtId(p.videoId)) box.append(alt);
      } else if (p && p.mode === 'offline') {
        hint.textContent = tr('O arquivo pode estar corrompido. Volte para o YouTube ou apague e baixe de novo pela Biblioteca.');
        btn.textContent = tr('🌐 Tocar pelo YouTube');
        btn.onclick = () => setMode(p, 'online');
        box.append(msg, hint, btn);
      } else if (WEB) {
        hint.textContent =
          tr('Alguns vídeos não permitem reprodução fora do YouTube. Você pode tocar um arquivo de vídeo ou áudio salvo neste aparelho.');
        btn.textContent = tr('Abrir no YouTube');
        btn.onclick = () => p && api.openExternal(`https://www.youtube.com/watch?v=${p.videoId}`);
        alt.textContent = S.offline[p?.videoId] ? tr('📂 Tocar o arquivo salvo') : tr('📂 Usar um arquivo do aparelho');
        alt.onclick = () => toggleMode();
        box.append(msg, hint, alt, btn);
      } else {
        hint.textContent =
          tr('Alguns vídeos não permitem reprodução incorporada, e o YouTube pode bloquear o acesso temporariamente. Baixar o vídeo costuma resolver.');
        btn.textContent = tr('Abrir no YouTube');
        btn.onclick = () => p && api.openExternal(`https://www.youtube.com/watch?v=${p.videoId}`);
        alt.textContent = S.offline[p?.videoId] ? tr('💾 Tocar offline') : tr('💾 Baixar e tocar offline');
        alt.onclick = () => toggleMode();
        box.append(msg, hint, alt, btn);
      }
      box.classList.remove('hidden');
      break;
    }
    default:
      break;
  }
});

// ---------------------------------------------------------------- timelines
const zoomView = () => {
  const { a, b } = S.loop;
  if (a == null || b == null) return [0, S.duration || 1];
  const pad = Math.max(0.75, (b - a) * 0.2);
  return [Math.max(0, a - pad), Math.min(S.duration || b + pad, b + pad)];
};

function makeTimeline(el, getView, extra = {}) {
  let wasPlaying = false;
  return new Timeline(el, {
    ...extra,
    getView,
    onSeek: (t, phase) => {
      scrubLoopCheck(t, phase);
      if (phase === 'end') endDragSeek(t);
      else seekThrottled(t);
    },
    onHandle: (which, t, phase) => {
      if (phase === 'start') wasPlaying = !S.paused;
      if (which === 'a') S.loop.a = round2(Math.min(t, (S.loop.b ?? Infinity) - 0.05));
      else S.loop.b = round2(Math.max(t, (S.loop.a ?? 0) + 0.05));
      applyLoop({ save: phase === 'end' && !S.capture });
      if (S.capture) updateCaptureUi();
      // Mostra o ponto sob a alça enquanto arrasta.
      seekThrottled(which === 'a' ? S.loop.a : Math.max(S.loop.a ?? 0, S.loop.b - 1));
      if (phase === 'end') {
        endDragSeek(which === 'a' ? S.loop.a : Math.max(S.loop.a ?? 0, S.loop.b - 1.5));
        resetReps();
        if (wasPlaying) send('play');
      }
    },
  });
}

// Na linha do tempo principal, os trechos salvos (exceto o ativo) aparecem e são clicáveis.
const tlFull = makeTimeline($('timelineFull'), () => [0, S.duration || 1], {
  getSections: () =>
    (project()?.sections || [])
      .map((sec, i) => ({ ...sec, label: i < 10 ? String((i + 1) % 10) : '' }))
      .filter((sec) => sec.id !== S.activeSectionId),
  onSection: (id) => {
    const sec = project()?.sections.find((x) => x.id === id);
    if (sec) openSection(sec);
  },
});
const tlZoom = makeTimeline($('timelineZoom'), zoomView);

// ---------------------------------------------------------------- arraste sobre o vídeo (jog)
(function setupJog() {
  const overlay = $('jogOverlay');
  let drag = null;

  overlay.addEventListener('pointerdown', (e) => {
    if (e.button > 0) return;
    overlay.setPointerCapture(e.pointerId);
    drag = { id: e.pointerId, x: e.clientX, t0: nowTime(), wasPlaying: !S.paused, moved: false };
  });

  overlay.addEventListener('pointermove', (e) => {
    if (!drag || drag.id !== e.pointerId) return;
    const dx = e.clientX - drag.x;
    if (!drag.moved && Math.abs(dx) < 6) return;
    if (!drag.moved) {
      drag.moved = true;
      scrubStart(drag.wasPlaying);
    }
    const delta = (dx / 100) * settings().jog;
    const t = clamp(drag.t0 + delta, 0, S.duration || Infinity);
    scrubLoopCheck(t, 'move');
    seekThrottled(t);
    const badge = $('jogBadge');
    badge.textContent = `${delta >= 0 ? '+' : '−'}${Math.abs(delta).toFixed(2)}s  ·  ${fmtTime(t, true)}`;
    badge.classList.remove('hidden');
  });

  const end = (e) => {
    if (!drag || drag.id !== e.pointerId) return;
    const d = drag;
    drag = null;
    $('jogBadge').classList.add('hidden');
    if (!d.moved) {
      if (e.type === 'pointerup') onTap();
      return;
    }
    const t = S.dragTime ?? d.t0;
    scrubLoopCheck(t, 'end');
    endDragSeek(t);
    scrubEnd(d.wasPlaying);
  };

  // No celular, dois toques entram no vídeo em tela cheia (evento 'jog-doubletap'):
  // o toque simples espera um pouco para não pausar/tocar à toa.
  let tapTimer = null;
  function onTap() {
    if (!TOUCH) {
      togglePlay();
      return;
    }
    if (tapTimer) {
      clearTimeout(tapTimer);
      tapTimer = null;
      overlay.dispatchEvent(new CustomEvent('jog-doubletap'));
      return;
    }
    tapTimer = setTimeout(() => {
      tapTimer = null;
      togglePlay();
    }, 260);
  }
  overlay.addEventListener('pointerup', end);
  overlay.addEventListener('pointercancel', end);

  overlay.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const dir = (e.deltaY || e.deltaX) > 0 ? 1 : -1;
      seekBy(dir * (e.shiftKey ? settings().step : settings().fineStep));
    },
    { passive: false },
  );
})();

// ---------------------------------------------------------------- teclado
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') {
    e.preventDefault();
    if (libraryOpen()) closeLibrary();
    else openLibrary();
    return;
  }
  if (libraryOpen()) {
    if (e.key === 'Escape') closeLibrary();
    return;
  }

  const tag = e.target.tagName;
  const typing = (tag === 'INPUT' && e.target.type !== 'range' && e.target.type !== 'checkbox') || tag === 'TEXTAREA';
  if (typing) {
    if (e.key === 'Escape' || (e.key === 'Enter' && e.target.id === 'projectName')) e.target.blur();
    return;
  }
  if (!S.projectId) return;
  const s = settings();
  const t = nowTime();
  let handled = true;

  switch (e.key) {
    case 'n':
    case 'N':
      startCapture();
      break;
    case 'Enter':
      if (S.capture) captureMark();
      else toast(tr('Pressione N para criar um novo trecho'));
      break;
    case 'Escape':
      if (S.capture) cancelCapture();
      else clearLoop();
      break;
    case ' ':
      togglePlay();
      break;
    case 'ArrowLeft':
      seekBy(-(e.shiftKey ? s.bigStep : e.ctrlKey ? s.fineStep : s.step));
      break;
    case 'ArrowRight':
      seekBy(e.shiftKey ? s.bigStep : e.ctrlKey ? s.fineStep : s.step);
      break;
    case 'ArrowUp':
    case '=':
    case '+':
      setRate(S.rate + 0.05);
      break;
    case 'ArrowDown':
    case '-':
    case '_':
      setRate(S.rate - 0.05);
      break;
    case 'a':
    case 'A':
    case '[':
      if (!S.capture) setA(t);
      break;
    case 'b':
    case 'B':
    case ']':
      if (!S.capture) setB(t);
      break;
    case 'l':
    case 'L':
      toggleLoop();
      break;
    case 'g':
    case 'G':
      toggleGuitar();
      break;
    case 'r':
    case 'R':
    case 'Home':
    case 'Backspace':
      goToA();
      break;
    default:
      if (/^[0-9]$/.test(e.key) && !e.ctrlKey && !e.altKey) {
        // 1…9 = trechos 1 a 9, 0 = trecho 10
        const sec = project()?.sections[(Number(e.key) + 9) % 10];
        if (sec) openSection(sec);
      } else {
        handled = false;
      }
  }
  if (handled) e.preventDefault();
});

// Botões não devem ficar com foco (senão Espaço/Enter "clicam" neles de novo).
document.addEventListener('click', (e) => {
  const b = e.target.closest('button, input[type=range], input[type=checkbox]');
  if (b) b.blur();
});

// Colar (Ctrl+V) ou arrastar um link em qualquer lugar abre/cria o projeto.
document.addEventListener('paste', (e) => {
  if (e.target.tagName === 'INPUT' || libraryOpen()) return;
  const parsed = parseVideoId(e.clipboardData.getData('text'));
  if (parsed) openFromUrl(parsed);
});
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => {
  e.preventDefault();
  const parsed = parseVideoId(e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text'));
  if (parsed) openFromUrl(parsed);
});

// ---------------------------------------------------------------- controles da UI
function flagInvalid(input) {
  input.classList.add('invalid');
  setTimeout(() => input.classList.remove('invalid'), 1200);
}

function bindUi() {
  $('urlForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const parsed = parseVideoId($('urlInput').value);
    if (!parsed) return flagInvalid($('urlInput'));
    $('urlInput').blur();
    openFromUrl(parsed);
    return undefined;
  });

  // Projeto
  $('projectName').addEventListener('change', () => {
    const p = project();
    const name = $('projectName').value.trim();
    if (!p) return;
    if (!name) {
      $('projectName').value = p.name;
      return;
    }
    p.name = name;
    p.nameEdited = true;
    document.title = `${p.name} — SoloTracker`;
    touch();
  });
  $('btnExport').onclick = () => exportProject(project());
  $('btnMode').onclick = toggleMode;
  $('btnGuitar').onclick = onGuitarButton;
  $('btnLibrary').onclick = openLibrary;
  $('placeholderLibrary').onclick = (e) => {
    e.preventDefault();
    openLibrary();
  };

  // Biblioteca
  $('libClose').onclick = closeLibrary;
  $('libImport').onclick = importProjects;
  if (WEB) {
    $('libNewFile').classList.remove('hidden');
    $('libNewFile').onclick = createFileProject;
  }
  $('libSearch').addEventListener('input', renderLibrary);
  $('libraryModal').addEventListener('pointerdown', (e) => {
    if (e.target.id === 'libraryModal') closeLibrary();
  });
  $('newProjectForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const parsed = parseVideoId($('newProjUrl').value);
    if (!parsed) return flagInvalid($('newProjUrl'));
    const name = $('newProjName').value.trim();
    $('newProjUrl').value = '';
    $('newProjName').value = '';
    closeLibrary();
    createProject(parsed.id, name);
    return undefined;
  });

  // Player
  $('btnPlay').onclick = togglePlay;
  $('btnBack').onclick = () => seekBy(-settings().step);
  $('btnFwd').onclick = () => seekBy(settings().step);
  $('btnToA').onclick = goToA;
  $('btnNewSection').onclick = () => {
    if (!project()) return toast(tr('Abra um projeto primeiro'));
    if (S.capture) captureMark();
    else startCapture();
    return undefined;
  };
  $('btnSetA').onclick = () => setA(nowTime());
  $('btnSetB').onclick = () => setB(nowTime());
  $('btnLoop').onclick = toggleLoop;
  $('btnClearLoop').onclick = () => (S.capture ? cancelCapture() : clearLoop());
  document.querySelectorAll('.nudge').forEach((btn) => {
    btn.onclick = () => nudge(btn.dataset.nudge, Number(btn.dataset.dir));
  });

  $('speedRange').addEventListener('input', (e) => setRate(Number(e.target.value) / 100, { silent: true }));
  $('speedDown').onclick = () => setRate(S.rate - 0.05);
  $('speedUp').onclick = () => setRate(S.rate + 0.05);
  SPEED_PRESETS.forEach((pct) => {
    const b = document.createElement('button');
    b.className = 'btn tiny';
    b.dataset.pct = pct;
    b.textContent = `${pct}%`;
    b.onclick = () => setRate(pct / 100);
    $('speedPresets').appendChild(b);
  });

  $('volume').value = Math.round(settings().volume * 100);
  $('volume').addEventListener('input', (e) => {
    settings().volume = Number(e.target.value) / 100;
    send('setVolume', { volume: settings().volume });
    saveSoon();
  });

  // Configurações
  const map = {
    setStep: ['step', 0.1, 120],
    setBigStep: ['bigStep', 0.5, 600],
    setFineStep: ['fineStep', 0.01, 5],
    setJog: ['jog', 0.1, 60],
    setGap: ['gap', 0, 30],
    setPreroll: ['preroll', 0, 30],
  };
  Object.entries(map).forEach(([id, [key, min, max]]) => {
    const input = $(id);
    input.value = settings()[key];
    input.addEventListener('change', () => {
      const val = clamp(Number(input.value), min, max);
      settings()[key] = Number.isFinite(val) ? val : DEFAULT_SETTINGS[key];
      input.value = settings()[key];
      if (key === 'gap') send('setGap', { seconds: settings().gap });
      saveSoon();
    });
  });

  setupLanguagePicker();
}

/** Escolha do idioma (Configurações). Trocar recarrega a interface. */
function setupLanguagePicker() {
  const label = document.createElement('label');
  label.htmlFor = 'setLang';
  label.textContent = 'Idioma / Language';
  const select = document.createElement('select');
  select.id = 'setLang';
  select.className = 'web-select';
  [
    ['', `Auto (${I18N.autoLang === 'en' ? 'EN' : 'PT'})`],
    ['pt', 'Português'],
    ['en', 'English'],
  ].forEach(([value, text]) => {
    const o = document.createElement('option');
    o.value = value;
    o.textContent = text;
    select.append(o);
  });
  select.value = I18N.forced;
  select.addEventListener('change', async () => {
    I18N.setLang(select.value);
    S.store.settings.lang = select.value;
    clearTimeout(saveTimer);
    await api.saveStore(S.store);
    location.reload();
  });
  $('settingsGrid').prepend(label, select);
}

// ---------------------------------------------------------------- loop de renderização
function frame() {
  const t = nowTime();
  const st = { time: t, duration: S.duration, ...S.loop };
  tlFull.render(st);
  if (hasLoop()) tlZoom.render(st);
  $('timeNow').textContent = fmtTime(t, true);
  $('timeDur').textContent = fmtTime(S.duration);
  $('btnPlay').textContent = S.paused && !S.inGap ? '▶' : '❚❚';
  requestAnimationFrame(frame);
}

// Guarda a posição atual periodicamente (para retomar depois).
setInterval(() => {
  const p = project();
  if (!p || !S.duration) return;
  const t = round2(nowTime());
  if (Math.abs((p.last.time || 0) - t) > 1) {
    p.last.time = t;
    saveSoon();
  }
}, 3000);

// ---------------------------------------------------------------- init
(async function init() {
  S.store = migrateStore((await api.loadStore()) || {});
  S.offline = (await api.offline.list()) || {};
  api.offline.onProgress(({ videoId, stage, percent }) => {
    if (!S.downloads[videoId]) return;
    S.downloads[videoId] = { stage, percent };
    if (project()?.videoId === videoId) updateModeButton();
  });
  // A separação da guitarra (Demucs) só existe no app para PC.
  if (api.stems) {
    S.stems = (await api.stems.list()) || {};
    api.stems.onProgress(({ videoId, stage, percent }) => {
      if (!S.separating[videoId]) return;
      S.separating[videoId] = { stage, percent };
      if (project()?.videoId === videoId) updateGuitarButton();
    });
  }
  bindUi();
  setRate(1, { silent: true });
  applyLoop({ save: false });
  renderSections();
  requestAnimationFrame(frame);

  // O processo principal pode passar um vídeo inicial no hash (variável SOLOTRACKER_URL).
  const fromHash = parseVideoId(decodeURIComponent(location.hash.slice(1)));
  if (fromHash) openFromUrl(fromHash);
  else if (S.store.lastProjectId && S.store.projects[S.store.lastProjectId]) {
    // Reabre o último projeto, pausado.
    openProject(S.store.lastProjectId, { autoplay: false });
  } else if (Object.keys(S.store.projects).length) {
    openLibrary();
  } else if (!TOUCH) {
    $('urlInput').focus();
  }
  saveSoon();
})();
