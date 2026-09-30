const test = require('node:test');
const assert = require('node:assert');
const { pronounce } = require('../pronounce.js');

const cases = {
  hola: 'OH-lah',
  gracias: 'GRAH-syahs',
  'días': 'DEE-ahs',
  'señor': 'seh-NYOHR',
  quiero: 'KYEH-roh',
  general: 'heh-neh-RAHL',
  guitarra: 'gee-TAH-rrah',
  ciudad: 'syoo-DAHD',
  y: 'ee',
  estoy: 'ehs-TOY',
  'también': 'tahm-BYEHN',
  muy: 'mwee',
  ayuda: 'ah-YOO-dah',
  hablar: 'ah-BLAHR',
  'pingüino': 'peen-GWEE-noh',
  chico: 'CHEE-koh',
  llamar: 'yah-MAHR',
  taxi: 'TAHK-see',
};

for (const [es, want] of Object.entries(cases)) {
  test(`pronounce ${es}`, () => assert.strictEqual(pronounce(es), want));
}

test('keeps punctuation, lowercases, and leaves numbers alone', () => {
  assert.strictEqual(pronounce('¿Necesita ayuda?'), '¿neh-seh-SEE-tah ah-YOO-dah?');
  assert.strictEqual(pronounce('Son $89, gracias.'), 'sohn $89, GRAH-syahs.');
});
