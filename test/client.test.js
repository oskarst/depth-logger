const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// The browser modules are ESM; load the DOM-free ones straight from disk.
const load = (file) =>
  import(pathToFileURL(path.join(__dirname, '..', 'public', 'js', file)).href);

test('depth colours run shallow to deep and clamp outside the range', async () => {
  const { getDepthColor } = await load('depth.js');
  assert.equal(getDepthColor(0, 20), 'rgb(173,216,230)');
  assert.equal(getDepthColor(20, 20), 'rgb(25,25,112)');
  // Beyond the measured maximum stays at the deepest colour instead of
  // running off the end of the scale.
  assert.equal(getDepthColor(40, 20), 'rgb(25,25,112)');
  assert.equal(getDepthColor(-2, 20), 'rgb(173,216,230)');
  // A project with no depth yet must not divide by zero.
  assert.match(getDepthColor(0, 0), /^rgb\(\d+,\d+,\d+\)$/);
});

test('depth colour gets darker with depth', async () => {
  const { getDepthColor } = await load('depth.js');
  const brightness = (rgb) =>
    rgb.match(/\d+/g).map(Number).reduce((a, b) => a + b, 0);
  assert.ok(brightness(getDepthColor(2, 20)) > brightness(getDepthColor(18, 20)));
});

test('the shallow pad offers shore, 0-17 and the range toggle', async () => {
  const { padKeys } = await load('pad.js');
  const keys = padKeys({ high: false, whole: null });
  assert.equal(keys[0].kind, 'shore');
  assert.equal(keys.at(-1).kind, 'range');
  const whole = keys.filter(k => k.kind === 'whole').map(k => k.value);
  assert.deepEqual(whole, Array.from({ length: 18 }, (_, i) => i));
});

test('the deep pad covers 18-40 and keeps the range toggle', async () => {
  const { padKeys } = await load('pad.js');
  const keys = padKeys({ high: true, whole: null });
  assert.equal(keys[0].kind, 'range');
  const whole = keys.filter(k => k.kind === 'whole').map(k => k.value);
  assert.equal(whole[0], 18);
  assert.equal(whole.at(-1), 40);
});

test('the decimal pad offers every digit plus cancel', async () => {
  const { padKeys } = await load('pad.js');
  const keys = padKeys({ high: false, whole: 7 });
  const digits = keys.filter(k => k.kind === 'decimal').map(k => k.value);
  // The logger pad used to skip 0, so a flat 7.0 could not be entered there.
  assert.deepEqual(digits, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.equal(keys.at(-1).kind, 'cancel');
});

test('range label names the band on offer', async () => {
  const { rangeLabel } = await load('pad.js');
  assert.equal(rangeLabel(false), '0–17');
  assert.equal(rangeLabel(true), '18–40');
});
