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

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const ctx = browser.defaultBrowserContext();
await ctx.overridePermissions(BASE, ['geolocation']);
const page = await browser.newPage();
await page.setViewport({ width: 420, height: 880 });

const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));

await page.setGeolocation({ latitude: 41.7325, longitude: 44.7280, accuracy: 6 });
await page.goto(BASE, { waitUntil: 'networkidle2' });

const name = 'Verify ' + Date.now();

// --- create and select a project through the UI ---
await page.type('#new-project-input', name);
await page.click('#add-project-btn');
await new Promise(r => setTimeout(r, 600));

const clicked = await page.evaluate((projectName) => {
  const row = [...document.querySelectorAll('.project-item')]
    .find(el => el.querySelector('.project-name')?.textContent === projectName);
  if (!row) return false;
  row.click();
  return true;
}, name);
clicked ? ok('created and opened a project from the projects screen') : bad('could not create/open a project');

await new Promise(r => setTimeout(r, 500));
const onLogger = await page.$eval('#screen-logger', el => el.classList.contains('active'));
onLogger ? ok('selecting a project lands on the logger screen') : bad('did not land on the logger screen');

// --- log depths with the pad ---
async function key(label, scope = '#pad') {
  const hit = await page.evaluate((label, scope) => {
    const btn = [...document.querySelectorAll(scope + ' .key')].find(b => b.textContent === label);
    if (!btn) return false;
    btn.click();
    return true;
  }, label, scope);
  if (!hit) bad(`pad key "${label}" missing in ${scope}`);
  await new Promise(r => setTimeout(r, 450));
}

const soundings = [
  { depth: ['3', '5'], lat: 41.7325, lon: 44.7280 },
  { depth: ['4', '0'], lat: 41.7329, lon: 44.7285 },
  { depth: ['6', '2'], lat: 41.7333, lon: 44.7279 },
  { depth: ['5', '5'], lat: 41.7330, lon: 44.7272 }
];
for (const s of soundings) {
  await page.setGeolocation({ latitude: s.lat, longitude: s.lon, accuracy: 6 });
  await new Promise(r => setTimeout(r, 350));
  await key(s.depth[0]);
  await key(s.depth[1]);
}
ok(`entered ${soundings.length} soundings on the pad`);

// a whole number entered as X then 0 — the logger pad used to lack the 0 key
await page.setGeolocation({ latitude: 41.7336, longitude: 44.7290, accuracy: 6 });
await key('Shore');

// --- did they reach the server by themselves? ---
await new Promise(r => setTimeout(r, 1200));
const api = await page.evaluate(async () => {
  const projects = await (await fetch('/api/projects')).json();
  return projects;
});
const project = api.projects.find(p => p.name === name);
if (!project) bad('project missing from the API');
else if (project.readingsCount === 5) ok('all 5 points auto-synced to the server with no manual sync');
else bad(`server has ${project.readingsCount} of 5 points — auto-sync incomplete`);

const badge = await page.$eval('#offline-badge', el => el.textContent);
badge === 'All synced' ? ok('queue badge reads "All synced"') : bad(`queue badge reads "${badge}"`);

// --- data table ---
await page.click('#data-btn');
await new Promise(r => setTimeout(r, 800));
const table = await page.evaluate(() => [...document.querySelectorAll('#data-table tbody tr')].map(tr =>
  [...tr.querySelectorAll('td')].slice(0, 3).map(td => td.textContent)));
table.length === 5 ? ok(`data table lists all 5 readings`) : bad(`data table shows ${table.length} rows, expected 5`);
const depths = table.map(r => r[1]).sort();
JSON.stringify(depths) === JSON.stringify(['0.0','3.5','4.0','5.5','6.2'])
  ? ok('depths stored exactly as tapped: ' + depths.join(', '))
  : bad('unexpected depths: ' + depths.join(', '));
table.some(r => r[2].includes('🏖️')) ? ok('shore point tagged in the table') : bad('shore point not tagged');

// --- weeds tag on an already-synced point (the old silent no-op) ---
await page.click('#weeds-btn');
await new Promise(r => setTimeout(r, 900));
const weedsOnServer = await page.evaluate(async (id) => {
  const d = await (await fetch(`/api/projects/${id}/readings`)).json();
  return d.readings.filter(r => r.hasWeeds).length;
}, project?.id);
weedsOnServer === 1
  ? ok('weeds tag persisted to the server for an already-synced point')
  : bad(`weeds tag did not persist (server reports ${weedsOnServer} tagged)`);

const weedsInTable = await page.evaluate(() =>
  [...document.querySelectorAll('#data-table tbody tr')].some(tr => tr.children[2].textContent.includes('🌿')));
weedsInTable ? ok('weeds tag visible in the table') : bad('weeds tag not shown in the table');

// --- water level offset actually applied ---
await page.evaluate(async (id) => {
  await fetch(`/api/projects/${id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ waterLevelOffset: -0.3 })
  });
}, project.id);
await page.evaluate(() => location.reload());
await page.waitForNavigation({ waitUntil: 'networkidle2' });
await new Promise(r => setTimeout(r, 900));
await page.click('#data-btn');
await new Promise(r => setTimeout(r, 900));
const adjusted = await page.evaluate(() =>
  [...document.querySelectorAll('#data-table tbody tr')].map(tr => tr.children[1].textContent).sort());
JSON.stringify(adjusted) === JSON.stringify(['-0.3','3.2','3.7','5.2','5.9'])
  ? ok('water-level offset applied to displayed depths: ' + adjusted.join(', '))
  : bad('offset not applied, table shows: ' + adjusted.join(', '));
const offsetBadge = await page.$eval('#offset-badge', el => el.textContent + '|' + el.classList.contains('hidden'));
offsetBadge === 'offset -0.3m|false' ? ok('offset badge shown in the top bar') : bad('offset badge wrong: ' + offsetBadge);

// --- depth map ---
await page.click('#map-btn');
await new Promise(r => setTimeout(r, 2500));
const mapState = await page.evaluate(() => ({
  tiles: document.querySelectorAll('#depth-map .leaflet-tile').length,
  paths: document.querySelectorAll('#depth-map path').length,
  legend: document.querySelectorAll('#map-legend .legend-item').length,
  message: document.querySelector('#depth-map div')?.textContent?.slice(0, 40) || ''
}));
mapState.paths > 0 ? ok(`depth map rendered ${mapState.paths} vector features, ${mapState.legend} legend items`)
                   : bad('depth map drew nothing: ' + JSON.stringify(mapState));

// --- live map ---
await page.click('#livemap-btn');
await new Promise(r => setTimeout(r, 2500));
const live = await page.evaluate(() => ({
  marker: !!document.querySelector('.live-marker'),
  points: document.querySelectorAll('#live-map path').length,
  padKeys: document.querySelectorAll('#live-pad .key').length
}));
live.marker ? ok('live map shows the GPS marker') : bad('live GPS marker missing');
live.points > 0 ? ok(`live map drew ${live.points} features`) : bad('live map drew no points');
live.padKeys > 0 ? ok(`live pad rendered ${live.padKeys} keys`) : bad('live pad empty');

// --- offline: service worker + cached shell ---
const swReady = await page.evaluate(async () => {
  const reg = await navigator.serviceWorker.ready;
  return !!reg.active;
});
swReady ? ok('service worker active') : bad('service worker not active');

const cached = await page.evaluate(async () => {
  const names = await caches.keys();
  const out = {};
  for (const n of names) out[n] = (await (await caches.open(n)).keys()).length;
  return out;
});
const staticCount = Object.entries(cached).find(([k]) => k.includes('static'))?.[1] || 0;
staticCount >= 20 ? ok(`service worker precached ${staticCount} app+vendor files`) : bad('precache too small: ' + JSON.stringify(cached));
const tileCount = Object.entries(cached).find(([k]) => k.includes('tiles'))?.[1] || 0;
tileCount > 0 ? ok(`cached ${tileCount} map tiles for offline use`) : bad('no map tiles cached');

await page.screenshot({ path: SHOT + '/verify-livemap.png' });
await page.click('#map-btn');
await new Promise(r => setTimeout(r, 2000));
await page.screenshot({ path: SHOT + '/verify-map.png' });
await page.click('#data-btn');
await new Promise(r => setTimeout(r, 1200));
await page.screenshot({ path: SHOT + '/verify-data.png' });

// --- clean up the verification project ---
await page.evaluate(async (id) => { await fetch(`/api/projects/${id}`, { method: 'DELETE' }); }, project.id);

const realErrors = consoleErrors.filter(e => !/favicon|ERR_INTERNET_DISCONNECTED/.test(e));
realErrors.length === 0 ? ok('no console errors') : bad('console errors: ' + realErrors.slice(0, 5).join(' | '));

await browser.close();
console.log(steps.join('\n'));
console.log(problems.length ? `\n${problems.length} PROBLEM(S)` : '\nALL CHECKS PASSED');
process.exit(problems.length ? 1 : 0);
