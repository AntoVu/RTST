const test = require('node:test');
const assert = require('node:assert');
const { buildTranslateRequest, buildDraftRequest, buildSuggestRequest, buildSummaryRequest, MODEL, NUM_CTX } = require('../prompts.js');

const history = [
  { who: 'them', es: 'Hola, me llamo María.', en: 'Hi, my name is María.' },
  { who: 'me', es: 'Mucho gusto, María.', en: 'Nice to meet you, María.' },
  { who: 'them', es: '¿Tienes hermanos?', en: null },
];
const all = () => [
  buildTranslateRequest('Hola', []),
  buildDraftRequest('Hola', [], '', ''),
  buildSuggestRequest([], '', ''),
  buildSummaryRequest(history),
];

test('every request: local model, non-streaming, thinking off, same num_ctx (so the model never reloads)', () => {
  for (const req of all()) {
    assert.strictEqual(req.model, MODEL);
    assert.strictEqual(req.stream, false);
    assert.strictEqual(req.think, false);
    assert.strictEqual(req.options.num_ctx, NUM_CTX);
    assert.strictEqual(req.messages[0].role, 'system');
  }
});

test('translate includes the text and only recent history', () => {
  const long = Array.from({ length: 20 }, (_, i) => ({ who: 'them', es: `frase ${i}`, en: null }));
  const msg = buildTranslateRequest('¿Cuánto cuesta?', long).messages.at(-1).content;
  assert.match(msg, /¿Cuánto cuesta\?/);
  assert.match(msg, /frase 19/);
  assert.doesNotMatch(msg, /frase 10\b/);
});

test('translate with no history has no history section', () => {
  assert.doesNotMatch(buildTranslateRequest('Hola', []).messages.at(-1).content, /conversation/i);
});

test('draft system prompt holds context then memory', () => {
  const sys = buildDraftRequest('Hola', [], 'I am Sam.', 'María likes fantasy books.').messages[0].content;
  assert.ok(sys.indexOf('I am Sam.') < sys.indexOf('María likes fantasy books.'));
});

test('draft sees the whole meeting, labeled by speaker, in order, newest message last', () => {
  const long = [...history, ...Array.from({ length: 40 }, (_, i) => ({ who: 'them', es: `relleno ${i}`, en: null }))];
  const msg = buildDraftRequest('¿Recuerdas mi nombre?', long, 'ctx', '').messages.at(-1).content;
  assert.match(msg, /Them: Hola, me llamo María\./, 'the very first message is still there');
  assert.match(msg, /You: Mucho gusto, María\./);
  assert.ok(msg.indexOf('me llamo María') < msg.indexOf('relleno 39') && msg.indexOf('relleno 39') < msg.indexOf('¿Recuerdas mi nombre?'));
});

test('draft asks for simple student-level Spanish', () => {
  assert.match(buildDraftRequest('Hola', [], '', '').messages[0].content, /student/i);
});

test('missing context and memory are stated, not left blank', () => {
  const sys = buildDraftRequest('Hola', [], '', '').messages[0].content;
  assert.match(sys, /no context/i);
  assert.doesNotMatch(sys, /memory_from_past_meetings/, 'no memory section when there is no memory');
});

test('suggest uses context, memory and the conversation', () => {
  const req = buildSuggestRequest(history, 'I am Sam.', 'María likes fantasy books.');
  assert.match(req.messages[0].content, /I am Sam\./);
  assert.match(req.messages[0].content, /María likes fantasy books\./);
  assert.match(req.messages.at(-1).content, /¿Tienes hermanos\?/);
});

test('summary includes the transcript with translations', () => {
  const msg = buildSummaryRequest(history).messages.at(-1).content;
  assert.match(msg, /Hola, me llamo María\./);
  assert.match(msg, /Hi, my name is María\./);
});
