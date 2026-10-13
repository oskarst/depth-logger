# Deploying

Production runs at **https://lake.dig.ge** on the dig.ge box (`46.101.198.32`),
behind Cloudflare.

## Shipping a change

```bash
git push origin main
ssh root@46.101.198.32
cd /var/www/lake.dig.ge/production/pub
git pull
npm ci --omit=dev          # only when package-lock.json changed
systemctl restart lake-logger
```

The service restarts in about a second. The database is untouched by a deploy —
it lives outside the checkout.

## What is installed where

| Piece | Location |
|---|---|
| Code | `/var/www/lake.dig.ge/production/pub` (clone of `oskarst/depth-logger`, `main`) |
| Database | `/var/lib/lake-logger/lake-logger.db` (owned by `www-data`) |
| Service | `/etc/systemd/system/lake-logger.service` — node on `127.0.0.1:4567` |
| Vhost | `/etc/nginx/sites-available/lake.dig.ge` — proxies to 4567, basic auth |
| Password file | `/etc/nginx/.htpasswd-lake.dig.ge` (user `oskars`) |
| TLS | certbot, auto-renewing; cert `lake.dig.ge` |

`DB_PATH` and `PORT` come from the unit file, which is why the database can sit
outside the checkout.

## Access

The site is behind HTTP basic auth, because the API can delete projects and
clear readings and has no accounts of its own. To change the password:

```bash
htpasswd /etc/nginx/.htpasswd-lake.dig.ge oskars
systemctl reload nginx
```

Basic auth is scoped to `location /` rather than the whole server block on
purpose: certbot's renewal challenge lands on its own location and must not
inherit the password prompt.

## Checks

```bash
systemctl status lake-logger
journalctl -u lake-logger -n 50
curl -u oskars:PASSWORD https://lake.dig.ge/api/projects
```

## Backups

Nothing automated yet. The database is a single file:

```bash
ssh root@46.101.198.32 'sqlite3 /var/lib/lake-logger/lake-logger.db ".backup /tmp/lake.db"'
scp root@46.101.198.32:/tmp/lake.db ./backup-$(date +%F).db
```
