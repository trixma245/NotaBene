// Actions d'export dans le menu « ⋯ » d'un cours.
const ex = () => import('../exporter.js');

export default {
  id: 'more',
  menu(c) {
    const items = [];
    if (c.sheet || c.clean || c.raw) {
      items.push({ label: '⬇ Exporter le cours (.md)', run: () => ex().then(m => m.exportMd(c)) });
      items.push({ label: '⬇ Exporter le cours (.txt)', run: () => ex().then(m => m.exportTxt(c)) });
    }
    if (c.sheet) items.push({ label: '🖨️ Imprimer la fiche / PDF', run: () => ex().then(m => m.printSheet(c)) });
    if (c.hasAudio) {
      items.push({ label: '⬇ Télécharger l\'audio', run: () => ex().then(m => m.downloadAudio(c)) });
      items.push({ label: '💻 Exporter pour le transcripteur PC', run: () => ex().then(m => m.exportForPc(c)) });
    }
    items.push({ label: '📥 Importer une transcription (.json)', run: () => import('../importer.js').then(m => m.pickFiles()) });
    return items;
  },
};
