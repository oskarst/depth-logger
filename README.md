# Lake Logger

A phone-first PWA for logging lake depth soundings: tap a depth, it is stamped
with your GPS position, and the points build a depth map with contours.

```bash
npm install
npm start          # http://localhost:4567
npm test           # API + unit tests
npm run test:e2e   # headless browser checks, see test/e2e/README.md
```

## How data flows

Logging works with no signal, which is the whole point on a lake:

1. A tap on the pad writes the reading to **IndexedDB**, stamped with the
   current project id, and marks it unsynced.
2. **sync.js** pushes the queue to the server straight away, again whenever the
   network comes back, and every 30s while anything is still queued. Each
   reading carries a `clientId`, so a retry after a dropped response is ignored
   by the server rather than inserted twice.
3. The table and both maps read the server rows **and** whatever is still
   queued for the current project, so a point is visible the moment it is
   tapped.

The badge in the status row reads `All synced` or `N queued`. Nothing requires
pressing Sync by hand; Settings > Sync now is just a nudge.

## Water level

Projects carry a `waterLevelOffset`. The database always stores the raw
sounding; the offset is added when a depth is *displayed* (table, map colours,
contours, popups, legend, export). When it is non-zero the top bar shows an
`offset ±Xm` badge so an adjusted reading is never mistaken for a measured one.

Mark the shore with the Shore key when the water is at a known level. If the
shore later sounds 0.3m deep, set the offset to -0.3.

## Offline

`service-worker.js` precaches the app shell, every module and the vendored
Leaflet and turf builds, and keeps a bounded cache (600) of map tiles. A lake
you have already looked at still renders with no signal. Nothing is loaded from
a CDN.

## Layout

```
server.js        Express wiring
db.js            schema, migrations, prepared statements
routes/          projects, readings, fish endpoints
public/js/
  app.js         screens, wiring, startup
  store.js       IndexedDB queue (project-scoped)
  sync.js        pushes the queue, retries, idempotency
  api.js         every server call
  data.js        merges server + queued readings into one shape
  gps.js         watchPosition, permission, fix freshness
  pad.js         the depth keypad (shared by both screens)
  maps.js        depth map and live map
  maplayers.js   shared layer builders (TIN, contours, weeds, shore, fish)
  readings.js    data table and edit modal
  fish.js        fish catches
  projects.js    project screen, import
  waterlevel.js  offset modal
  depth.js       colour scale, accuracy threshold
  state.js       current project and screen
  events.js      tiny pub/sub so modules do not import each other
```

## Database

SQLite via better-sqlite3, migrated in `db.js` on boot (additive `ALTER TABLE`s,
safe to run against an existing file). `DB_PATH` overrides the location, which
is how the tests get a temp database.
