/**
 * Este preload roda em dois contextos (nodeIntegrationInSubFrames):
 *
 * 1. Janela principal  -> expõe a API `window.solo` para a interface.
 * 2. Iframe do embed do YouTube -> atua como "ponte": controla o <video> diretamente
 *    (velocidade arbitrária com pitch preservado, loop A-B preciso por frame, seek).
 *
 * 3. Iframe do player local (player.html, modo offline) -> mesma ponte, controlando o
 *    <video> que toca o arquivo baixado.
 *
 * Em qualquer outro iframe (anúncios etc.) não faz nada.
 */
const { ipcRenderer, contextBridge } = require('electron');

const isYouTubeEmbed =
  /(^|\.)youtube(-nocookie)?\.com$/.test(location.hostname) && location.pathname.startsWith('/embed/');
const isLocalPlayer = window !== window.top && location.hostname === 'localhost' && location.pathname === '/player.html';

if (isYouTubeEmbed || isLocalPlayer) {
  runBridge();
} else if (window === window.top) {
  contextBridge.exposeInMainWorld('solo', {
    send: (cmd) => ipcRenderer.send('video:cmd', cmd),
    onEvent: (cb) => ipcRenderer.on('video:event', (_e, payload) => cb(payload)),
    loadStore: () => ipcRenderer.invoke('store:load'),
    saveStore: (data) => ipcRenderer.invoke('store:save', data),
    openExternal: (url) => ipcRenderer.invoke('open-external', url),
    exportProject: (fileName, data) => ipcRenderer.invoke('project:export', { fileName, data }),
    importProjects: () => ipcRenderer.invoke('project:import'),
    offline: {
      list: () => ipcRenderer.invoke('offline:list'),
      download: (videoId) => ipcRenderer.invoke('offline:download', videoId),
      cancel: (videoId) => ipcRenderer.invoke('offline:cancel', videoId),
      remove: (videoId) => ipcRenderer.invoke('offline:remove', videoId),
      onProgress: (cb) => ipcRenderer.on('offline:progress', (_e, payload) => cb(payload)),
    },
    stems: {
      list: () => ipcRenderer.invoke('stems:list'),
      status: () => ipcRenderer.invoke('stems:status'),
      separate: (videoId) => ipcRenderer.invoke('stems:separate', videoId),
      cancel: (videoId) => ipcRenderer.invoke('stems:cancel', videoId),
      remove: (videoId) => ipcRenderer.invoke('stems:remove', videoId),
      onProgress: (cb) => ipcRenderer.on('stems:progress', (_e, payload) => cb(payload)),
    },
  });
}

function runBridge() {
  const emit = (payload) => ipcRenderer.send('bridge:event', payload);

  const state = {
    video: null,
    rate: 1,
    volume: 1,
    loop: { a: null, b: null, enabled: false },
    gap: 0,
    gapTimer: null,
    lastStatusAt: 0,
    lastError: '',
    pendingSeek: null, // seek pedido antes de o vídeo carregar
    // Com autoplay=0 o YouTube não inicializa o <video> (e nada toca sem clicar no player dele).
    // Por isso o app sempre usa autoplay=1 e, para abrir pausado, pausa (mudo) assim que começa.
    startPaused: new URLSearchParams(location.search).has('st_paused'),
    title: '',
  };

  /*
   * Stems (só no player local): com ?stems=1, o <video> fica mudo e o som vem de duas
   * trilhas <audio> (guitarra e acompanhamento) que seguem o vídeo (play, pausa, seek,
   * velocidade). Desligar a guitarra só silencia a trilha dela.
   */
  const stems = { on: false, els: [], backing: null, guitar: null, guitarOn: true };

  function setupStems() {
    const q = new URLSearchParams(location.search);
    const id = q.get('v') || '';
    if (!isLocalPlayer || q.get('stems') !== '1' || !/^[\w-]{11}$/.test(id)) return;
    stems.guitarOn = q.get('guitar') !== '0';
    const make = (name) => {
      const a = document.createElement('audio');
      a.preload = 'auto';
      a.preservesPitch = true;
      a.src = `/stems/${id}/${name}.flac`;
      a.addEventListener('loadedmetadata', () => syncStems(true));
      a.addEventListener('error', disableStems);
      return a;
    };
    stems.backing = make('backing');
    stems.guitar = make('guitar');
    stems.els = [stems.backing, stems.guitar];
    stems.on = true;
  }

  /** Falhou ao carregar as trilhas: volta para o áudio original do vídeo. */
  function disableStems() {
    if (!stems.on) return;
    stems.on = false;
    stems.els.forEach((a) => a.pause());
    applyAudio();
    emit({ type: 'stems-error' });
  }

  function syncStems(force) {
    const v = state.video;
    if (!stems.on || !v) return;
    const playing = !v.paused && !v.ended && !v.seeking && !state.startPaused && v.readyState >= 3;
    const now = performance.now();
    stems.els.forEach((a) => {
      if (Math.abs(a.playbackRate - v.playbackRate) > 0.0005) a.playbackRate = v.playbackRate;
      if (a.readyState >= 1) {
        const drift = Math.abs(a.currentTime - v.currentTime);
        // Correção forte em seek/play; durante a reprodução só se escorregar mais de 80 ms.
        if (force ? drift > 0.01 : drift > 0.08 && now - (a.stLastFix || 0) > 400) {
          a.currentTime = v.currentTime;
          a.stLastFix = now;
        }
      }
      if (playing && a.paused) a.play().catch(() => {});
      else if (!playing && !a.paused) a.pause();
    });
  }

  /** Volume/mudo do vídeo e das trilhas. */
  function applyAudio() {
    const v = state.video;
    const zero = state.volume === 0;
    if (v) {
      v.volume = state.volume;
      // Na pausa inicial (st_paused) o vídeo toca mudo até a ponte pausá-lo.
      v.muted = stems.on || state.startPaused || zero;
    }
    if (stems.on) {
      stems.backing.volume = state.volume;
      stems.guitar.volume = state.volume;
      stems.backing.muted = zero;
      stems.guitar.muted = zero || !stems.guitarOn;
    }
  }

  // Esconde a interface do YouTube que atrapalha (títulos, overlay de pausa, sugestões).
  function injectCss() {
    if (isLocalPlayer || document.getElementById('solotracker-css')) return;
    const style = document.createElement('style');
    style.id = 'solotracker-css';
    // As regras só valem com a classe "solotracker-ok" (vídeo carregou). Antes disso,
    // mensagens de erro do YouTube continuam visíveis.
    style.textContent = `
      html.solotracker-ok body > :not(:has(.html5-video-player)):not(.html5-video-player),
      html.solotracker-ok .ytPlayerControlsContainerHost,
      html.solotracker-ok .html5-video-player > :not(.html5-video-container):not(.ytp-error) { display: none !important; }
      .ytp-pause-overlay, .ytp-chrome-top, .ytp-gradient-top, .ytp-watermark,
      .ytp-ce-element, .ytp-endscreen-content, .ytp-show-cards-title,
      .ytp-cards-teaser, .ytp-paid-content-overlay, .ytp-chrome-bottom,
      .ytp-gradient-bottom, .ytp-youtube-button, .ytp-impression-link,
      .ytp-contextmenu, .ytp-large-play-button, .ytp-bezel { display: none !important; }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function clearGap() {
    if (state.gapTimer) {
      clearTimeout(state.gapTimer);
      state.gapTimer = null;
      emit({ type: 'gap', active: false });
    }
  }

  function applyRate() {
    const v = state.video;
    if (!v) return;
    v.preservesPitch = true;
    if (Math.abs(v.playbackRate - state.rate) > 0.0005) v.playbackRate = state.rate;
    syncStems(false);
  }

  function attach(video) {
    state.video = video;
    video.preservesPitch = true;
    applyRate();
    applyAudio();
    video.addEventListener('playing', () => {
      if (!state.startPaused) return;
      state.startPaused = false;
      video.pause();
      applyAudio();
    });
    if (stems.on) {
      ['playing', 'seeked', 'ratechange'].forEach((ev) => video.addEventListener(ev, () => syncStems(true)));
      ['play', 'pause', 'seeking', 'waiting', 'ended'].forEach((ev) => video.addEventListener(ev, () => syncStems(false)));
    }

    // O player do YouTube às vezes redefine a velocidade; reaplicamos a nossa.
    video.addEventListener('ratechange', () => {
      if (Math.abs(video.playbackRate - state.rate) > 0.0005) {
        setTimeout(applyRate, 0);
      }
    });
    const markOk = () => document.documentElement.classList.add('solotracker-ok');
    if (video.readyState >= 1) markOk();
    video.addEventListener('loadedmetadata', () => {
      markOk();
      if (state.pendingSeek != null) {
        video.currentTime = Math.min(state.pendingSeek, Math.max(0, video.duration - 0.05));
        state.pendingSeek = null;
      }
      applyRate();
      sendStatus(true);
    });
    video.addEventListener('play', () => sendStatus(true));
    video.addEventListener('pause', () => sendStatus(true));
    video.addEventListener('seeked', () => sendStatus(true));
    video.addEventListener('ended', () => {
      // Se o loop termina exatamente no fim do vídeo, recomeça do A.
      if (state.loop.enabled && state.loop.a != null && state.loop.b != null) wrapLoop();
      sendStatus(true);
    });
    if (isLocalPlayer) {
      video.addEventListener('error', () => {
        const code = video.error ? ` (código ${video.error.code})` : '';
        emit({ type: 'error', message: `Não foi possível tocar o vídeo baixado${code}.` });
      });
    }
    emit({ type: 'attached' });
  }

  function findVideo() {
    const v = document.querySelector('video.html5-main-video') || document.querySelector('video');
    if (v && v !== state.video) attach(v);
  }

  function sendStatus(force) {
    const v = state.video;
    if (!v) return;
    const now = performance.now();
    if (!force && now - state.lastStatusAt < 33) return;
    state.lastStatusAt = now;
    emit({
      type: 'status',
      time: v.currentTime,
      duration: Number.isFinite(v.duration) ? v.duration : 0,
      paused: v.paused,
      rate: v.playbackRate,
      volume: v.volume,
      muted: v.muted,
      waiting: v.readyState < 3,
      gap: !!state.gapTimer,
    });
  }

  function wrapLoop() {
    const v = state.video;
    const { a } = state.loop;
    emit({ type: 'loop' });
    if (state.gap > 0) {
      v.pause();
      v.currentTime = a;
      clearGap();
      emit({ type: 'gap', active: true, seconds: state.gap });
      state.gapTimer = setTimeout(() => {
        state.gapTimer = null;
        emit({ type: 'gap', active: false });
        v.play().catch(() => {});
      }, state.gap * 1000);
    } else {
      v.currentTime = a;
      if (v.paused) v.play().catch(() => {});
    }
  }

  function tick() {
    const v = state.video;
    if (v) {
      const { a, b, enabled } = state.loop;
      if (enabled && a != null && b != null && !v.paused && !v.seeking && !state.gapTimer && v.currentTime >= b) {
        wrapLoop();
      }
      syncStems(false);
      sendStatus(false);
    }
    requestAnimationFrame(tick);
  }

  function checkMeta() {
    if (isLocalPlayer) return; // título vem do projeto; erros vêm do evento 'error' do <video>
    const titleEl = document.querySelector('.ytp-title-link');
    const title = (titleEl && titleEl.textContent.trim()) || document.title.replace(/\s*-\s*YouTube\s*$/, '').trim();
    if (title && title !== state.title && title !== 'YouTube') {
      state.title = title;
      emit({ type: 'meta', title });
    }
    const err = document.querySelector('.ytp-error, .ytp-embed-error');
    let msg = err && err.getClientRects().length ? err.innerText.trim() : '';
    // Sem vídeo carregado depois de um tempo: mostra o que o YouTube estiver exibindo.
    if (!msg && performance.now() - state.bootAt > 8000 && !(state.video && state.video.duration > 0)) {
      msg = (document.body && document.body.innerText.trim()) || '';
    }
    msg = msg.replace(/\s*\n\s*/g, ' — ').slice(0, 300);
    if (msg !== state.lastError) {
      state.lastError = msg;
      if (msg) emit({ type: 'error', message: msg });
    }
  }

  ipcRenderer.on('bridge:cmd', (_e, cmd) => {
    const v = state.video;
    switch (cmd.type) {
      case 'setRate':
        state.rate = Math.min(4, Math.max(0.1, Number(cmd.rate) || 1));
        applyRate();
        break;
      case 'setLoop':
        state.loop = { a: cmd.a, b: cmd.b, enabled: !!cmd.enabled };
        if (!state.loop.enabled) clearGap();
        break;
      case 'setGap':
        state.gap = Math.max(0, Number(cmd.seconds) || 0);
        break;
      case 'setVolume':
        state.volume = Math.min(1, Math.max(0, Number(cmd.volume)));
        applyAudio();
        break;
      case 'setGuitar':
        stems.guitarOn = !!cmd.on;
        applyAudio();
        break;
      default:
        break;
    }
    if ((cmd.type === 'play' || cmd.type === 'toggle') && state.startPaused) {
      // O usuário quer tocar antes da pausa inicial acontecer: cancela a pausa.
      state.startPaused = false;
      applyAudio();
      syncStems(true);
      if (v && !v.paused) return;
    }
    if (cmd.type === 'seek' && (!v || v.readyState < 1)) {
      state.pendingSeek = Math.max(0, Number(cmd.time) || 0);
      if (!v) return;
    }
    if (!v) return;
    switch (cmd.type) {
      case 'play':
        clearGap();
        v.play().catch(() => {});
        break;
      case 'pause':
        clearGap();
        v.pause();
        break;
      case 'toggle':
        if (v.paused && !state.gapTimer) v.play().catch(() => {});
        else {
          clearGap();
          v.pause();
        }
        break;
      case 'seek': {
        if (v.readyState < 1) break;
        const d = Number.isFinite(v.duration) ? v.duration : Infinity;
        v.currentTime = Math.min(Math.max(0, cmd.time), Math.max(0, d - 0.05));
        sendStatus(true);
        break;
      }
      default:
        break;
    }
  });

  const boot = () => {
    state.bootAt = performance.now();
    setupStems();
    injectCss();
    findVideo();
    // O <video> pode ser criado/substituído depois; checamos periodicamente.
    setInterval(() => {
      findVideo();
      checkMeta();
    }, 400);
    requestAnimationFrame(tick);
    ipcRenderer.send('bridge:ready');
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
}
