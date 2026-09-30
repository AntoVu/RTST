const test = require('node:test');
const assert = require('node:assert');
const { buildTranslateRequest, buildDraftRequest, MODEL } = require('../prompts.js');

const history = [
  { es: 'Hola, ¿tienen el carro rojo?', en: 'Hi, do you have the red car?', reply: { reply_es: 'Sí, lo tenemos.', reply_en: 'Yes, we have it.' } },
  { es: '¿Y el azul?', en: null, reply: null },
];

test('requests are non-streaming, thinking off, on the local model', () => {
  for (const req of [buildTranslateRequest('Hola', []), buildDraftRequest('Hola', [], '')]) {
    assert.strictEqual(req.model, MODEL);
    assert.strictEqual(req.stream, false);
    assert.strictEqual(req.think, false);
    assert.strictEqual(req.messages[0].role, 'system');
  }
});

test('translate includes the text and recent history', () => {
  const msg = buildTranslateRequest('¿Cuánto cuesta?', history).messages.at(-1).content;
  assert.match(msg, /¿Cuánto cuesta\?/);
  assert.match(msg, /¿tienen el carro rojo\?/, 'recent history is included for context');
});

test('translate with no history has no history section', () => {
  assert.doesNotMatch(buildTranslateRequest('Hola', []).messages.at(-1).content, /Recent conversation/);
});

test('draft puts the context file in the system prompt', () => {
  const req = buildDraftRequest('¿Cuánto cuesta?', history, 'I sell used cars. Prices $8-15k.');
  assert.match(req.messages[0].content, /I sell used cars/);
});

test('draft history keeps order and shows what the user replied', () => {
  const msg = buildDraftRequest('¿Cuánto cuesta?', history, 'ctx').messages.at(-1).content;
  const iRed = msg.indexOf('carro rojo'), iReply = msg.indexOf('Sí, lo tenemos'), iBlue = msg.indexOf('el azul'), iNew = msg.indexOf('¿Cuánto cuesta?');
  assert.ok(iRed >= 0 && iRed < iReply && iReply < iBlue && iBlue < iNew, 'turns appear in order, latest message last');
});

test('draft without a context file says so', () => {
  assert.match(buildDraftRequest('Hola', [], '').messages[0].content, /no context/i);
});
