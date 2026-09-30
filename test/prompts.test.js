const test = require('node:test');
const assert = require('node:assert');
const { buildTranslateRequest, buildDraftRequest } = require('../prompts.js');

const history = [
  { es: 'Hola, ¿tienen el carro rojo?', en: 'Hi, do you have the red car?', reply: { reply_es: 'Sí, lo tenemos.', reply_en: 'Yes, we have it.' } },
  { es: '¿Y el azul?', en: null, reply: null },
];

test('translate uses haiku and includes the text to translate', () => {
  const req = buildTranslateRequest('¿Cuánto cuesta?', history);
  assert.strictEqual(req.model, 'claude-haiku-4-5');
  const msg = req.messages.at(-1).content;
  assert.match(msg, /¿Cuánto cuesta\?/);
  assert.match(msg, /¿tienen el carro rojo\?/, 'recent history is included for context');
});

test('translate with no history still works', () => {
  const req = buildTranslateRequest('Hola', []);
  assert.strictEqual(req.messages.length, 1);
  assert.doesNotMatch(req.messages[0].content, /Recent conversation/);
});

test('draft uses opus with low effort and puts the context file in a cached system block', () => {
  const req = buildDraftRequest('¿Cuánto cuesta?', history, 'I sell used cars. Prices $8-15k.');
  assert.strictEqual(req.model, 'claude-opus-5');
  assert.strictEqual(req.output_config.effort, 'low');
  const ctx = req.system.at(-1);
  assert.match(ctx.text, /I sell used cars/);
  assert.deepStrictEqual(ctx.cache_control, { type: 'ephemeral' });
});

test('draft history keeps order and shows what the user replied', () => {
  const msg = buildDraftRequest('¿Cuánto cuesta?', history, 'ctx').messages.at(-1).content;
  const iRed = msg.indexOf('carro rojo'), iReply = msg.indexOf('Sí, lo tenemos'), iBlue = msg.indexOf('el azul'), iNew = msg.indexOf('¿Cuánto cuesta?');
  assert.ok(iRed >= 0 && iRed < iReply && iReply < iBlue && iBlue < iNew, 'turns appear in order, latest message last');
});

test('draft without a context file says so instead of sending an empty block', () => {
  const req = buildDraftRequest('Hola', [], '');
  assert.match(req.system.at(-1).text, /no context/i);
});
