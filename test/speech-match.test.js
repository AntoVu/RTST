const test = require('node:test');
const assert = require('node:assert');
const { score, best } = require('../speech-match.js');

const target = 'Tengo veinte años y estudio ingeniería en la universidad.';

test('exact match, ignoring accents, case and punctuation', () => {
  assert.ok(score('tengo veinte anos y estudio ingenieria en la universidad', target) > 0.99);
});

test('a beginner attempt with misheard and dropped words still passes 0.6', () => {
  assert.ok(score('Tengo veinte año, estudio ingeniera en universidad.', target) >= 0.6);
  assert.ok(score('Tengo bente años y estudio injeniería en la universida', target) >= 0.6);
});

test('fillers and restarts barely hurt', () => {
  assert.ok(score('Eh, tengo... tengo veinte años y estudio ingeniería en la universidad.', target) >= 0.8);
});

test('something different fails', () => {
  assert.ok(score('Me gusta mucho jugar al fútbol con mis amigos.', target) < 0.4);
  assert.ok(score('Sí.', target) < 0.2);
  assert.strictEqual(score('', target), 0);
});

test('a long ramble that contains a few target words does not pass', () => {
  const ramble = 'Bueno yo tengo un perro y en la casa veinte libros de la escuela y mi madre trabaja mucho todos los días en la ciudad';
  assert.ok(score(ramble, target) < 0.6);
});

test('best picks the closest target above the threshold', () => {
  const targets = [{ id: 1, es: '¿Puede repetirlo, por favor?' }, { id: 2, es: target }];
  assert.strictEqual(best('puede repetir por favor', targets, 0.6).id, 1);
  assert.strictEqual(best('tengo veinte años', targets, 0.6), null); // only 3 of 9 words
  assert.strictEqual(best('hola', [], 0.6), null);
});
