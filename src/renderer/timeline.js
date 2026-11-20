/* Linha do tempo reutilizável: mostra posição, região do loop e alças A/B arrastáveis.
 * Funciona com mouse e toque (Pointer Events). Usada tanto para o vídeo inteiro
 * quanto para o "zoom" do loop. */

// eslint-disable-next-line no-unused-vars
class Timeline {
  /**
   * @param {HTMLElement} el
   * @param {{
   *   getView: (s: object) => [number, number],
   *   onSeek: (t: number, phase: 'start'|'move'|'end') => void,
   *   onHandle: (which: 'a'|'b', t: number, phase: 'start'|'move'|'end') => void,
   *   getSections?: () => {id: string, name: string, a: number, b: number, label: string}[],
   *   onSection?: (id: string) => void,
   * }} opts
   * getSections/onSection (opcionais): desenha trechos salvos clicáveis sobre a trilha.
   */
  constructor(el, opts) {
    this.el = el;
    this.opts = opts;
    this.state = { time: 0, duration: 0, a: null, b: null, enabled: false };
    this.drag = null;
    this.ticksKey = '';
    this.sectionsKey = '';

    el.innerHTML = `
      <div class="tl-ticks"></div>
      <div class="tl-track">
        <div class="tl-region"></div>
        <div class="tl-progress"></div>
      </div>
      <div class="tl-sections"></div>
      <div class="tl-head"></div>
      <div class="tl-handle a" data-handle="a"><span>A</span></div>
      <div class="tl-handle b" data-handle="b"><span>B</span></div>
      <div class="tl-hover"></div>
    `;
    this.$ = {
      ticks: el.querySelector('.tl-ticks'),
      sections: el.querySelector('.tl-sections'),
      region: el.querySelector('.tl-region'),
      progress: el.querySelector('.tl-progress'),
      head: el.querySelector('.tl-head'),
      a: el.querySelector('.tl-handle.a'),
      b: el.querySelector('.tl-handle.b'),
      hover: el.querySelector('.tl-hover'),
    };

    el.addEventListener('pointerdown', (e) => this.onDown(e));
    el.addEventListener('pointermove', (e) => this.onMove(e));
    el.addEventListener('pointerup', (e) => this.onUp(e));
    el.addEventListener('pointercancel', (e) => this.onUp(e));
    el.addEventListener('pointerleave', () => this.$.hover.classList.remove('show'));
  }

  view() {
    return this.drag ? this.drag.view : this.opts.getView(this.state);
  }

  xToTime(clientX, view = this.view()) {
    const r = this.el.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    const t = view[0] + f * (view[1] - view[0]);
    return Math.min(Math.max(0, t), this.state.duration || 0);
  }

  pct(t, view) {
    const span = view[1] - view[0];
    if (span <= 0) return 0;
    return ((t - view[0]) / span) * 100;
  }

  onDown(e) {
    if (!this.state.duration || e.button > 0) return;
    e.preventDefault();
    this.el.setPointerCapture(e.pointerId);
    const handle = e.target.closest('.tl-handle');
    const view = this.view();
    const sec = !handle && e.target.closest('.tl-sec');
    if (sec) {
      // Clique em um trecho salvo: abre o trecho ao soltar (se não arrastou).
      this.drag = { mode: 'section', id: sec.dataset.id, x: e.clientX, view, pointerId: e.pointerId };
      return;
    }
    const mode = handle ? handle.dataset.handle : 'seek';
    this.drag = { mode, view, pointerId: e.pointerId };
    const t = this.xToTime(e.clientX, view);
    if (mode === 'seek') this.opts.onSeek(t, 'start');
    else this.opts.onHandle(mode, t, 'start');
  }

  onMove(e) {
    if (!this.state.duration) return;
    const view = this.view();
    const t = this.xToTime(e.clientX, view);
    // Mostra o tempo sob o cursor.
    const r = this.el.getBoundingClientRect();
    this.$.hover.style.left = `${Math.min(Math.max(0, e.clientX - r.left), r.width)}px`;
    this.$.hover.textContent = fmtTime(t, true);
    this.$.hover.classList.add('show');

    if (!this.drag || this.drag.pointerId !== e.pointerId) return;
    if (this.drag.mode === 'section') {
      // Arrastou a partir de um trecho: vira um arraste normal da posição.
      if (Math.abs(e.clientX - this.drag.x) < 5) return;
      this.drag.mode = 'seek';
      this.opts.onSeek(t, 'start');
    }
    if (this.drag.mode === 'seek') this.opts.onSeek(t, 'move');
    else this.opts.onHandle(this.drag.mode, t, 'move');
  }

  onUp(e) {
    if (!this.drag || this.drag.pointerId !== e.pointerId) return;
    const t = this.xToTime(e.clientX, this.drag.view);
    const { mode, id } = this.drag;
    this.drag = null;
    if (e.type !== 'pointercancel') {
      if (mode === 'section') this.opts.onSection?.(id);
      else if (mode === 'seek') this.opts.onSeek(t, 'end');
      else this.opts.onHandle(mode, t, 'end');
    }
  }

  render(state) {
    this.state = state;
    const view = this.view();
    const { time, a, b, enabled } = state;
    const clampPct = (p) => Math.min(100, Math.max(0, p));

    const headPct = this.pct(time, view);
    this.$.head.style.left = `${clampPct(headPct)}%`;
    this.$.head.style.display = headPct < 0 || headPct > 100 ? 'none' : '';
    this.$.progress.style.width = `${clampPct(headPct)}%`;

    const showA = a != null;
    const showB = b != null;
    this.$.a.style.display = showA ? '' : 'none';
    this.$.b.style.display = showB ? '' : 'none';
    if (showA) this.$.a.style.left = `${clampPct(this.pct(a, view))}%`;
    if (showB) this.$.b.style.left = `${clampPct(this.pct(b, view))}%`;

    if (showA && showB) {
      const l = clampPct(this.pct(a, view));
      const r = clampPct(this.pct(b, view));
      this.$.region.style.display = '';
      this.$.region.style.left = `${l}%`;
      this.$.region.style.width = `${Math.max(0, r - l)}%`;
      this.$.region.classList.toggle('off', !enabled);
    } else {
      this.$.region.style.display = 'none';
    }

    this.renderTicks(view);
    this.renderSections(view);
  }

  renderSections(view) {
    if (!this.opts.getSections) return;
    const list = this.state.duration ? this.opts.getSections() : [];
    const key = `${list.map((x) => `${x.id}:${x.a}:${x.b}:${x.label}:${x.name}`).join('|')}#${view.join(',')}`;
    if (key === this.sectionsKey) return;
    this.sectionsKey = key;
    this.$.sections.innerHTML = '';
    list.forEach((x) => {
      const l = Math.min(100, Math.max(0, this.pct(x.a, view)));
      const r = Math.min(100, Math.max(0, this.pct(x.b, view)));
      if (r <= 0 || l >= 100) return;
      const div = document.createElement('div');
      div.className = 'tl-sec';
      div.dataset.id = x.id;
      div.style.left = `${l}%`;
      div.style.width = `${Math.max(0, r - l)}%`;
      div.title = `${x.name} (${fmtTime(x.a, true)} → ${fmtTime(x.b, true)}) — clique para abrir`;
      const span = document.createElement('span');
      span.textContent = x.label;
      div.appendChild(span);
      this.$.sections.appendChild(div);
    });
  }

  renderTicks(view) {
    const key = `${view[0].toFixed(3)}|${view[1].toFixed(3)}|${this.el.clientWidth}`;
    if (key === this.ticksKey) return;
    this.ticksKey = key;
    const span = view[1] - view[0];
    if (span <= 0) {
      this.$.ticks.innerHTML = '';
      return;
    }
    const target = Math.max(2, Math.floor(this.el.clientWidth / 90));
    const steps = [0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1200];
    const step = steps.find((s) => span / s <= target) || 3600;
    const first = Math.ceil(view[0] / step) * step;
    const precise = step < 1;
    let html = '';
    for (let t = first; t <= view[1] + 1e-9; t += step) {
      const p = this.pct(t, view);
      html += `<div class="tick" style="left:${p}%"><span>${fmtTime(t, precise)}</span></div>`;
    }
    this.$.ticks.innerHTML = html;
  }
}

function fmtTime(t, precise = false) {
  if (!Number.isFinite(t) || t < 0) t = 0;
  if (precise) {
    const total = Math.floor(t * 100 + 1e-6); // centésimos, sem erro de ponto flutuante
    const m = Math.floor(total / 6000);
    const s = Math.floor((total % 6000) / 100);
    const cs = total % 100;
    return `${m}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
  }
  const m = Math.floor(t / 60);
  return `${m}:${String(Math.floor(t - m * 60)).padStart(2, '0')}`;
}
