/*
 * SoloTracker web — ajustes de interface.
 *  - Em qualquer navegador: opção "Layout" (Automático / Celular / PC) nas Configurações.
 *  - No celular (html.mobile): barra lateral com abas, controles na lateral, tela cheia,
 *    textos para toque e aviso para girar o celular.
 */
(function () {
  'use strict';

  const api = window.solo;
  if (!api || api.platform !== 'web') return;
  const root = document.documentElement;
  const isMobile = root.classList.contains('mobile');
  const byId = (id) => document.getElementById(id);
  const make = (tag, props = {}, children = []) => {
    const el = Object.assign(document.createElement(tag), props);
    children.forEach((c) => el.append(c));
    return el;
  };

  // ---------------------------------------------------------------- escolha do layout
  const grid = byId('settingsGrid');
  if (grid) {
    const select = make('select', { id: 'setLayout', className: 'web-select' }, [
      make('option', { value: '', textContent: `Automático (${api.layoutAuto === 'mobile' ? 'celular' : 'PC'})` }),
      make('option', { value: 'mobile', textContent: 'Celular' }),
      make('option', { value: 'desktop', textContent: 'PC' }),
    ]);
    select.value = api.layoutForced || '';
    select.addEventListener('change', () => {
      api.setLayout(select.value);
      location.reload();
    });
    grid.append(make('label', { htmlFor: 'setLayout', title: 'Layout da tela. Automático detecta celular ou PC.', textContent: 'Layout' }), select);
  }

  const libEmpty = byId('libEmpty');
  if (libEmpty) libEmpty.textContent = 'Nenhum projeto ainda. Crie um com um link do YouTube ou com 📂 Arquivo (vídeo ou música do aparelho).';

  if (!isMobile) return;

  // ---------------------------------------------------------------- abas na barra lateral
  const sidebar = document.querySelector('.sidebar');
  const controls = document.querySelector('.stage .controls');
  const TAB_KEY = 'solotracker-tab';
  const tabs = [
    { id: 'controls', label: '🎛 Controles' },
    { id: 'sections', label: '📌 Trechos' },
    { id: 'trainer', label: '📈 Treino' },
    { id: 'settings', label: '⚙ Ajustes' },
  ];

  if (sidebar && controls) {
    const pane = make('div', { className: 'panel m-controls' });
    pane.dataset.pane = 'controls';
    pane.append(controls);
    sidebar.prepend(pane);

    sidebar.querySelectorAll('details.panel').forEach((d) => {
      d.open = true;
      // Nas abas, o cabeçalho do <details> não deve fechar o painel.
      d.querySelector('summary')?.addEventListener('click', (e) => e.preventDefault());
    });

    const bar = make('nav', { className: 'm-tabs' });
    const buttons = tabs.map((t) => {
      const b = make('button', { type: 'button', className: 'm-tab', textContent: t.label });
      b.dataset.tab = t.id;
      b.addEventListener('click', () => select(t.id));
      bar.append(b);
      return b;
    });
    sidebar.prepend(bar);

    function select(id) {
      if (!tabs.some((t) => t.id === id)) id = 'controls';
      buttons.forEach((b) => b.classList.toggle('on', b.dataset.tab === id));
      sidebar.querySelectorAll('[data-pane]').forEach((p) => p.classList.toggle('m-show', p.dataset.pane === id));
      sidebar.scrollTop = 0;
      try {
        localStorage.setItem(TAB_KEY, id);
      } catch {
        /* ignore */
      }
    }
    let last = 'controls';
    try {
      last = localStorage.getItem(TAB_KEY) || 'controls';
    } catch {
      /* ignore */
    }
    select(last);

    // Ao criar um trecho pelo botão, mostra a lista de trechos depois de marcar o fim.
    const list = byId('sectionList');
    if (list) {
      let count = list.children.length;
      new MutationObserver(() => {
        const n = list.children.length;
        if (n > count && byId('btnNewSection')?.textContent.includes('Novo')) {
          buttons.find((b) => b.dataset.tab === 'sections')?.classList.add('ping');
          setTimeout(() => buttons.forEach((b) => b.classList.remove('ping')), 1600);
        }
        count = n;
      }).observe(list, { childList: true });
    }
  }

  // ---------------------------------------------------------------- topo compacto
  const lib = byId('btnLibrary');
  if (lib) {
    lib.textContent = '📚';
    lib.title = 'Biblioteca de projetos';
  }

  // Tela cheia (Android). No iPhone não existe: sugere "Adicionar à Tela de Início".
  const standalone = matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches || navigator.standalone;
  const canFs = !!(root.requestFullscreen || root.webkitRequestFullscreen);
  const topbar = document.querySelector('.topbar');
  if (topbar && !standalone) {
    const fs = make('button', { type: 'button', className: 'btn small m-fs', textContent: '⛶', title: 'Tela cheia' });
    fs.addEventListener('click', async () => {
      if (!canFs) {
        alert('No iPhone, para usar em tela cheia: toque em Compartilhar e depois em "Adicionar à Tela de Início". Abra o SoloTracker pelo ícone criado.');
        return;
      }
      try {
        if (document.fullscreenElement || document.webkitFullscreenElement) {
          await (document.exitFullscreen || document.webkitExitFullscreen).call(document);
        } else {
          await (root.requestFullscreen || root.webkitRequestFullscreen).call(root, { navigationUI: 'hide' });
          await screen.orientation?.lock?.('landscape').catch(() => {});
        }
      } catch {
        /* recusado pelo navegador */
      }
    });
    topbar.append(fs);
  }

  // ---------------------------------------------------------------- textos para toque
  const ph = byId('placeholder');
  const link = byId('placeholderLibrary');
  if (ph && link) {
    // Mantém o mesmo <a> (o app.js já ligou o clique nele).
    const [p1, p2] = ph.querySelectorAll('p');
    link.textContent = '📚 Biblioteca';
    p1.replaceChildren('Abra a ', link, ' para criar um projeto com um link do YouTube ou um arquivo do celular.');
    if (p2) p2.textContent = 'Arraste sobre o vídeo para avançar/voltar • Toque para play/pause';
  }
  const empty = byId('sectionListEmpty');
  if (empty) {
    empty.textContent = 'Nenhum trecho ainda. Na aba Controles, toque em "＋ Novo trecho", depois toque no início e no fim do trecho.';
  }
  const jog = byId('jogOverlay');
  if (jog) jog.title = '';

  // ---------------------------------------------------------------- aviso para girar o celular
  const ROT_KEY = 'solotracker-rotate-ok';
  let dismissed = false;
  try {
    dismissed = sessionStorage.getItem(ROT_KEY) === '1';
  } catch {
    /* ignore */
  }
  if (!dismissed) {
    const hint = make('div', { className: 'm-rotate' }, [
      make('div', { className: 'm-rotate-card' }, [
        make('div', { className: 'm-rotate-icon', textContent: '📱↻' }),
        make('p', { textContent: 'Gire o celular para usar deitado.' }),
        make('button', { type: 'button', className: 'btn', textContent: 'Continuar assim' }),
      ]),
    ]);
    hint.querySelector('button').addEventListener('click', () => {
      hint.remove();
      try {
        sessionStorage.setItem(ROT_KEY, '1');
      } catch {
        /* ignore */
      }
    });
    document.body.append(hint);
  }
})();
