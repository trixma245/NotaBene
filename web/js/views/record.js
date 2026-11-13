// Écran d'enregistrement : réglages avant de démarrer, puis suivi en direct.
import { $, h, toast, fmtTime, fmtSize, fmtDur, confirmBox } from '../util.js';
import { newCourse, getCourse, askPersist } from '../db.js';
import { getSettings, setSettings } from '../settings.js';
import { recorder, recorderSupport, batteryInfo, LivePreview } from '../recorder.js';
import { head, banner, subjectSelect } from './common.js';

const preview = new LivePreview();

export default async function record(root, { params }) {
  const resumeId = params[0];
  if (recorder.state !== 'idle' && !recorder.memoryOnly) return liveView(root, { live: !!preview.active });
  if (recorder.state !== 'idle') { try { await recorder.stop(); } catch {} }
  const existing = resumeId ? await getCourse(resumeId) : null;
  return setupView(root, existing);
}

// ---------------------------------------------------------------- Avant de démarrer
function setupView(root, existing) {
  const s = getSettings();
  const support = recorderSupport();
  let subjectId = existing?.subjectId ?? s.lastSubject ?? '';
  let micMode = s.micMode, chain = s.chain, gain = s.gain, live = s.livePreview && LivePreview.supported();

  const title = h('input', { type: 'text', placeholder: `Cours du ${new Date().toLocaleDateString('fr-FR')}`, value: existing?.title || '' });
  const gainLabel = h('b', null, `×${gain}`);
  const gainRow = h('label', { class: `field ${chain ? '' : 'hidden'}` },
    h('span', null, 'Gain (amplification) : ', gainLabel),
    h('input', { type: 'range', min: 1, max: 8, step: 0.5, value: gain, oninput: e => { gain = +e.target.value; gainLabel.textContent = `×${gain}`; } }));
  const seg = h('div', { class: 'seg' },
    ['brut', 'ameliore'].map(m => h('button', {
      class: micMode === m ? 'active' : '', type: 'button',
      onclick: e => { micMode = m; [...seg.children].forEach(b => b.classList.toggle('active', b === e.currentTarget)); modeHelp.textContent = MODE_HELP[m]; },
    }, m === 'brut' ? 'Brut (recommandé)' : 'Amélioré')));
  const MODE_HELP = {
    brut: 'Brut : le son n\'est pas retouché par le téléphone. C\'est ce qui donne la meilleure transcription.',
    ameliore: 'Amélioré : le téléphone remonte automatiquement le volume. À essayer si la voix est vraiment très lointaine.',
  };
  const modeHelp = h('p', { class: 'muted small' }, MODE_HELP[micMode]);
  const startBtn = h('button', { class: 'btn danger big block', disabled: !!support }, existing ? '● Continuer l\'enregistrement' : '● Démarrer l\'enregistrement');

  startBtn.onclick = async () => {
    startBtn.disabled = true;
    startBtn.textContent = 'Demande du micro…';
    setSettings({ micMode, chain, gain, livePreview: live, lastSubject: subjectId });
    const course = existing || newCourse({ title: title.value.trim(), subjectId, source: 'rec' });
    if (existing) { existing.subjectId = subjectId; if (title.value.trim()) { existing.title = title.value.trim(); existing.autoTitle = false; } }
    try {
      await recorder.start({ course, micMode, chain, gain });
      askPersist();
      root.replaceChildren();
      cleanupLive = liveView(root, { live });
    } catch (e) {
      toast(e.message, 'err');
      startBtn.disabled = false;
      startBtn.textContent = existing ? '● Continuer l\'enregistrement' : '● Démarrer l\'enregistrement';
    }
  };
  let cleanupLive = null;

  root.append(
    head(existing ? 'Continuer un enregistrement' : 'Nouvel enregistrement', existing ? `#/c/${existing.id}` : '#/'),
    support && banner('err', support),
    existing && banner('info', `La suite sera ajoutée à « ${existing.title} » (déjà ${fmtDur(existing.duration)}).`),
    h('div', { class: 'card' },
      h('label', { class: 'field' }, h('span', null, 'Matière'), subjectSelect(subjectId, v => { subjectId = v; })),
      h('label', { class: 'field' }, h('span', null, 'Titre (facultatif)'), title)),
    h('div', { class: 'card' },
      h('h3', null, 'Micro'), seg, modeHelp,
      h('label', { class: 'check' },
        h('input', { type: 'checkbox', checked: chain, onchange: e => { chain = e.target.checked; gainRow.classList.toggle('hidden', !chain); } }),
        h('span', null, 'Renforcer la voix dès l\'enregistrement', h('br'), h('span', { class: 'muted small' }, 'Filtre anti-grondement + compresseur + gain. Utile si l\'appareil est loin du prof. Sinon laisse décoché : le nettoyage se fait de toute façon avant la transcription.'))),
      gainRow,
      LivePreview.supported() && h('label', { class: 'check' },
        h('input', { type: 'checkbox', checked: live, onchange: e => { live = e.target.checked; } }),
        h('span', null, 'Aperçu du texte en direct', h('br'), h('span', { class: 'muted small' }, 'Juste pour voir que ça capte. Ce n\'est PAS la transcription finale. Sur certains téléphones cela peut gêner le micro : décoche en cas de souci.')))),
    banner('warn',
      h('b', null, '⚠️ Sur téléphone : '), 'si l\'écran se verrouille, le navigateur coupe le micro. NotaBene garde l\'écran allumé ; utilise le ', h('b', null, 'mode écran noir'), ' pour économiser la batterie et ne verrouille pas le téléphone.',
      h('br'), h('b', null, 'Solution de secours : '), 'enregistre avec l\'appli Dictaphone du téléphone (elle continue écran éteint), puis importe le fichier depuis l\'accueil.'),
    startBtn,
    h('p', { class: 'center', style: 'margin-top:12px' }, h('a', { href: '#/test' }, 'Faire d\'abord un test de captation (15 s)')));

  return () => { cleanupLive?.(); };
}

// ---------------------------------------------------------------- Pendant l'enregistrement
function liveView(root, { live = false } = {}) {
  document.body.classList.add('no-nav');
  const timer = h('div', { class: 'timer' }, '00:00');
  const stateChip = h('span', { class: 'chip err' }, '● Enregistrement');
  const fill = h('div', { class: 'meter-fill' });
  const meter = h('div', { class: 'meter' }, fill);
  const levelTxt = h('span', { class: 'muted small' }, '');
  const lowBanner = banner('warn', '🔈 Niveau de voix trop faible. Rapproche l\'appareil du prof, sors-le du sac, ou active « Renforcer la voix ».');
  lowBanner.classList.add('hidden');
  const gapBox = h('div');
  const size = h('b', null, '0 Ko'), batt = h('b', null, '—'), saved = h('b', null, '—');
  const wake = h('p', { class: 'muted small center' }, '');
  const pauseBtn = h('button', { class: 'btn' }, '⏸ Pause');
  const liveBox = h('div', { class: 'live-box' }, h('i', null, 'En attente de paroles…'));
  let lastSave = 0, batt0 = null, stopped = false;

  pauseBtn.onclick = () => {
    if (recorder.state === 'recording') recorder.pause(); else recorder.resume();
    const paused = recorder.state === 'paused';
    pauseBtn.textContent = paused ? '▶ Reprendre' : '⏸ Pause';
    stateChip.textContent = paused ? '⏸ En pause' : '● Enregistrement';
    stateChip.className = `chip ${paused ? 'warn' : 'err'}`;
  };
  const stopBtn = h('button', { class: 'btn danger big block', onclick: async () => {
    if (recorder.elapsed > 20 && !(await confirmBox('Terminer et sauvegarder cet enregistrement ?', { ok: 'Terminer' }))) return;
    await finish();
  } }, '■ Terminer et sauvegarder');

  async function finish() {
    if (stopped) return;
    stopped = true;
    stopBtn.disabled = true; stopBtn.textContent = 'Sauvegarde…';
    preview.stop();
    hideBlackout();
    const c = await recorder.stop();
    document.body.classList.remove('no-nav');
    if (c?.id) { toast('Enregistrement sauvegardé ✓', 'ok'); location.hash = `#/c/${c.id}`; } else location.hash = '#/';
  }

  const onTick = () => {
    timer.textContent = fmtTime(recorder.elapsed);
    const pct = Math.max(0, Math.min(100, (recorder.level + 70) / 70 * 100));
    fill.style.width = pct + '%';
    levelTxt.textContent = recorder.state === 'paused' ? 'En pause' : `Niveau : ${Math.round(recorder.level)} dB`;
    meter.classList.toggle('low', recorder.low);
    lowBanner.classList.toggle('hidden', !recorder.low || recorder.state !== 'recording');
    size.textContent = fmtSize(recorder.bytes);
    saved.textContent = lastSave ? `il y a ${Math.max(0, Math.round((Date.now() - lastSave) / 1000))} s` : 'dans < 30 s';
    wake.textContent = recorder.wakeOk ? '🔆 Écran maintenu allumé' : '⚠️ Ce navigateur ne peut pas empêcher la mise en veille : règle la veille du téléphone sur 30 min ou touche l\'écran de temps en temps.';
  };
  const onSaved = () => { lastSave = Date.now(); };
  const onGap = e => {
    const g = e.detail;
    if (!g?.ms) return;
    gapBox.append(banner('err', `⚠️ Coupure possible vers ${fmtTime(g.at)} : l'appli a été mise en veille pendant ${Math.round(g.ms / 1000)} s (écran verrouillé ou autre appli). Garde NotaBene à l'écran.`));
  };
  const onError = e => toast(e.detail.message, 'err', 12000);
  const onStop = () => { if (!stopped) { stopped = true; document.body.classList.remove('no-nav'); preview.stop(); hideBlackout(); const id = recorder.course?.id; location.hash = id ? `#/c/${id}` : '#/'; } };
  recorder.addEventListener('tick', onTick);
  recorder.addEventListener('saved', onSaved);
  recorder.addEventListener('gap', onGap);
  recorder.addEventListener('error', onError);
  recorder.addEventListener('stop', onStop);

  // Batterie : niveau + estimation du temps restant
  async function updateBattery() {
    const b = await batteryInfo();
    if (!b) { batt.textContent = 'n/d'; return; }
    const pct = Math.round(b.level * 100);
    if (!batt0 || b.charging) batt0 = { level: b.level, t: Date.now() };
    let txt = `${pct} %`;
    const hours = (Date.now() - batt0.t) / 3600000, drop = batt0.level - b.level;
    if (b.charging) txt += ' ⚡';
    else if (drop >= 0.02 && hours > 0.03) txt += ` · ~${fmtDur(b.level / (drop / hours) * 3600)}`;
    batt.textContent = txt;
    batt.style.color = !b.charging && b.level < 0.15 ? 'var(--red)' : '';
  }
  updateBattery();
  const battTimer = setInterval(updateBattery, 30000);

  if (live) {
    preview.start((final, interim, err) => {
      if (err) { liveBox.replaceChildren(h('i', null, 'Aperçu indisponible sur cet appareil (l\'enregistrement continue normalement).')); return; }
      liveBox.replaceChildren(final, h('i', null, interim));
      liveBox.scrollTop = liveBox.scrollHeight;
    });
  }

  // Mode écran noir
  const bo = $('#blackout');
  let lastTap = 0, dimTimer = null;
  const showBlackout = () => {
    bo.hidden = false; bo.classList.remove('dim');
    clearTimeout(dimTimer);
    dimTimer = setTimeout(() => bo.classList.add('dim'), 3500);
    document.documentElement.requestFullscreen?.().catch(() => {});
  };
  function hideBlackout() {
    bo.hidden = true;
    clearTimeout(dimTimer);
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  }
  const onTap = e => {
    e.preventDefault();
    const now = Date.now();
    if (now - lastTap < 450) hideBlackout();
    else { bo.classList.remove('dim'); clearTimeout(dimTimer); dimTimer = setTimeout(() => bo.classList.add('dim'), 2500); }
    lastTap = now;
  };
  bo.addEventListener('pointerdown', onTap);

  root.append(
    h('div', { class: 'center', style: 'margin-top:8px' }, stateChip),
    timer,
    h('p', { class: 'muted small center' }, recorder.course?.title || ''),
    meter, h('div', { class: 'row', style: 'justify-content:space-between;margin-top:4px' }, levelTxt, h('span', { class: 'muted small' }, 'faible ← → fort')),
    lowBanner, gapBox,
    h('div', { class: 'stats' },
      h('div', null, size, h('span', null, 'Taille')),
      h('div', null, batt, h('span', null, 'Batterie')),
      h('div', null, saved, h('span', null, 'Sauvegardé'))),
    recorder.gainNode && h('label', { class: 'field' }, h('span', null, 'Gain'),
      h('input', { type: 'range', min: 1, max: 8, step: 0.5, value: recorder.gainNode.gain.value, oninput: e => { recorder.setGain(+e.target.value); setSettings({ gain: +e.target.value }); } })),
    live && h('div', null, h('p', { class: 'muted small', style: 'margin:10px 0 4px' }, 'Aperçu approximatif — ce n\'est PAS la transcription finale :'), liveBox),
    h('div', { class: 'btn-grid', style: 'margin:14px 0' }, pauseBtn, h('button', { class: 'btn', onclick: showBlackout }, '🌑 Écran noir')),
    stopBtn, wake,
    h('p', { class: 'muted small center' }, 'Tout est sauvegardé toutes les 30 secondes. Ne verrouille pas l\'écran : utilise l\'écran noir, et baisse la luminosité du téléphone.'));
  onTick();

  return () => {
    recorder.removeEventListener('tick', onTick);
    recorder.removeEventListener('saved', onSaved);
    recorder.removeEventListener('gap', onGap);
    recorder.removeEventListener('error', onError);
    recorder.removeEventListener('stop', onStop);
    bo.removeEventListener('pointerdown', onTap);
    clearInterval(battTimer);
    document.body.classList.remove('no-nav');
    hideBlackout();
  };
}
