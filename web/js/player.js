// Lecteur audio d'un cours. Un enregistrement est fait de plusieurs « parties » de 5 min :
// le lecteur les enchaîne et présente une seule ligne de temps.
import { partBlob } from './db.js';
import { h, fmtTime } from './util.js';

const RATES = [1, 1.25, 1.5, 2, 0.75];

export class Player {
  constructor(course) {
    this.course = course;
    this.parts = [...(course.parts || [])].sort((a, b) => a.part - b.part);
    this.idx = -1;
    this.urls = new Map();
    this.rate = 1;
    this.onTime = null;                 // rappel(t) pendant la lecture
    this.audio = new Audio();
    this.audio.preload = 'auto';

    this.btn = h('button', { class: 'btn pp', 'aria-label': 'Lecture / pause', onclick: () => this.toggle() }, '▶');
    this.slider = h('input', { type: 'range', min: 0, max: Math.max(1, this.total), step: 0.5, value: 0, 'aria-label': 'Position dans le cours' });
    this.timeEl = h('span', { class: 'time' }, `00:00 / ${fmtTime(this.total)}`);
    this.rateBtn = h('button', { class: 'btn sm ghost', title: 'Vitesse de lecture', onclick: () => this.nextRate() }, '×1');
    this.el = h('div', { class: 'player' }, h('div', { class: 'row' }, this.btn, h('div', { class: 'grow' }, this.slider), this.timeEl, this.rateBtn));

    this._dragging = false;
    this.slider.addEventListener('input', () => { this._dragging = true; this.timeEl.textContent = `${fmtTime(+this.slider.value)} / ${fmtTime(this.total)}`; });
    this.slider.addEventListener('change', () => { this._dragging = false; this.seek(+this.slider.value, !this.audio.paused); });
    this.audio.addEventListener('timeupdate', () => this._update());
    this.audio.addEventListener('play', () => { this.btn.textContent = '⏸'; });
    this.audio.addEventListener('pause', () => { this.btn.textContent = '▶'; });
    this.audio.addEventListener('ended', () => this._next());
    this.audio.addEventListener('error', () => { if (this.audio.src) this.btn.textContent = '▶'; });
  }

  get total() {
    const sum = this.parts.reduce((m, p) => Math.max(m, (p.start || 0) + (p.dur || 0)), 0);
    return sum || this.course.duration || 0;
  }
  get time() {
    const p = this.parts[this.idx];
    return p ? (p.start || 0) + (this.audio.currentTime || 0) : 0;
  }

  _update() {
    const t = this.time;
    if (!this._dragging) {
      this.slider.value = t;
      this.timeEl.textContent = `${fmtTime(t)} / ${fmtTime(this.total)}`;
    }
    this.onTime?.(t);
  }

  async _load(i) {
    if (this.idx === i && this.audio.src) return;
    const p = this.parts[i];
    if (!p) return;
    let url = this.urls.get(p.part);
    if (!url) {
      url = URL.createObjectURL(await partBlob(this.course, p.part));
      this.urls.set(p.part, url);
    }
    this.idx = i;
    await new Promise(res => {
      const done = () => { this.audio.removeEventListener('loadedmetadata', done); this.audio.removeEventListener('error', done); res(); };
      this.audio.addEventListener('loadedmetadata', done);
      this.audio.addEventListener('error', done);
      this.audio.src = url;
      this.audio.load();
    });
    this.audio.playbackRate = this.rate;
    // Fichier importé dont on ne connaissait pas la durée : on la lit ici
    if (this.parts.length === 1 && !p.dur && isFinite(this.audio.duration)) {
      p.dur = this.audio.duration;
      this.slider.max = this.total;
    }
  }

  /** Va au temps t (en secondes depuis le début du cours) */
  async seek(t, play = true) {
    if (!this.parts.length) return;
    t = Math.max(0, Math.min(t, Math.max(0, this.total - 0.2)));
    let i = 0;
    for (let k = 0; k < this.parts.length; k++) if ((this.parts[k].start || 0) <= t + 0.01) i = k;
    await this._load(i);
    try { this.audio.currentTime = Math.max(0, t - (this.parts[i].start || 0)); } catch {}
    this._update();
    if (play) this.audio.play().catch(() => {});
  }

  async toggle() {
    if (!this.parts.length) return;
    if (this.idx < 0) await this._load(0);
    if (this.audio.paused) this.audio.play().catch(() => {}); else this.audio.pause();
  }

  async _next() {
    if (this.idx + 1 < this.parts.length) {
      await this._load(this.idx + 1);
      this.audio.currentTime = 0;
      this.audio.play().catch(() => {});
    } else {
      this.btn.textContent = '▶';
    }
  }

  nextRate() {
    this.rate = RATES[(RATES.indexOf(this.rate) + 1) % RATES.length];
    this.audio.playbackRate = this.rate;
    this.rateBtn.textContent = '×' + String(this.rate).replace('.', ',');
  }

  destroy() {
    try { this.audio.pause(); this.audio.removeAttribute('src'); this.audio.load(); } catch {}
    for (const u of this.urls.values()) URL.revokeObjectURL(u);
    this.urls.clear();
  }
}
