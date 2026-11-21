/*
 * SoloTracker web — ajustes de interface.
 *  - Em qualquer navegador: opção "Layout" (Automático / Celular / PC) nas Configurações.
 *  - No celular (html.mobile): barra lateral com abas, controles na lateral, tela cheia
 *    e textos para toque.
 */
(function () {
  'use strict';

  const api = window.solo;
  if (!api || api.platform !== 'web') return;
  const root = document.documentElement;
  const isMobile = root.classList.contains('mobile');
  const byId = (id) => document.getElementById(id);
  const tr = window.tr || ((x) => x);
  const make = (tag, props = {}, children = []) => {
    const el = Object.assign(document.createElement(tag), props);
    children.forEach((c) => el.append(c));
    return el;
  };

  // ---------------------------------------------------------------- escolha do layout
  const grid = byId('settingsGrid');
  if (grid) {
    const select = make('select', { id: 'setLayout', className: 'web-select' }, [
      make('option', { value: '', textContent: `${tr('Automático')} (${api.layoutAuto === 'mobile' ? tr('celular') : 'PC'})` }),
      make('option', { value: 'mobile', textContent: tr('Celular') }),
      make('option', { value: 'desktop', textContent: 'PC' }),
    ]);
    select.value = api.layoutForced || '';
    select.addEventListener('change', () => {
      api.setLayout(select.value);
      location.reload();
    });
    grid.append(make('label', { htmlFor: 'setLayout', title: tr('Layout da tela. Automático detecta celular ou PC.'), textContent: 'Layout' }), select);
  }

  if (!isMobile) return;

  // ---------------------------------------------------------------- barra lateral
  // Controles e Trechos numa só coluna com rolagem. No alto: "Abrir projeto" e ⚙ (Ajustes),
  // que troca a coluna pelas configurações. A barra do topo fica escondida (web.css).
  const sidebar = document.querySelector('.sidebar');
  const controls = document.querySelector('.stage .controls');
  const VIEW_KEY = 'solotracker-view';

  if (sidebar && controls) {
    const pane = make('div', { className: 'panel m-controls' });
    pane.dataset.pane = 'controls';
    pane.append(controls);
    sidebar.prepend(pane);

    sidebar.querySelectorAll('details.panel').forEach((d) => {
      d.open = true;
      // O cabeçalho do <details> não deve fechar o painel.
      d.querySelector('summary')?.addEventListener('click', (e) => e.preventDefault());
    });

    const lib = byId('btnLibrary');
    const gear = make('button', { type: 'button', className: 'btn m-gear', textContent: '⚙', title: tr('Ajustes') });
    const head = make('div', { className: 'm-side-head' });
    if (lib) {
      lib.textContent = tr('📚 Abrir projeto');
      lib.title = tr('Biblioteca de projetos');
      head.append(lib);
    }
    head.append(gear);
    sidebar.prepend(head);

    const MAIN = ['controls', 'sections'];
    function setView(view) {
      const settingsOn = view === 'settings';
      gear.classList.toggle('on', settingsOn);
      sidebar.querySelectorAll('[data-pane]').forEach((p) => {
        p.classList.toggle('m-show', settingsOn ? p.dataset.pane === 'settings' : MAIN.includes(p.dataset.pane));
      });
      sidebar.scrollTop = 0;
      try {
        localStorage.setItem(VIEW_KEY, view);
      } catch {
        /* ignore */
      }
    }
    gear.addEventListener('click', () => setView(gear.classList.contains('on') ? 'main' : 'settings'));
    let last = 'main';
    try {
      last = localStorage.getItem(VIEW_KEY) === 'settings' ? 'settings' : 'main';
    } catch {
      /* ignore */
    }
    setView(last);
  }

  // Trecho fora da tela cheia: só "＋ Novo trecho". Ao tocar nele, no lugar aparece ●
  // (marca o início) e, depois, ■ (marca o fim, salva e toca), sempre com "Cancelar" embaixo.
  const newSec = byId('btnNewSection');
  if (newSec && typeof S !== 'undefined') {
    const rec = make('button', { type: 'button', className: 'btn m-cap-rec', textContent: '●', title: tr('Marcar início') });
    const stop = make('button', { type: 'button', className: 'btn m-cap-stop', textContent: '■', title: tr('Marcar fim') });
    const cancel = make('button', { type: 'button', className: 'btn m-cap-cancel', textContent: tr('Cancelar') });
    const box = make('div', { className: 'm-capture' }, [make('div', { className: 'm-cap-row' }, [rec, stop]), cancel]);
    newSec.after(box);
    const refresh = () => {
      const c = S.capture;
      box.classList.toggle('on', !!c);
      newSec.classList.toggle('m-hide', !!c);
      // Um botão por vez: ● até marcar o início, depois ■ até marcar o fim.
      rec.classList.toggle('m-hide', c !== 'a');
      stop.classList.toggle('m-hide', c !== 'b');
    };
    rec.addEventListener('click', () => S.capture === 'a' && newSec.click()); // captureMark: início
    stop.addEventListener('click', () => S.capture === 'b' && newSec.click()); // captureMark: fim
    cancel.addEventListener('click', () => S.capture && byId('btnClearLoop')?.click()); // cancelCapture
    new MutationObserver(refresh).observe(newSec, { childList: true, characterData: true, subtree: true, attributes: true });
    refresh();
  }

  const modeBtn = byId('btnMode');
  const settingsPane = sidebar?.querySelector('[data-pane="settings"]');
  if (modeBtn && settingsPane) {
    const row = make('div', { className: 'm-source' }, [
      make('span', { textContent: tr('Tocar por') }),
      modeBtn,
    ]);
    settingsPane.querySelector('summary')?.after(row);
  }

  const canFs = !!(root.requestFullscreen || root.webkitRequestFullscreen);

  // ---------------------------------------------------------------- vídeo em tela cheia
  /*
   * Gestos no modo vídeo em tela cheia:
   *   1 toque                 play/pause
   *   2 toques                volta ao início do trecho (ou do vídeo)
   *   1 dedo  esq/dir         avança/volta (ao voltar, nunca sai do trecho)
   *   1 dedo  cima/baixo      sai da tela cheia
   *   2 dedos cima/baixo      aumenta/diminui a velocidade
   *   2 dedos esq/dir         avança/volta mais rápido
   *   pinça                   zoom no ponto da pinça (o vídeo continua tocando)
   */
  const wrap = byId('videoWrap');
  const jogOverlay = byId('jogOverlay');
  if (wrap && jogOverlay && typeof S !== 'undefined') {
    const VFS_HINT_KEY = 'solotracker-vfs-hint';
    const TAP_MS = 260; // espera por um segundo toque
    const FAST = 5; // multiplicador do arraste com 2 dedos
    const SPEED_PX = 28; // px por passo de 5% na velocidade
    const ZOOM_MAX = 5;
    let docFs = false; // entramos no fullscreen do navegador?
    const active = () => root.classList.contains('m-vfs');
    const layer = make('div', { className: 'm-vfs-layer' });
    const enterBtn = make('button', { type: 'button', className: 'm-vfs-btn', textContent: '⛶', title: tr('Vídeo em tela cheia') });
    const exitBtn = make('button', { type: 'button', className: 'm-vfs-exit', textContent: '✕', title: tr('Sair da tela cheia') });
    // Novo trecho em tela cheia: ＋ → ● Rec (marca o início) → ■ Stop (marca o fim, salva e toca) → ＋
    const secBtn = make('button', { type: 'button', className: 'm-vfs-sec' });
    // ✕ abaixo do botão, enquanto ele mostra ● ou ■: cancela o novo trecho.
    const secCancel = make('button', { type: 'button', className: 'm-vfs-sec-cancel', textContent: '✕', title: tr('Cancelar') });
    // Indicador do trecho ativo (canto superior esquerdo) com ✕ para sair do trecho.
    const secName = make('span', { className: 'm-vfs-cur-name' });
    const secLeave = make('button', { type: 'button', className: 'm-vfs-cur-x', textContent: '✕', title: tr('Sair do trecho') });
    const secCur = make('div', { className: 'm-vfs-cur' }, [secName, secLeave]);
    // Barra de progresso no topo, mostrada durante o arraste (no lugar do tempo).
    const progRange = make('div', { className: 'm-vfs-prog-range' });
    const progFill = make('div', { className: 'm-vfs-prog-fill' });
    const progHead = make('div', { className: 'm-vfs-prog-head' });
    const prog = make('div', { className: 'm-vfs-prog' }, [progRange, progFill, progHead]);
    // Lista de trechos à esquerda, só com o vídeo pausado.
    const secList = make('div', { className: 'm-vfs-list' });
    jogOverlay.after(layer);
    wrap.append(enterBtn, exitBtn, secBtn, secCancel, secCur, prog, secList);

    /** Nomes antigos "Trecho 3" / "Section 3" aparecem só como "3". */
    const shortName = (name) => String(name || '').replace(/^(trecho|section)\s+(?=\d+$)/i, '');
    let listKey = '';
    function updateSecList() {
      const p = project();
      const secs = p ? [...p.sections].sort((x, y) => x.a - y.a || x.b - y.b) : [];
      const show = active() && S.paused && !S.inGap && !S.capture && secs.length > 0;
      const key = show ? `${S.activeSectionId}|${secs.map((x) => `${x.id}:${x.name}`).join(',')}` : '';
      secList.classList.toggle('on', show);
      secCur.classList.toggle('under-list', show);
      if (key === listKey) return;
      listKey = key;
      if (!show) return secList.replaceChildren();
      secList.replaceChildren(
        ...secs.map((sec) => {
          const cur = sec.id === S.activeSectionId;
          // Trecho atual: "1 ✕" — tocar nele sai do trecho (deseleciona).
          const item = make('button', {
            type: 'button',
            className: `m-vfs-item${cur ? ' cur' : ''}`,
            textContent: cur ? `${shortName(sec.name)} ✕` : shortName(sec.name),
            title: cur ? tr('Sair do trecho') : sec.name,
          });
          holdToDelete(item, sec);
          item.addEventListener('click', (e) => {
            e.stopPropagation();
            if (item.dataset.held) return delete item.dataset.held; // foi um toque longo
            if (!cur) return openSection(sec);
            clearLoop();
            toast(tr('Saiu do trecho'));
            return undefined;
          });
          return item;
        }),
      );
      secList.querySelector('.cur')?.scrollIntoView({ block: 'nearest' });
    }
    secList.addEventListener('pointerdown', (e) => e.stopPropagation());
    secList.addEventListener('contextmenu', (e) => e.preventDefault());

    // Apertar e segurar um trecho: pergunta se quer apagar (caixa na própria tela cheia,
    // porque o confirm() do navegador pode tirar o vídeo da tela cheia).
    const HOLD_MS = 600;
    function holdToDelete(el, sec) {
      let timer = null;
      let x0 = 0;
      let y0 = 0;
      const stop = () => {
        clearTimeout(timer);
        timer = null;
        el.classList.remove('holding');
      };
      el.addEventListener('pointerdown', (e) => {
        delete el.dataset.held;
        x0 = e.clientX;
        y0 = e.clientY;
        el.classList.add('holding');
        timer = setTimeout(() => {
          stop();
          el.dataset.held = '1';
          navigator.vibrate?.(30);
          askDelete(sec);
        }, HOLD_MS);
      });
      el.addEventListener('pointermove', (e) => {
        if (timer && Math.hypot(e.clientX - x0, e.clientY - y0) > 10) stop(); // rolando a lista
      });
      el.addEventListener('pointerup', stop);
      el.addEventListener('pointercancel', stop);
      el.addEventListener('pointerleave', stop);
    }

    function askDelete(sec) {
      layer.parentElement.querySelector('.m-vfs-confirm')?.remove();
      const name = shortName(sec.name);
      const no = make('button', { type: 'button', className: 'btn', textContent: tr('Cancelar') });
      const yes = make('button', { type: 'button', className: 'btn danger', textContent: tr('Excluir') });
      const box = make('div', { className: 'm-vfs-confirm' }, [
        make('div', { className: 'm-vfs-confirm-card' }, [
          make('p', { textContent: tr('Excluir "{name}"?', { name: /^\d+$/.test(name) ? tr('Trecho {n}', { n: name }) : name }) }),
          make('div', { className: 'm-vfs-confirm-btns' }, [no, yes]),
        ]),
      ]);
      const close = () => box.remove();
      box.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        if (e.target === box) close();
      });
      no.addEventListener('click', close);
      yes.addEventListener('click', () => {
        close();
        const p = project();
        if (!p) return;
        p.sections = p.sections.filter((x) => x.id !== sec.id);
        if (S.activeSectionId === sec.id) clearLoop();
        touch();
        renderSections();
        updateActiveSectionLabel();
        updateSecList();
        toast(tr('Trecho excluído'));
      });
      wrap.append(box);
    }
    api.onEvent(() => updateSecList());
    const sectionListEl = byId('sectionList');
    if (sectionListEl) new MutationObserver(() => updateSecList()).observe(sectionListEl, { childList: true });

    function updateCurSection() {
      const sec = !S.capture && S.activeSectionId ? activeSection() : null;
      secCur.classList.toggle('on', !!sec);
      if (sec) secName.textContent = shortName(sec.name);
      updateSecList();
    }
    secCur.addEventListener('pointerdown', (e) => e.stopPropagation());
    secLeave.addEventListener('click', (e) => {
      e.stopPropagation();
      clearLoop(); // sai do trecho: sem loop, o vídeo segue tocando normalmente
      updateCurSection();
      toast(tr('Saiu do trecho'));
    });
    const activeLabel = byId('activeSection');
    if (activeLabel) {
      new MutationObserver(updateCurSection).observe(activeLabel, { childList: true, characterData: true, subtree: true, attributes: true });
    }

    const newSectionBtn = byId('btnNewSection');
    function updateSecBtn() {
      const c = S.capture;
      secBtn.textContent = c === 'a' ? '●' : c === 'b' ? '■' : '+';
      secBtn.dataset.state = c || '';
      secBtn.classList.toggle('recording', !!c);
      secBtn.title = c === 'a' ? tr('Marcar início') : c === 'b' ? tr('Marcar fim') : tr('Novo trecho');
      secCancel.classList.toggle('on', !!c);
      updateCurSection();
    }
    secCancel.addEventListener('click', (e) => {
      e.stopPropagation();
      if (S.capture) byId('btnClearLoop')?.click(); // com captura ativa, o botão é "Cancelar"
      updateSecBtn();
    });
    secBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      // "+" durante um trecho: tira a seleção (e o loop) antes de começar o novo, e grava isso.
      if (!S.capture && (S.activeSectionId || hasLoop())) clearLoop();
      newSectionBtn?.click(); // mesmo fluxo do botão "＋ Novo trecho" (startCapture / captureMark)
      updateSecBtn();
    });
    // Mantém o rótulo certo quando a captura muda por outro caminho (Cancelar, troca de projeto…).
    if (newSectionBtn) {
      new MutationObserver(updateSecBtn).observe(newSectionBtn, { childList: true, characterData: true, subtree: true, attributes: true });
    }
    updateSecBtn();

    async function enterVfs() {
      root.classList.add('m-vfs');
      resetZoom();
      updateSecList();
      await requestDocFs();
      showHint();
    }
    /** Fullscreen do navegador (esconde a barra de endereço). Só funciona a partir de um toque. */
    async function requestDocFs() {
      if (!canFs || document.fullscreenElement || document.webkitFullscreenElement) return;
      try {
        await (root.requestFullscreen || root.webkitRequestFullscreen).call(root, { navigationUI: 'hide' });
        docFs = true;
      } catch {
        /* recusado pelo navegador (ex.: sem toque do usuário) */
      }
    }
    async function exitVfs() {
      if (!active()) return;
      root.classList.remove('m-vfs');
      resetZoom();
      layer.querySelector('.m-vfs-hint')?.remove();
      if (docFs) {
        docFs = false;
        try {
          if (document.fullscreenElement || document.webkitFullscreenElement) {
            await (document.exitFullscreen || document.webkitExitFullscreen).call(document);
          }
        } catch {
          /* ignore */
        }
      }
    }
    enterBtn.addEventListener('click', enterVfs);
    jogOverlay.addEventListener('jog-doubletap', enterVfs);
    exitBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
    exitBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      exitVfs();
    });
    // Botão "voltar" do Android / gesto do sistema saindo do fullscreen do navegador.
    const onFsChange = () => {
      if (docFs && !(document.fullscreenElement || document.webkitFullscreenElement)) {
        docFs = false;
        exitVfs();
      }
    };
    document.addEventListener('fullscreenchange', onFsChange);
    document.addEventListener('webkitfullscreenchange', onFsChange);

    // Girar o celular: deitado entra na tela cheia; de volta em pé, sai.
    // O fullscreen do navegador exige um toque, então ao girar só o vídeo ocupa a tela e o
    // primeiro toque nele (pointerup) completa o fullscreen do navegador.
    const landscape = matchMedia('(orientation: landscape)');
    const hasVideo = () => !jogOverlay.classList.contains('hidden');
    const onOrientation = () => {
      if (landscape.matches) {
        if (!active() && hasVideo() && !document.querySelector('.modal:not(.hidden)')) {
          enterVfs();
        }
      } else {
        exitVfs(); // de volta em pé: sempre sai da tela cheia
      }
    };
    landscape.addEventListener?.('change', onOrientation);

    function showHint() {
      try {
        if (localStorage.getItem(VFS_HINT_KEY) === '1') return;
        localStorage.setItem(VFS_HINT_KEY, '1');
      } catch {
        /* ignore */
      }
      const lines = [
        tr('1 toque: play/pause'),
        tr('2 toques: início do trecho'),
        tr('Arrastar ← →: voltar/avançar'),
        tr('Arrastar ↑ ↓: sair da tela cheia'),
        tr('2 dedos ↑ ↓: velocidade'),
        tr('2 dedos ← →: voltar/avançar rápido'),
        tr('Pinça: zoom'),
        tr('Botão +: novo trecho (● marca o início, ■ marca o fim)'),
      ];
      const hint = make('div', { className: 'm-vfs-hint' }, [
        make('div', {}, lines.map((l) => make('p', { textContent: l }))),
        make('p', { className: 'muted', textContent: tr('Toque para começar') }),
      ]);
      hint.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        hint.remove();
      });
      layer.append(hint);
    }

    // ---------------------------------------------- zoom (transform no player)
    const zoom = { s: 1, x: 0, y: 0 };
    const target = () => wrap.querySelector('.web-player:not(:empty)') || byId('ytFrame');
    function applyZoom() {
      const el = target();
      if (!el) return;
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      zoom.s = Math.min(ZOOM_MAX, Math.max(1, zoom.s));
      zoom.x = Math.min(0, Math.max(w - w * zoom.s, zoom.x));
      zoom.y = Math.min(0, Math.max(h - h * zoom.s, zoom.y));
      el.style.transformOrigin = '0 0';
      el.style.transform = zoom.s === 1 ? '' : `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.s})`;
    }
    function resetZoom() {
      zoom.s = 1;
      zoom.x = 0;
      zoom.y = 0;
      applyZoom();
    }

    // ---------------------------------------------- jog
    /** Limite inferior do arraste: com trecho ativo, nunca volta para antes do início. */
    const jogFloor = () => (!S.capture && hasLoop() && (S.loop.enabled || S.activeSectionId) ? S.loop.a : 0);
    function jogStart(g) {
      g.t0 = nowTime();
      g.wasPlaying = !S.paused;
      g.floor = jogFloor();
      scrubStart(g.wasPlaying);
    }
    function jogMove(g, dx, mult) {
      const delta = (dx / 100) * settings().jog * mult;
      const t = clamp(g.t0 + delta, g.floor, S.duration || Infinity);
      scrubLoopCheck(t, 'move');
      seekThrottled(t);
      showProgress(t, mult > 1);
    }
    function showProgress(t, fast) {
      const d = S.duration || 0;
      if (!d) return;
      const pct = (x) => `${(clamp(x / d, 0, 1) * 100).toFixed(3)}%`;
      progFill.style.width = pct(t);
      progHead.style.left = pct(t);
      const loop = hasLoop() && (S.loop.enabled || S.activeSectionId);
      progRange.style.display = loop ? '' : 'none';
      if (loop) {
        progRange.style.left = pct(S.loop.a);
        progRange.style.width = `${(clamp((S.loop.b - S.loop.a) / d, 0, 1) * 100).toFixed(3)}%`;
      }
      prog.classList.toggle('fast', fast);
      prog.classList.add('on');
    }
    function jogEnd(g) {
      prog.classList.remove('on', 'fast');
      const t = S.dragTime ?? g.t0;
      scrubLoopCheck(t, 'end');
      endDragSeek(t);
      scrubEnd(g.wasPlaying);
    }

    // ---------------------------------------------- gestos
    const pts = new Map(); // pointerId → {x, y}
    let g = null; // gesto atual
    let tapTimer = null;
    let lastTapAt = 0;

    const mid = () => {
      const [a, b] = [...pts.values()];
      return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) };
    };
    const local = (p) => {
      const r = wrap.getBoundingClientRect();
      return { x: p.x - r.left, y: p.y - r.top };
    };

    function finishGesture() {
      if (!g) return;
      if (g.mode === 'jog' || g.mode === 'fast') jogEnd(g);
      g = null;
    }

    function onTap() {
      const now = performance.now();
      if (now - lastTapAt < TAP_MS + 60 && tapTimer) {
        // segundo toque: volta ao início do trecho
        clearTimeout(tapTimer);
        tapTimer = null;
        lastTapAt = 0;
        seek(hasLoop() ? S.loop.a : 0);
        resetReps();
        toast(hasLoop() ? tr('⏮ Início do trecho') : tr('⏮ Início'));
        return;
      }
      lastTapAt = now;
      clearTimeout(tapTimer);
      tapTimer = setTimeout(() => {
        tapTimer = null;
        togglePlay();
      }, TAP_MS);
    }

    layer.addEventListener('pointerdown', (e) => {
      if (!active()) return;
      e.preventDefault();
      layer.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 1) {
        g = { mode: 'pending1', x: e.clientX, y: e.clientY, at: performance.now(), multi: false };
      } else if (pts.size === 2) {
        finishGesture(); // um arraste de 1 dedo em andamento termina aqui
        const m = mid();
        g = { mode: 'pending2', m0: m, multi: true, zs: zoom.s, zx: zoom.x, zy: zoom.y, r0: S.rate, steps: 0 };
      }
    });

    layer.addEventListener('pointermove', (e) => {
      if (!g || !pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (pts.size === 1 && !g.multi) {
        const dx = e.clientX - g.x;
        const dy = e.clientY - g.y;
        if (g.mode === 'pending1') {
          if (Math.hypot(dx, dy) < 10) return;
          if (Math.abs(dx) >= Math.abs(dy)) {
            g.mode = 'jog';
            jogStart(g);
          } else {
            g.mode = 'swipeV';
          }
        }
        if (g.mode === 'jog') jogMove(g, dx, 1);
        else if (g.mode === 'swipeV') wrap.style.transform = `translateY(${dy * 0.4}px)`;
        return;
      }

      if (pts.size !== 2 || !g.multi) return;
      const m = mid();
      const dx = m.x - g.m0.x;
      const dy = m.y - g.m0.y;
      const dd = m.d - g.m0.d;
      if (g.mode === 'pending2') {
        if (Math.abs(dd) > 24 && Math.abs(dd) > Math.hypot(dx, dy) * 0.8) g.mode = 'pinch';
        else if (Math.hypot(dx, dy) > 14) {
          g.mode = Math.abs(dy) > Math.abs(dx) ? 'speed' : 'fast';
          if (g.mode === 'fast') {
            g.x = g.m0.x;
            jogStart(g);
          }
        } else return;
      }
      if (g.mode === 'pinch') {
        // mantém fixo, sob o ponto médio atual, o ponto do vídeo que estava sob o ponto médio inicial
        const p0 = local(g.m0);
        const p1 = local(m);
        const s = Math.min(ZOOM_MAX, Math.max(1, g.zs * (m.d / g.m0.d)));
        const cx = (p0.x - g.zx) / g.zs;
        const cy = (p0.y - g.zy) / g.zs;
        zoom.s = s;
        zoom.x = p1.x - cx * s;
        zoom.y = p1.y - cy * s;
        applyZoom();
      } else if (g.mode === 'speed') {
        const steps = Math.round(-dy / SPEED_PX);
        if (steps !== g.steps) {
          g.steps = steps;
          setRate(Math.round((g.r0 + steps * 0.05) * 20) / 20);
        }
      } else if (g.mode === 'fast') {
        jogMove(g, dx, FAST);
      }
    });

    const up = (e) => {
      if (!pts.has(e.pointerId)) return;
      if (e.type === 'pointerup' && active() && !docFs) requestDocFs();
      pts.delete(e.pointerId);
      if (!g) return;
      if (!g.multi) {
        const dy = e.clientY - g.y;
        if (g.mode === 'pending1' && e.type === 'pointerup' && performance.now() - g.at < 400) onTap();
        else if (g.mode === 'swipeV') {
          wrap.style.transform = '';
          if (Math.abs(dy) > 60) exitVfs();
        }
        finishGesture();
        return;
      }
      // gesto de 2 dedos: termina quando o primeiro dedo sai; o outro é ignorado até soltar
      if (g.mode !== 'done') {
        finishGesture();
        if (pts.size) g = { mode: 'done', multi: true };
      } else if (!pts.size) {
        g = null;
      }
    };
    layer.addEventListener('pointerup', up);
    layer.addEventListener('pointercancel', up);

    window.addEventListener('resize', () => active() && applyZoom());
    // Trocar de vídeo/projeto: o player é recriado sem zoom.
    new MutationObserver(() => {
      if (zoom.s !== 1) applyZoom();
    }).observe(wrap, { childList: true });
  }

  // ---------------------------------------------------------------- campo de texto x teclado
  /*
   * O teclado do celular cobre a parte de baixo da tela sem encolher a página (só o
   * visualViewport encolhe). Ao editar um campo (ex.: renomear trecho), a coluna ganha
   * um espaço embaixo do tamanho do teclado e rola até o campo ficar visível.
   * (Não usamos interactive-widget=resizes-content: com o teclado aberto a página ficaria
   * "deitada" e a regra de orientação entraria na tela cheia.)
   */
  const vv = window.visualViewport;
  if (vv) {
    let field = null;
    let box = null;
    const fit = () => {
      if (!field || !box) return;
      const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      box.style.paddingBottom = kb ? `${kb + 16}px` : '';
      const r = field.getBoundingClientRect();
      const top = vv.offsetTop + 8;
      const bottom = vv.offsetTop + vv.height - 16;
      if (r.bottom > bottom) box.scrollTop += r.bottom - bottom + 24;
      else if (r.top < top) box.scrollTop -= top - r.top + 24;
    };
    document.addEventListener('focusin', (e) => {
      const el = e.target;
      if (!el.matches?.('input[type=text], input[type=number], input:not([type]), textarea')) return;
      const scroller = el.closest('.sidebar');
      if (!scroller) return;
      field = el;
      box = scroller;
      [100, 350, 700].forEach((ms) => setTimeout(fit, ms)); // o teclado abre com animação
    });
    document.addEventListener('focusout', (e) => {
      if (e.target !== field) return;
      if (box) box.style.paddingBottom = '';
      field = null;
      box = null;
    });
    vv.addEventListener('resize', fit);
  }

  // ---------------------------------------------------------------- textos para toque
  const ph = byId('placeholder');
  const link = byId('placeholderLibrary');
  if (ph && link) {
    // Mantém o mesmo <a> (o app.js já ligou o clique nele).
    const [p1, p2] = ph.querySelectorAll('p');
    link.textContent = tr('📚 Biblioteca');
    p1.replaceChildren(`${tr('Abra a')} `, link, ` ${tr('para criar um projeto com um link do YouTube ou um arquivo do celular.')}`);
    if (p2) p2.textContent = tr('Arraste sobre o vídeo para avançar/voltar • Toque para play/pause • Dois toques: tela cheia');
  }
  const empty = byId('sectionListEmpty');
  if (empty) {
    empty.textContent = tr('Nenhum trecho ainda. Toque em "＋ Novo trecho", depois toque no início e no fim do trecho.');
  }
  const jog = byId('jogOverlay');
  if (jog) jog.title = '';
})();
