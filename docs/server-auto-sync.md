# ECS Auto Sync Deployment

This document tracks the source-of-truth files for ECS auto-sync deployment.

## Purpose

After local code is pushed to GitHub `main`, ECS should automatically:

1. fetch latest `main`
2. sync app files into `/opt/anime-guess-arena/app`
3. rebuild and restart only `anime-web`
4. keep `cpa.accessxianhe.site` untouched

## Tracked Files

- `scripts/server-sync/deploy-from-github.sh`
- `scripts/server-sync/anime-sync-deploy.service`
- `scripts/server-sync/anime-sync-deploy.timer`
- `scripts/server-sync/install-on-ecs.sh`

## One-Time Install On ECS

Run on ECS host:

```bash
cd /opt/anime-guess-arena/app
sudo bash scripts/server-sync/install-on-ecs.sh
```

This installs:

- `/opt/anime-guess-arena/bin/deploy-from-github.sh`
- `/etc/systemd/system/anime-sync-deploy.service`
- `/etc/systemd/system/anime-sync-deploy.timer`

And enables timer:

- `anime-sync-deploy.timer` (every minute)

## Daily Usage

1. Local edit
2. Commit + Push to GitHub `main`
3. Wait ~1 minute (timer trigger)

Force immediate deploy:

```bash
ssh admin@43.108.13.133 "sudo systemctl start anime-sync-deploy.service"
```

## Verify

On ECS:

```bash
systemctl status anime-sync-deploy.timer --no-pager -l
journalctl -u anime-sync-deploy.service -n 120 --no-pager
```

Health checks:

```bash
curl -s -o /dev/null -w "anime:%{http_code}\n" https://anime.accessxianhe.site/api/health
curl -s -o /dev/null -w "cpa:%{http_code}\n" https://cpa.accessxianhe.site/management.html
```

Expected:

- `anime` eventually `200`
- `cpa` stays `200`

## Important Notes

- ECS sync uses GitHub as source of truth.
- Vercel deployment may still run independently if it remains connected.
- If you want a single production path, keep DNS for production domain pointed to ECS.
