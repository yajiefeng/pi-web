# Tokyo pi-web Workflow

This fork is the Tokyo VPS working copy for `home.voiduplink.com`.

## Repositories

- `origin`: `git@github.com:yajiefeng/pi-web.git`
- `upstream`: `git@github.com:agegr/pi-web.git`

Keep local changes in this fork and periodically pull upstream changes from `agegr/pi-web`.

## Source Locations

Primary editing copy on the Tokyo VPS:

```text
/srv/codex-workspaces/pi-web
```

Local Mac mirror:

```text
/Users/fengyajie/github/pi-web
```

The VPS clone runs as `codex-agent` and uses a repo-scoped GitHub deploy key with write access to `yajiefeng/pi-web`. Do not place personal GitHub keys on the VPS.

## Local Development

On the VPS:

```bash
ssh dmit-tyo-tiny
cd /srv/codex-workspaces/pi-web
git status
git add .
git commit -m "..."
git push origin main
```

On the Mac:

```bash
npm ci
npm run dev
```

Open `http://localhost:30141`.

Useful checks:

```bash
node_modules/.bin/tsc --noEmit
npm run lint
```

## Deploy To Tokyo

The deployed service is:

- SSH target: `dmit-tyo-tiny`
- systemd: `tokyo-pi-web.service`
- package path: `/opt/pi-web/node_modules/@agegr/pi-web`
- public URL: `https://home.voiduplink.com/`
- local service URL on VPS: `http://127.0.0.1:30141/`

Deploy from the Mac mirror after pulling the latest GitHub changes:

```bash
cd /Users/fengyajie/github/pi-web
git pull --ff-only origin main
scripts/deploy-tokyo.sh
```

Deploy the committed local working tree:

```bash
scripts/deploy-tokyo.sh
```

The script builds locally, packages tracked source files plus `.next`, uploads them to the VPS, backs up the current package under `/opt/pi-web-releases/`, restarts `tokyo-pi-web.service`, and checks `http://127.0.0.1:30141/`.

For a quick dirty test:

```bash
PI_WEB_ALLOW_DIRTY=1 scripts/deploy-tokyo.sh
```

Use dirty deploy sparingly. The normal loop should be:

1. Edit on the VPS repo.
2. Commit and push from the VPS.
3. Pull the Mac mirror.
4. Build and deploy from the Mac mirror.

The deploy build currently runs on the Mac because the Tokyo VPS is a 1 GB machine and full npm installs/builds are expensive there. Revisit this if we add a lighter VPS-native build path.

## Rollback

The deploy script prints the backup path, for example:

```text
/opt/pi-web-releases/backup-20260703T003000Z
```

Manual rollback on the VPS:

```bash
ssh dmit-tyo-tiny
rm -rf /opt/pi-web/node_modules/@agegr/pi-web
cp -a /opt/pi-web-releases/backup-YYYYMMDDTHHMMSSZ /opt/pi-web/node_modules/@agegr/pi-web
chown -R codex-agent:codex-agent /opt/pi-web/node_modules/@agegr/pi-web
systemctl restart tokyo-pi-web.service
```

## Sync Upstream

```bash
git fetch upstream
git merge upstream/main
npm ci
npm run lint
node_modules/.bin/tsc --noEmit
```

Resolve conflicts in the fork, then commit and deploy as usual.

## Secrets

Do not commit VPS secrets, Basic Auth passwords, Pi auth files, Codex credentials, `.env*`, or session transcripts. The Tokyo service reads Pi auth and sessions from the VPS at runtime.
