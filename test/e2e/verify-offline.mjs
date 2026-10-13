// Needs a browser driver that is not a runtime dependency of the app:
//   npm i -D puppeteer && npm run test:e2e
// The server must already be running on :4567.
import puppeteer from 'puppeteer';

const BASE = 'http://localhost:4567';
const SHOT = new URL('.', import.meta.url).pathname;
const problems = [];
const steps = [];
const ok = (m) => steps.push('  ok   ' + m);
const bad = (m) => { steps.push('  FAIL ' + m); problems.push(m); };
const wait = (ms) => new Promise(r => setTimeout(r, ms));

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const ctx = browser.defaultBrowserContext();
await ctx.overridePermissions(BASE, ['geolocation']);
const page = await browser.newPage();
await page.setViewport({ width: 420, height: 880 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

await page.setGeolocation({ latitude: 41.7325, longitude: 44.7280, accuracy: 6 });
await page.goto(BASE, { waitUntil: 'networkidle2' });
await page.evaluate(() => navigator.serviceWorker.ready);

const A = 'Lake A ' + Date.now();
const B = 'Lake B ' + Date.now();

async function makeProject(name) {
  const id = await page.evaluate(async (name) => {
    const r = await (await fetch('/api/projects', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    })).json();
    return r.id;
  }, name);
  return id;
}
async function openProject(name) {
  await page.evaluate(() => document.querySelector('#change-project-btn').click());
  await wait(700);
  const hit = await page.evaluate((n) => {
    const row = [...document.querySelectorAll('.project-item')].find(el => el.querySelector('.project-name')?.textContent === n);
    if (!row) return false;
    row.click();
    return true;
  }, name);
  if (!hit) bad('could not open project ' + name);
  await wait(700);
}
async function key(label) {
  await page.evaluate((label) => {
    [...document.querySelectorAll('#pad .key')].find(b => b.textContent === label)?.click();
  }, label);
  await wait(420);
}
const tableDepths = () => page.evaluate(() =>
  [...document.querySelectorAll('#data-table tbody tr')].map(tr => tr.children[1].textContent).sort());
const queuedBadge = () => page.$eval('#offline-badge', el => el.textContent);

const idA = await makeProject(A);
const idB = await makeProject(B);
await openProject(A);

// === offline logging ===
await page.setOfflineMode(true);
await wait(300);

await key('7'); await key('5');   // 7.5
await key('8'); await key('0');   // 8.0
const badge = await queuedBadge();
badge === '2 queued' ? ok(`logged 2 points with the network down (badge: "${badge}")`) : bad(`queue badge reads "${badge}", expected "2 queued"`);

await page.evaluate(() => document.querySelector('#data-btn').click());
await wait(700);
const offlineRows = await tableDepths();
JSON.stringify(offlineRows) === JSON.stringify(['7.5','8.0'])
  ? ok('queued points show in the table while offline')
  : bad('offline table shows ' + JSON.stringify(offlineRows));

// the app shell itself must survive a reload with no network
await page.reload({ waitUntil: 'domcontentloaded' });
await wait(1500);
const shell = await page.evaluate(() => ({
  pad: document.querySelectorAll('#pad .key').length,
  leaflet: typeof window.L,
  turf: typeof window.turf
}));
shell.pad > 0 && shell.leaflet === 'object' && shell.turf === 'object'
  ? ok(`reloaded fully offline: pad (${shell.pad} keys), Leaflet and turf all served from cache`)
  : bad('offline reload broken: ' + JSON.stringify(shell));

await page.evaluate(() => document.querySelector('#data-btn').click());
await wait(900);
const afterReload = await tableDepths();
JSON.stringify(afterReload) === JSON.stringify(['7.5','8.0'])
  ? ok('queued points survive an offline reload')
  : bad('after offline reload the table shows ' + JSON.stringify(afterReload));

await page.screenshot({ path: SHOT + '/verify-offline.png' });

// === project isolation while points are still queued ===
await openProject(B);
await page.evaluate(() => document.querySelector('#data-btn').click());
await wait(800);
const bRows = await tableDepths();
bRows.length === 0
  ? ok("project A's queued points do not leak into project B")
  : bad('project B shows ' + JSON.stringify(bRows) + " — that is project A's data");

// Refresh the fix first: with a stale one, logPoint waits up to 3s for GPS.
await page.setGeolocation({ latitude: 41.7340, longitude: 44.7290, accuracy: 6 });
await wait(400);
await key('2'); await key('5');
await wait(3500);
const bAfter = await tableDepths();
JSON.stringify(bAfter) === JSON.stringify(['2.5'])
  ? ok('project B holds only its own queued point')
  : bad('project B shows ' + JSON.stringify(bAfter));

// === clearing one project leaves the other project's queue alone ===
page.on('dialog', d => d.accept());
await page.evaluate(() => document.querySelector('#clear-btn').click());
await wait(900);
const bCleared = await tableDepths();
bCleared.length === 0 ? ok('clear emptied project B') : bad('clear left ' + JSON.stringify(bCleared));

await openProject(A);
await page.evaluate(() => document.querySelector('#data-btn').click());
await wait(900);
const aSurvived = await tableDepths();
JSON.stringify(aSurvived) === JSON.stringify(['7.5','8.0'])
  ? ok("clearing project B left project A's queued points untouched")
  : bad("project A now shows " + JSON.stringify(aSurvived) + ' — clear destroyed another project\'s data');

// === back online: the queue drains by itself ===
await page.setOfflineMode(false);
await page.evaluate(() => window.dispatchEvent(new Event('online')));
await wait(2500);
const synced = await page.evaluate(async (id) => {
  const d = await (await fetch(`/api/projects/${id}/readings`)).json();
  return d.readings.map(r => r.depth).sort();
}, idA);
JSON.stringify(synced) === JSON.stringify([7.5, 8])
  ? ok('coming back online drained the queue to the server with no manual sync')
  : bad('server holds ' + JSON.stringify(synced) + ' after reconnecting');

const badgeAfter = await queuedBadge();
badgeAfter === 'All synced' ? ok('queue badge clears after the drain') : bad('badge reads ' + badgeAfter);

// a second push must not duplicate what is already up there
await page.evaluate(() => window.dispatchEvent(new Event('online')));
await wait(1500);
const count = await page.evaluate(async (id) => {
  const d = await (await fetch(`/api/projects/${id}/readings`)).json();
  return d.readings.length;
}, idA);
count === 2 ? ok('a repeated push does not duplicate readings') : bad(`server now holds ${count} readings, expected 2`);

for (const id of [idA, idB]) {
  await page.evaluate(async (id) => { await fetch(`/api/projects/${id}`, { method: 'DELETE' }); }, id);
}

errors.length === 0 ? ok('no page errors') : bad('page errors: ' + errors.slice(0, 3).join(' | '));

await browser.close();
console.log(steps.join('\n'));
console.log(problems.length ? `\n${problems.length} PROBLEM(S)` : '\nALL CHECKS PASSED');
process.exit(problems.length ? 1 : 0);
