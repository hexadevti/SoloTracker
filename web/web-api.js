/*
 * SoloTracker — versão web (sem Electron, sem PC).
 *
 * Substitui o preload + processo principal do Electron por uma implementação no navegador
 * e expõe a mesma API `window.solo` que o app.js usa:
 *
 *  - Online: YouTube IFrame Player API. O iframe do YouTube é de outra origem, então não dá
 *    para mexer no <video> dele como no Electron: a velocidade fica limitada às que a API
 *    oferece e o tempo é estimado entre as atualizações que o player manda.
 *  - Offline: um arquivo de vídeo/áudio do aparelho, guardado no IndexedDB, tocado num <video>
 *    da própria página (velocidade livre com tom preservado e loop preciso por frame).
 *  - Projetos ficam no localStorage; exportar/importar usa download/seletor de arquivos.
 *
 * Também decide o layout (celular x PC) antes de a página ser desenhada.
 */
(function () {
  'use strict';

  // ---------------------------------------------------------------- layout: celular x PC
  const root = document.documentElement;
  const LAYOUT_KEY = 'solotracker-layout';
  const qLayout = new URLSearchParams(location.search).get('layout');
  try {
    if (qLayout === 'auto') localStorage.removeItem(LAYOUT_KEY);
    else if (qLayout === 'mobile' || qLayout === 'desktop') localStorage.setItem(LAYOUT_KEY, qLayout);
  } catch {
    /* localStorage bloqueado */
  }
  const coarse = matchMedia('(pointer: coarse)').matches;
  // Celular: tela de toque com o lado menor abaixo de 768px (tablets ficam com o layout de PC).
  const autoMobile = coarse && Math.min(screen.width, screen.height) < 768;
  let forced = null;
  try {
    forced = localStorage.getItem(LAYOUT_KEY);
  } catch {
    /* ignore */
  }
  if (forced !== 'mobile' && forced !== 'desktop') forced = null;
  const mobile = forced ? forced === 'mobile' : autoMobile;
  root.classList.add('web');
  if (coarse) root.classList.add('touch');
  if (mobile) root.classList.add('mobile');

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  // ---------------------------------------------------------------- eventos para o app.js
  const listeners = [];
  function emit(payload) {
    listeners.forEach((cb) => {
      try {
        cb(payload);
      } catch (err) {
        console.error(err);
      }
    });
  }

  // ---------------------------------------------------------------- IndexedDB (arquivos do aparelho)
  let dbPromise = null;
  function db() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open('solotracker', 1);
        req.onupgradeneeded = () => {
          req.result.createObjectStore('meta'); // key -> { name, size, type, added }
          req.result.createObjectStore('blobs'); // key -> File/Blob
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      dbPromise.catch(() => {
        dbPromise = null;
      });
    }
    return dbPromise;
  }
  const reqP = (r) =>
    new Promise((resolve, reject) => {
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  const txDone = (t) =>
    new Promise((resolve, reject) => {
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error('Operação cancelada'));
    });

  async function fileGet(key) {
    const d = await db();
    return reqP(d.transaction('blobs').objectStore('blobs').get(key));
  }
  async function fileList() {
    const d = await db();
    const store = d.transaction('meta').objectStore('meta');
    const [keys, vals] = await Promise.all([reqP(store.getAllKeys()), reqP(store.getAll())]);
    const out = {};
    keys.forEach((k, i) => {
      out[k] = { size: vals[i].size, name: vals[i].name };
    });
    return out;
  }
  async function filePut(key, file) {
    const d = await db();
    const t = d.transaction(['meta', 'blobs'], 'readwrite');
    t.objectStore('blobs').put(file, key);
    t.objectStore('meta').put({ name: file.name, size: file.size, type: file.type, added: Date.now() }, key);
    await txDone(t);
  }
  async function fileDelete(key) {
    const d = await db();
    const t = d.transaction(['meta', 'blobs'], 'readwrite');
    t.objectStore('blobs').delete(key);
    t.objectStore('meta').delete(key);
    await txDone(t);
  }

  let persistAsked = false;
  function askPersist() {
    // Pede para o navegador não apagar os arquivos quando faltar espaço.
    if (persistAsked) return;
    persistAsked = true;
    navigator.storage?.persist?.().catch(() => {});
  }

  // ---------------------------------------------------------------- seletor de arquivos
  let picking = null;
  /** Abre o seletor de arquivos. Precisa ser chamado dentro de um clique. Resolve [] se cancelar. */
  function pickFiles(accept, multiple) {
    if (picking) picking.finish([]);
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = accept;
      input.multiple = !!multiple;
      input.style.display = 'none';
      document.body.appendChild(input);
      const entry = {
        finish(files) {
          if (picking !== entry) return;
          picking = null;
          input.remove();
          resolve(files);
        },
      };
      picking = entry;
      input.addEventListener('change', () => entry.finish(Array.from(input.files || [])));
      input.addEventListener('cancel', () => entry.finish([]));
      input.click();
    });
  }

  const MEDIA_ACCEPT = 'video/*,audio/*,.mp4,.m4v,.mov,.webm,.mkv,.m4a,.mp3,.aac,.ogg,.opus,.wav,.flac';

  async function pickAndStore(key) {
    const [file] = await pickFiles(MEDIA_ACCEPT, false);
    if (!file) return { canceled: true };
    try {
      askPersist();
      await filePut(key, file);
      return { ok: true, info: { size: file.size, name: file.name } };
    } catch (err) {
      const quota = err && (err.name === 'QuotaExceededError' || /quota/i.test(err.message || ''));
      return {
        ok: false,
        error: quota
          ? 'Não há espaço no navegador para guardar este arquivo. Apague arquivos de outros projetos na Biblioteca.'
          : String((err && err.message) || err),
      };
    }
  }

  // ---------------------------------------------------------------- área do player
  function host() {
    let el = document.getElementById('webPlayer');
    if (!el) {
      el = document.createElement('div');
      el.id = 'webPlayer';
      el.className = 'web-player';
      const wrap = document.getElementById('videoWrap');
      wrap.insertBefore(el, document.getElementById('jogOverlay'));
    }
    return el;
  }

  /** Com o YouTube em tela de toque, o primeiro play precisa de um toque no próprio player. */
  function setPassThrough(on) {
    document.getElementById('jogOverlay')?.classList.toggle('pass', on);
  }

  // ---------------------------------------------------------------- motor: arquivo local (<video>)
  // O mesmo <video> é reaproveitado: no iOS, depois do primeiro play com toque, ele pode
  // tocar sem novo toque (trocar de projeto continua tocando).
  let sharedVideo = null;

  function LocalEngine(url, opts, on) {
    const el = host();
    const v = sharedVideo || (sharedVideo = document.createElement('video'));
    v.playsInline = true;
    v.setAttribute('playsinline', '');
    v.preload = 'auto';
    v.controls = false;
    v.preservesPitch = true;
    v.webkitPreservesPitch = true;
    v.mozPreservesPitch = true;
    el.replaceChildren(v);
    el.classList.remove('audio-only');
    el.dataset.name = opts.name || '';

    const ac = new AbortController();
    const sig = { signal: ac.signal };
    let pendingSeek = opts.start > 0 ? opts.start : null;

    const eng = {
      kind: 'local',
      time: () => (pendingSeek != null ? pendingSeek : v.currentTime),
      duration: () => (Number.isFinite(v.duration) ? v.duration : 0),
      paused: () => v.paused,
      waiting: () => v.readyState < 3,
      seeking: () => v.seeking,
      actualRate: () => v.playbackRate,
      play() {
        const p = v.play();
        if (p) {
          p.catch((err) => {
            if (err && err.name === 'NotAllowedError') on('blocked');
          });
        }
      },
      pause: () => v.pause(),
      seek(t) {
        if (v.readyState < 1) {
          pendingSeek = t;
          return;
        }
        v.currentTime = clamp(t, 0, Math.max(0, eng.duration() - 0.05));
      },
      setRate(r) {
        v.preservesPitch = true;
        v.webkitPreservesPitch = true;
        if (Math.abs(v.playbackRate - r) > 0.0005) v.playbackRate = r;
        v.defaultPlaybackRate = r;
        return r;
      },
      setVolume(vol) {
        v.volume = vol; // no iOS o volume é só do sistema; o mudo funciona
        v.muted = vol === 0;
      },
      destroy() {
        ac.abort();
        v.pause();
        v.removeAttribute('src');
        v.load();
        el.classList.remove('audio-only');
      },
    };

    v.addEventListener(
      'loadedmetadata',
      () => {
        if (pendingSeek != null) {
          v.currentTime = clamp(pendingSeek, 0, Math.max(0, eng.duration() - 0.05));
          pendingSeek = null;
        }
        el.classList.toggle('audio-only', !v.videoWidth);
        on('loaded');
        if (opts.autoplay) eng.play();
      },
      sig,
    );
    ['play', 'pause', 'seeked', 'ended', 'ratechange'].forEach((name) => v.addEventListener(name, () => on(name), sig));
    v.addEventListener(
      'error',
      () => {
        const code = v.error ? ` (código ${v.error.code})` : '';
        on('error', `Não foi possível tocar este arquivo${code}. O formato pode não ser suportado por este navegador.`);
      },
      sig,
    );
    v.src = url;
    return eng;
  }

  // ---------------------------------------------------------------- motor: YouTube (IFrame API)
  let ytApiPromise = null;
  function loadYouTubeApi() {
    if (!ytApiPromise) {
      ytApiPromise = new Promise((resolve, reject) => {
        if (window.YT && window.YT.Player) {
          resolve(window.YT);
          return;
        }
        const prev = window.onYouTubeIframeAPIReady;
        window.onYouTubeIframeAPIReady = () => {
          if (typeof prev === 'function') prev();
          resolve(window.YT);
        };
        const s = document.createElement('script');
        s.src = 'https://www.youtube.com/iframe_api';
        s.async = true;
        s.onerror = () => reject(new Error('iframe_api'));
        document.head.appendChild(s);
      });
      ytApiPromise.catch(() => {
        ytApiPromise = null;
      });
    }
    return ytApiPromise;
  }

  const YT_ERRORS = {
    2: 'Link de vídeo inválido.',
    5: 'O player do YouTube não conseguiu tocar este vídeo neste navegador.',
    100: 'Vídeo não encontrado (removido ou privado).',
    101: 'O dono do vídeo não permite que ele toque fora do YouTube.',
    150: 'O dono do vídeo não permite que ele toque fora do YouTube.',
    153: 'O YouTube recusou o player desta página.',
  };

  function YouTubeEngine(videoId, opts, on) {
    const el = host();
    const target = document.createElement('div');
    el.replaceChildren(target);
    el.classList.remove('audio-only');

    const startAt = Math.max(0, opts.start || 0);
    let player = null;
    let ready = false;
    let destroyed = false;
    let started = false; // já tocou alguma vez (antes disso, seekTo faria o vídeo tocar)
    let state = -1; // -1 não iniciado, 0 fim, 1 tocando, 2 pausado, 3 carregando, 5 pronto
    let rate = 1;
    let wantRate = 1;
    let volume = 1;
    let pendingSeek = null;
    let raw = startAt;
    let rawAt = performance.now();
    let holdTarget = null;
    let holdUntil = 0;
    let title = '';

    const call = (fn, ...args) => {
      try {
        return player && ready ? player[fn](...args) : undefined;
      } catch {
        return undefined;
      }
    };

    function meta() {
      const d = call('getVideoData');
      if (d && d.title && d.title !== title) {
        title = d.title;
        on('meta', title);
      }
    }

    const eng = {
      kind: 'youtube',
      time() {
        if (!ready || !started) return pendingSeek != null ? pendingSeek : startAt;
        const now = performance.now();
        let t = Number(call('getCurrentTime')) || 0;
        // Logo depois de um seek, a API ainda devolve o tempo antigo por alguns instantes.
        if (now < holdUntil && Math.abs(t - holdTarget) > 0.5) t = holdTarget;
        if (t !== raw) {
          raw = t;
          rawAt = now;
        }
        // A API só atualiza o tempo de tempos em tempos: estima entre as atualizações.
        if (state === 1) return Math.min(raw + ((now - rawAt) / 1000) * rate, eng.duration() || Infinity);
        return raw;
      },
      duration: () => Number(call('getDuration')) || 0,
      paused: () => !(state === 1 || state === 3),
      waiting: () => !ready || state === 3,
      seeking: () => false,
      actualRate: () => rate,
      play() {
        if (!ready) {
          opts.autoplay = true;
          return;
        }
        call('playVideo');
      },
      pause() {
        if (!ready) opts.autoplay = false;
        call('pauseVideo');
      },
      seek(t) {
        if (!ready || !started) {
          pendingSeek = t; // aplicado no primeiro play
          return;
        }
        call('seekTo', t, true);
        const now = performance.now();
        holdTarget = t;
        holdUntil = now + 1000;
        raw = t;
        rawAt = now;
        on('seeked');
      },
      setRate(r) {
        wantRate = r;
        if (!ready) return r;
        const avail = call('getAvailablePlaybackRates');
        const list = Array.isArray(avail) && avail.length ? avail : [1];
        const best = list.reduce((x, y) => (Math.abs(y - r) < Math.abs(x - r) ? y : x), list[0]);
        if (Math.abs(rate - best) > 0.0005) call('setPlaybackRate', best);
        rate = best;
        return best;
      },
      setVolume(vol) {
        volume = vol;
        call('setVolume', Math.round(vol * 100));
        call(vol === 0 ? 'mute' : 'unMute');
      },
      destroy() {
        destroyed = true;
        try {
          player?.destroy();
        } catch {
          /* ignore */
        }
        el.replaceChildren();
      },
    };

    loadYouTubeApi()
      .then((YT) => {
        if (destroyed) return;
        player = new YT.Player(target, {
          videoId,
          width: '100%',
          height: '100%',
          playerVars: {
            autoplay: opts.autoplay ? 1 : 0,
            controls: 0,
            rel: 0,
            playsinline: 1,
            iv_load_policy: 3,
            disablekb: 1,
            fs: 0,
            modestbranding: 1,
            start: Math.floor(startAt),
            origin: location.origin,
          },
          events: {
            onReady() {
              if (destroyed) return;
              ready = true;
              eng.setRate(wantRate);
              eng.setVolume(volume);
              meta();
              on('loaded');
              if (opts.autoplay) {
                call('playVideo');
                // Navegadores móveis bloqueiam o play sem toque: avisa se não começou.
                setTimeout(() => {
                  if (!destroyed && !started) on('blocked');
                }, 2500);
              }
            },
            onStateChange(e) {
              if (destroyed) return;
              state = e.data;
              if (state === 1 && !started) {
                started = true;
                raw = startAt;
                rawAt = performance.now();
                on('started');
                if (pendingSeek != null && Math.abs(pendingSeek - startAt) > 0.3) eng.seek(pendingSeek);
                pendingSeek = null;
                eng.setRate(wantRate);
              }
              meta();
              if (state === 1) on('play');
              else if (state === 2) on('pause');
              else if (state === 0) on('ended');
            },
            onPlaybackRateChange(e) {
              rate = Number(e.data) || rate;
              on('ratechange');
            },
            onError(e) {
              on('error', YT_ERRORS[e.data] || `Erro do YouTube (código ${e.data}).`);
            },
          },
        });
      })
      .catch(() => on('error', 'Não foi possível carregar o player do YouTube. Verifique a conexão com a internet.'));

    return eng;
  }

  // ---------------------------------------------------------------- controlador (mesma lógica da ponte do preload)
  const C = {
    engine: null,
    token: 0,
    objectUrl: null,
    rate: 1,
    volume: 1,
    loop: { a: null, b: null, enabled: false },
    gap: 0,
    gapTimer: null,
    lastStatusAt: 0,
    warnedRate: null,
  };

  function clearGap() {
    if (C.gapTimer) {
      clearTimeout(C.gapTimer);
      C.gapTimer = null;
      emit({ type: 'gap', active: false });
    }
  }

  function sendStatus(force) {
    const e = C.engine;
    if (!e) return;
    const now = performance.now();
    if (!force && now - C.lastStatusAt < 33) return;
    C.lastStatusAt = now;
    emit({
      type: 'status',
      time: e.time(),
      duration: e.duration(),
      paused: e.paused(),
      rate: e.actualRate(),
      volume: C.volume,
      muted: C.volume === 0,
      waiting: e.waiting(),
      gap: !!C.gapTimer,
    });
  }

  function applyRate() {
    const e = C.engine;
    if (!e) return;
    const actual = e.setRate(C.rate);
    if (Math.abs(actual - C.rate) > 0.001) {
      if (C.warnedRate !== C.rate) {
        C.warnedRate = C.rate;
        emit({ type: 'rate-limited', requested: C.rate, actual });
      }
    } else {
      C.warnedRate = null;
    }
  }

  function wrapLoop() {
    const e = C.engine;
    const { a } = C.loop;
    emit({ type: 'loop' });
    if (C.gap > 0) {
      e.pause();
      e.seek(a);
      clearGap();
      emit({ type: 'gap', active: true, seconds: C.gap });
      C.gapTimer = setTimeout(() => {
        C.gapTimer = null;
        emit({ type: 'gap', active: false });
        if (C.engine === e) e.play();
      }, C.gap * 1000);
    } else {
      e.seek(a);
      if (e.paused()) e.play();
    }
  }

  function tick() {
    const e = C.engine;
    if (e) {
      const { a, b, enabled } = C.loop;
      if (enabled && a != null && b != null && !e.paused() && !e.seeking() && !C.gapTimer && e.time() >= b) {
        wrapLoop();
      }
      sendStatus(false);
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  function onEngineEvent(eng, type, data) {
    if (eng !== C.engine) return;
    switch (type) {
      case 'loaded':
        applyRate();
        eng.setVolume(C.volume);
        sendStatus(true);
        break;
      case 'play':
        updateWakeLock(true);
        sendStatus(true);
        break;
      case 'pause':
        updateWakeLock(false);
        sendStatus(true);
        break;
      case 'seeked':
        sendStatus(true);
        break;
      case 'ended':
        if (C.loop.enabled && C.loop.a != null && C.loop.b != null) wrapLoop();
        sendStatus(true);
        break;
      case 'ratechange':
        if (eng.kind === 'local' && Math.abs(eng.actualRate() - C.rate) > 0.0005) setTimeout(applyRate, 0);
        sendStatus(true);
        break;
      case 'started':
        setPassThrough(false);
        break;
      case 'blocked':
        if (eng.kind === 'youtube' && coarse) setPassThrough(true);
        emit({ type: 'need-tap' });
        break;
      case 'meta':
        emit({ type: 'meta', title: data });
        break;
      case 'error':
        emit({ type: 'error', message: data });
        break;
      default:
        break;
    }
  }

  function destroyEngine() {
    clearGap();
    setPassThrough(false);
    if (C.engine) C.engine.destroy();
    C.engine = null;
    if (C.objectUrl) {
      URL.revokeObjectURL(C.objectUrl);
      C.objectUrl = null;
    }
    updateWakeLock(false);
  }

  async function loadPlayer(opts) {
    const token = ++C.token;
    destroyEngine();
    C.warnedRate = null;
    const o = { start: Math.max(0, Number(opts.start) || 0), autoplay: !!opts.autoplay };
    let eng;
    const on = (type, data) => onEngineEvent(eng, type, data);
    if (opts.mode === 'offline') {
      let file = null;
      try {
        file = await fileGet(opts.videoId);
      } catch {
        file = null;
      }
      if (token !== C.token) return;
      if (!file) {
        emit({ type: 'error', message: 'O arquivo deste projeto não foi encontrado neste aparelho.' });
        return;
      }
      C.objectUrl = URL.createObjectURL(file);
      eng = LocalEngine(C.objectUrl, { ...o, name: file.name || '' }, on);
    } else {
      eng = YouTubeEngine(opts.videoId, o, on);
      // Em tela de toque, deixa o primeiro toque chegar ao player do YouTube.
      if (coarse) setPassThrough(true);
    }
    C.engine = eng;
    emit({ type: 'bridge-ready' });
  }

  function unloadPlayer() {
    C.token += 1;
    destroyEngine();
    host().replaceChildren();
  }

  function command(cmd) {
    const e = C.engine;
    switch (cmd.type) {
      case 'setRate':
        C.rate = clamp(Number(cmd.rate) || 1, 0.1, 4);
        applyRate();
        return;
      case 'setLoop':
        C.loop = { a: cmd.a, b: cmd.b, enabled: !!cmd.enabled };
        if (!C.loop.enabled) clearGap();
        return;
      case 'setGap':
        C.gap = Math.max(0, Number(cmd.seconds) || 0);
        return;
      case 'setVolume':
        C.volume = clamp(Number(cmd.volume), 0, 1);
        if (e) e.setVolume(C.volume);
        return;
      default:
        break;
    }
    if (!e) return;
    switch (cmd.type) {
      case 'play':
        clearGap();
        e.play();
        break;
      case 'pause':
        clearGap();
        e.pause();
        break;
      case 'toggle':
        if (e.paused() && !C.gapTimer) e.play();
        else {
          clearGap();
          e.pause();
        }
        break;
      case 'seek': {
        const d = e.duration() || Infinity;
        e.seek(clamp(Number(cmd.time) || 0, 0, Math.max(0, d - 0.05)));
        sendStatus(true);
        break;
      }
      default:
        break;
    }
  }

  // ---------------------------------------------------------------- tela acesa durante o treino
  let wakeLock = null;
  let wakeReleaseTimer = null;
  async function updateWakeLock(playing) {
    if (!('wakeLock' in navigator)) return;
    clearTimeout(wakeReleaseTimer);
    if (playing) {
      if (wakeLock || document.visibilityState !== 'visible') return;
      try {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => {
          wakeLock = null;
        });
      } catch {
        wakeLock = null;
      }
    } else if (wakeLock) {
      // Pausas curtas (entre repetições, ajustes) não apagam a tela.
      wakeReleaseTimer = setTimeout(() => {
        wakeLock?.release().catch(() => {});
        wakeLock = null;
      }, 120000);
    }
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && C.engine && !C.engine.paused()) updateWakeLock(true);
  });

  // ---------------------------------------------------------------- dados, exportar, importar
  const STORE_KEY = 'solotracker-data';

  async function exportProject(fileName, data) {
    const safe = String(fileName || (typeof tr === 'function' ? tr : (x) => x)('projeto')).replace(/[\\/:*?"<>|]+/g, '_').slice(0, 120);
    const name = `${safe}.solotracker.json`;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    // No celular, tenta a folha de compartilhamento (WhatsApp, Drive, e-mail…).
    if (mobile && navigator.canShare) {
      const file = new File([blob], name, { type: 'application/json' });
      if (navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: String(fileName || (typeof tr === 'function' ? tr : (x) => x)('Projeto SoloTracker')) });
          return true;
        } catch (err) {
          if (err && err.name === 'AbortError') return false;
        }
      }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    return true;
  }

  async function importProjects() {
    const files = await pickFiles('.json,application/json', true);
    const out = await Promise.all(
      files.map(async (f) => {
        try {
          return JSON.parse(await f.text());
        } catch {
          return null;
        }
      }),
    );
    return out.filter(Boolean);
  }

  window.solo = {
    platform: 'web',
    layout: mobile ? 'mobile' : 'desktop',
    layoutForced: forced === 'mobile' || forced === 'desktop' ? forced : '',
    layoutAuto: autoMobile ? 'mobile' : 'desktop',
    setLayout(value) {
      try {
        if (value) localStorage.setItem(LAYOUT_KEY, value);
        else localStorage.removeItem(LAYOUT_KEY);
      } catch {
        /* ignore */
      }
    },
    send: command,
    onEvent: (cb) => listeners.push(cb),
    loadStore: async () => {
      try {
        return JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
      } catch {
        return null;
      }
    },
    saveStore: async (data) => {
      try {
        localStorage.setItem(STORE_KEY, JSON.stringify(data));
        return true;
      } catch {
        return false;
      }
    },
    openExternal: (url) => {
      if (/^https:\/\/(www\.)?(youtube\.com|youtu\.be)\//.test(url)) window.open(url, '_blank', 'noopener');
    },
    exportProject,
    importProjects,
    loadPlayer,
    unloadPlayer,
    offline: {
      list: () => fileList().catch(() => ({})),
      download: (key) => pickAndStore(String(key)),
      cancel: () => picking?.finish([]),
      remove: (key) => fileDelete(String(key)).catch(() => {}),
      onProgress: () => {},
    },
    // sem `stems`: a separação da guitarra (Demucs) só existe no app para PC
  };

  // ---------------------------------------------------------------- PWA (funciona sem internet depois da 1ª visita)
  if ('serviceWorker' in navigator && window.isSecureContext && location.protocol === 'https:') {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    });
  }
})();
