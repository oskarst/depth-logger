# End-to-end checks

These drive a real headless Chrome against a running server. They are not part
of `npm test` because they need a browser driver the app itself does not use.

```bash
npm i -D puppeteer     # one-off
npm start              # in another shell
npm run test:e2e
```

- `verify-app.mjs` — create a project, tap soundings on the pad, confirm they
  auto-sync, that the table, depth map and live map render, that the weeds tag
  sticks to an already-synced point, and that a water-level offset reaches the
  displayed depths.
- `verify-offline.mjs` — log with the network down, reload fully offline, check
  that one project's queued points stay out of another's, that Clear only
  empties the project you are in, and that the queue drains by itself on
  reconnect without duplicating anything.

Both drop screenshots next to themselves and exit non-zero on the first
problem.
