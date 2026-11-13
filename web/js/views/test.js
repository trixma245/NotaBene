// Test de captation : 15 secondes pour vérifier, AVANT le cours, si la position de l'appareil
// (sac, casier, table) donne un son exploitable.
import { h, toast, fmtDur } from '../util.js';
import { getSettings } from '../settings.js';
import { recorder, recorderSupport, extOf } from '../recorder.js';
import { decode, to16kMono, verdict } from '../audio.js';
import { head, banner } from './common.js';

const TEST_SEC = 15;

export default async function test(root) {
  const support = recorderSupport();
  const s = getSettings();
  const fill = h('div', { class: 'meter-fill' });
  const meter = h('div', { class: 'meter' }, fill);
  const count = h('div', { class: 'timer' }, String(TEST_SEC));
  const result = h('div');
  const startBtn = h('button', { class: 'btn primary big block', disabled: !!support || recorder.state !== 'idle' }, `Lancer le test (${TEST_SEC} s)`);
  const liveBox = h('div', { class: 'hidden' }, count, meter, h('p', { class: 'muted small center' }, 'Parle (ou fais parler quelqu\'un) à la distance où sera le prof.'));
  let url = null, timer = null, running = false;

  const onTick = () => {
    fill.style.width = Math.max(0, Math.min(100, (recorder.level + 70) / 70 * 100)) + '%';
    count.textContent = String(Math.max(0, Math.ceil(TEST_SEC - recorder.elapsed)));
  };

  startBtn.onclick = async () => {
    result.replaceChildren();
    startBtn.disabled = true;
    try {
      await recorder.start({ course: null, micMode: s.micMode, chain: s.chain, gain: s.gain, memoryOnly: true });
    } catch (e) { toast(e.message, 'err'); startBtn.disabled = false; return; }
    running = true;
    liveBox.classList.remove('hidden');
    recorder.addEventListener('tick', onTick);
    timer = setTimeout(finish, TEST_SEC * 1000);
  };

  async function finish() {
    if (!running) return;
    running = false;
    recorder.removeEventListener('tick', onTick);
    const blob = await recorder.stop();
    liveBox.classList.add('hidden');
    startBtn.disabled = false;
    startBtn.textContent = 'Refaire un test';
    if (!blob || !blob.size) { result.replaceChildren(banner('err', 'Rien n\'a été enregistré. Vérifie que le micro est autorisé.')); return; }
    if (url) URL.revokeObjectURL(url);
    url = URL.createObjectURL(blob);
    let stats = null, samples = null;
    try {
      const out = await to16kMono(await decode(await blob.arrayBuffer()), { clean: false });
      stats = out.stats; samples = out.samples;
    } catch { /* lecture seule possible */ }
    const v = stats ? verdict(stats) : null;
    const extra = h('div');
    result.replaceChildren(h('div', { class: 'card' },
      h('h3', null, 'Résultat'),
      h('audio', { controls: true, src: url, style: 'width:100%' }),
      stats && h('p', { class: 'small', style: 'margin-top:10px' },
        `Niveau moyen : ${Math.round(stats.rmsDb)} dB · Crête : ${Math.round(stats.peakDb)} dB · Durée : ${fmtDur(stats.duration)}`),
      v && banner(v.level, v.text),
      h('p', { class: 'muted small' }, 'Réécoute : si tu comprends chaque mot sans effort, la transcription sera bonne. Si tu dois tendre l\'oreille, change de position.'),
      extra));
    // Les autres modules (transcription) peuvent ajouter « Transcrire l'extrait »
    for (const load of TEST_BLOCKS) load().then(m => m.testBlock?.({ box: extra, samples, blob, ext: extOf(blob.type) })).catch(e => console.error(e));
  }

  root.append(
    head('Test de captation'),
    support && banner('err', support),
    h('div', { class: 'card' },
      h('p', null, 'Pose l\'appareil ', h('b', null, 'exactement là où il sera pendant le cours'), ' (dans le sac, le casier, sur la table...), puis lance le test.'),
      h('p', { class: 'muted small' }, `Réglages utilisés : micro « ${s.micMode === 'brut' ? 'Brut' : 'Amélioré'} »${s.chain ? `, voix renforcée (gain ×${s.gain})` : ''}. Ils se changent sur l'écran d'enregistrement.`),
      startBtn, liveBox),
    result,
    h('div', { class: 'card' },
      h('h3', null, 'Pour mieux capter'),
      h('ul', { class: 'small', style: 'padding-left:20px;margin:0' },
        h('li', null, 'Le micro du téléphone est en bas : tourne-le vers le prof.'),
        h('li', null, 'Dans un sac : poche extérieure, fermeture entrouverte, rien qui frotte dessus.'),
        h('li', null, 'Sur la table, pose-le sur un cahier (moins de vibrations).'),
        h('li', null, 'Loin des ventilateurs, de la clim et des bavards.'),
        h('li', null, 'Mode avion + Wi-Fi coupé = moins de bruits parasites et plus de batterie.'))));

  return () => {
    clearTimeout(timer);
    recorder.removeEventListener('tick', onTick);
    if (running) { running = false; recorder.stop().catch(() => {}); }
    if (url) URL.revokeObjectURL(url);
  };
}

const TEST_BLOCKS = [];
