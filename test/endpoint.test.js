const test = require('node:test');
const assert = require('node:assert');
const { createEndpointer } = require('../endpoint.js');

const opts = { threshold: 0.02, silenceMs: 1000, maxMs: 10000 };

test('does not stop on silence before any speech', () => {
  const ep = createEndpointer(opts);
  for (let t = 0; t <= 5000; t += 100) assert.strictEqual(ep.feed(0.001, t), 'continue');
});

test('stops after silenceMs of quiet following speech', () => {
  const ep = createEndpointer(opts);
  ep.feed(0.1, 0);
  ep.feed(0.1, 500);
  assert.strictEqual(ep.feed(0.001, 1400), 'continue');
  assert.strictEqual(ep.feed(0.001, 1500), 'stop');
});

test('a short pause mid-sentence does not stop', () => {
  const ep = createEndpointer(opts);
  ep.feed(0.1, 0);
  ep.feed(0.001, 800);
  assert.strictEqual(ep.feed(0.1, 900), 'continue');
  assert.strictEqual(ep.feed(0.001, 1800), 'continue');
});

test('stops at maxMs even while speaking', () => {
  const ep = createEndpointer(opts);
  ep.feed(0.1, 0);
  assert.strictEqual(ep.feed(0.1, 9999), 'continue');
  assert.strictEqual(ep.feed(0.1, 10000), 'stop');
});

test('time is measured from the first feed', () => {
  const ep = createEndpointer(opts);
  ep.feed(0.001, 50000);
  assert.strictEqual(ep.feed(0.1, 55000), 'continue');
  assert.strictEqual(ep.feed(0.1, 60000), 'stop');
});
