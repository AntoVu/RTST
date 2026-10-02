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

const { createListenButton } = require('../endpoint.js');
const newButton = () => createListenButton({ holdMs: 300, doubleTapMs: 400 });

test('tap starts auto-listening', () => {
  const b = newButton();
  assert.strictEqual(b.press(0), 'start');
  assert.strictEqual(b.release(100), 'auto');
});

test('hold stops on release, however long', () => {
  const b = newButton();
  assert.strictEqual(b.press(0), 'start');
  assert.strictEqual(b.release(90000), 'stop');
});

test('a later tap while auto-listening stops', () => {
  const b = newButton();
  b.press(0); b.release(100);
  assert.strictEqual(b.press(2000), 'stop');
  assert.strictEqual(b.release(2100), null, 'release of the stopping tap does nothing');
});

test('double-tap locks until the next tap', () => {
  const b = newButton();
  b.press(0); b.release(100);
  assert.strictEqual(b.press(350), 'lock');
  assert.strictEqual(b.release(420), null);
  assert.strictEqual(b.press(60000), 'stop');
  assert.strictEqual(b.release(60100), null);
});

test('reset after an automatic stop lets the next press start fresh', () => {
  const b = newButton();
  b.press(0); b.release(100);
  b.reset();
  assert.strictEqual(b.press(200), 'start');
});
