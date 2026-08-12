<div align="center">

# OPEN AUDIO

A minimalist music service with a dark monochrome look. Like SoundCloud, but
without the limits: uploads, downloads, and community-driven moderation.

</div>

## Features

- **Player with smooth animations** — monochrome UI, animated track transitions, queue, seek, volume.
- **Downloads** — Opus tracks download freely (`GET /api/tracks/:id/download`); lossless audio (FLAC/WAV/ALAC) is reserved for holders of the pink **Supporter** badge (with a heart) and the `owner`. The badge is granted by the `owner` via the admin panel or the CLI.
- **Auto-metadata** — on upload, the title, artist, duration, cover, and technical parameters (bitrate, sample rate, bit depth, codec, container, lossless) are extracted automatically from the file's metadata. Required fields are cover, artist, and title (taken from the form or the file tags).
- **Format policy** — only Opus (in Ogg/WebM/Matroska) and lossless audio (FLAC/WAV/ALAC) are accepted. Files are served as-is, with no transcoding.
- **Quality categories** — every track shows its quality (`kHz / bit / kbps`): **Hi-Res** (lossless, 24-bit, 44.1–192 kHz), **Hi-Fi / CD Quality** (lossless, 16-bit, 44.1+ kHz), and **Standard / HQ** (everything else).
- **Upload & moderation** — users upload tracks, they enter the queue, and a moderator verifies or rejects them (with a reason). A rejected track can be resubmitted for review.
- **Track statuses** — `verified` (white check), `suspended` (warning sign — playback temporarily disabled), `pending`, `rejected`. Deleted tracks are removed from the database entirely.
- **Notification center** — the uploader is notified of any track status change (verified, rejected, suspended, unsuspended, deleted). Bell icon with a counter in the header, page at `/notifications`.
- **Roles** — `owner` (full rights: track deletion, approval of delete requests, role assignment), `admin` (moderator: verify/reject/suspend, ban, track-delete requests), and `user`.
- **Supporter badge** — a pink heart badge next to the username (shown in the profile) for people who support the project; unlocks lossless track downloads. Only the `owner` can grant it (the **Users** tab of the admin panel or `npm run admin user <id> supporter on`).
- **Delete requests** — a moderator does not delete a track themselves but sends a delete request with a reason; the final deletion is confirmed by the `owner` (the **Delete requests** tab of the admin panel).
- **Admin panel** — moderation (verify/reject/suspend/unsuspend/delete for owner, request-delete for admin), user management (ban/role — role changes are owner-only), platform statistics.
- **Admin CLI** — `npm run admin <entity> [id] <action>`: server status, JWT_SECRET rotation, user and track management, audio-metadata scanning, backup/restore, VACUUM, orphan-file cleanup, audit log.
- **Security** — helmet headers, rate limiting + brute-force protection, file-content validation via magic bytes, path-traversal guards, httpOnly/secure cookies, admin audit log.
- **Feed, search, likes, library** — public feed, search across tracks and artists, likes and play counters.
- **No external databases** — SQLite through the built-in `node:sqlite` (Node ≥ 22.5, Node 24+ recommended), zero native dependencies.

## Stack

- **Frontend:** React 19, Vite, Tailwind CSS 4, motion (animations), react-router, lucide-react.
- **Backend:** Express, TypeScript (run via `tsx`), `node:sqlite`, JWT in an httpOnly cookie, `multer` for file uploads, scrypt for passwords.

## Quick start

Requires **Node.js 22.5+** (Node 24+ recommended).

```bash
# 1. Install: dependencies, .env, database, admin account
npm run setup

# 2. Development: frontend on :3000 + API on :4000 (Vite proxies /api)
npm run dev

# 3. Production: build + single server on :4000 (SPA + API + files)
npm run build
npm start
```

Open `http://localhost:3000` (dev) or `http://localhost:4000` (prod).

During `npm run setup` the owner account is created. If `OWNER_USERNAME` /
`OWNER_PASSWORD` / `OWNER_EMAIL` are set in `.env`, the script runs without
questions; otherwise it prompts interactively. The legacy `ADMIN_USERNAME` /
`ADMIN_PASSWORD` names are accepted as fallbacks. Re-running `npm run setup`
does **not** reset the password unless a new one is provided.

### Default credentials

After the first `npm run setup`, the console prints the owner's login/password
and the removal key. Example `.env` (already produced by the script):

```
PORT=4000
DATABASE_PATH=./data/open-audio.db
UPLOAD_DIR=./uploads
JWT_SECRET=<generated automatically>
REMOVAL_KEY=<generated automatically>
OWNER_USERNAME=owner
OWNER_PASSWORD=TestPass123
OWNER_EMAIL=owner@example.com
```

## Quick install on a Linux server

Run Open Audio on a single Linux host (Ubuntu/Debian). Requires **Node.js 22.5+**
(Node 24+ recommended) and `git`; Docker is optional.

### 1. Download the project

```bash
git clone https://github.com/SparkleSavvy/Open-Audio.git
cd Open-Audio
```

### 2a. Install with the `open-audio` utility (recommended)

The bundled `open-audio` bash script manages the whole lifecycle (dependencies,
`.env`, systemd service, backups). Install it system-wide, then provision and
start the service:

```bash
chmod +x open-audio
sudo ./open-audio self-install            # symlink -> /usr/local/bin/open-audio
sudo open-audio install --service         # deps + owner account + systemd unit
sudo open-audio config set JWT_SECRET "$(openssl rand -hex 32)"
sudo open-audio config set REMOVAL_KEY "$(openssl rand -base64 24)"
sudo open-audio config set OWNER_PASSWORD "change-me"
sudo open-audio start
sudo open-audio status                    # mode, port, health
```

The server listens on `:4000`. Put a reverse proxy (nginx/Caddy) in front for
HTTPS and set `COOKIE_SECURE=1` / `TRUST_PROXY=1` via
`sudo open-audio config set ...`.

### 2b. Install with npm

```bash
npm install
npm run setup                             # .env + SQLite DB + owner account
# edit .env: set JWT_SECRET, REMOVAL_KEY, OWNER_PASSWORD, NODE_ENV=production
npm run build
npm start                                 # single server on :4000 (SPA + API + files)
```

`npm run setup` creates `.env` from `.env.example` and prints the owner
credentials and removal key. Rotate them later with `npm run admin secret` /
`npm run admin removal-key`.

### 3. Open it

Point a browser (or your reverse proxy) at `http://<server>:4000`. The service
starts empty — upload a track via `/upload` and verify it in the `/admin`
**Moderation** tab.

## How moderation works

1. A user registers and uploads a track (`/upload`) — title, artist, duration, and cover are filled from the file's metadata automatically (they can be overridden); the track gets the `pending` status.
2. The status is visible on the "My uploads" page (`/me`): **Pending review / Verified / Suspended / Rejected**.
3. A moderator opens `/admin` → the **Moderation** tab: previews the track and picks an action:
   - **Verify** — publishes the track (status `verified`, white check appears in the UI).
   - **Reject** — rejection with a reason (the user sees it and can press **Resubmit**).
   - **Suspend** — temporarily disables playback and download (warning sign instead of the check); **Unsuspend** restores the track.
   - **Delete** (owner only) — permanent removal from the database (track and files).
   - **Request delete** (admin only) — a delete request with a reason; it lands in the **Delete requests** tab, where the owner confirms or rejects it.
4. A verified track appears in the feed and search and is available for download; a suspended track stays in the feed but does not play. Lossless (FLAC) downloads are available to Supporters and the `owner` only.
5. On **any status change** the uploader gets a notification in the notification center (bell in the header, page `/notifications`).

## Admin CLI

Administration utilities are invoked with `npm run admin <entity> [id] <action>`
(English output). All actions are recorded in the `admin_log` table.

```bash
# Accounts
npm run admin account owner [username]      # create or reset the owner account
npm run admin account admin [username]      # create or reset a moderator account
npm run admin secret                        # rotate JWT_SECRET in .env (invalidates all sessions)

# Users
npm run admin users                         # list users
npm run admin user <id|username>            # show a user
npm run admin user <id> ban|unban           # ban / unban a user
npm run admin user <id> promote|demote      # change a user's role (owner cannot be changed here)
npm run admin user <id> supporter [on|off]  # grant / revoke the Supporter badge (unlocks FLAC downloads)
npm run admin user <id> password [pw]       # reset a password (prompts if omitted)

# Tracks
npm run admin tracks [status]               # list tracks by status (pending|verified|suspended|rejected|all)
npm run admin track <id>                    # show a track (quality + category)
npm run admin track <id> verify             # publish
npm run admin track <id> suspend|unsuspend  # enable / disable playback
npm run admin track <id> reject <reason>    # reject with a reason
npm run admin track <id> resubmit           # send a rejected track back to the queue
npm run admin track <id> delete             # permanently delete

# Maintenance
npm run admin scan [--all]                  # backfill track metadata from files
npm run admin backup [dir]                  # snapshot DB (VACUUM INTO) + copy uploads into a folder
npm run admin restore <backup-dir> --force  # restore from a snapshot folder
npm run admin vacuum                        # integrity_check + VACUUM
npm run admin prune [--delete]              # report (or remove) orphaned files
npm run admin purge-inactive [months]       # list accounts inactive for > months (default: 19)
npm run admin purge-inactive <m> --delete   # permanently delete them (owner/admins/supporters protected)
npm run admin notify <id|username> <msg>    # send a manual notification

# Server
npm run admin status                        # server state, owner/moderation, statistics
npm run admin removal-key                   # generate / rotate REMOVAL_KEY in .env
npm run admin remove-server [reason]        # request a full server removal (confirmed by the owner)
```

The older spellings `npm run admin owner|admin|pending` still work as aliases.

`purge-inactive` removes accounts whose last activity (logins, page views,
plays, comments, likes) is older than the given number of months. Activity is
tracked automatically per user. Owner accounts are always excluded; admins and
supporters are excluded unless you pass `--include-admins` /
`--include-supporters`. The user's tracks are kept (they become ownerless),
while their likes, comments, reposts, follows and notifications are removed.
`--delete` is required to actually delete — without it the command only lists
candidates.

## Notifications

The uploader receives notifications about events: track verified, rejected
(with a reason), suspended, unsuspended or deleted by a moderator, a comment on
a track, a message from an admin. A notification stores a snapshot of the track
title — it stays in history even after the track is deleted. Unread items are
highlighted, and the header counter refreshes every 30 seconds.

## Security

- **JWT_SECRET** — in production the server refuses to start with a weak/default secret (`npm run admin secret`).
- **helmet** — standard security headers; a strict CSP is enabled via `HELMET_CSP=1`.
- **Rate limiting** — per-IP limit for all `/api` requests (300 / 15 min) and a stricter one for `/api/auth` (20 / 15 min).
- **Brute-force protection** — after 5 failed logins the key (IP + username) is locked with an exponential delay.
- **Uploads** — mimetype and file content are checked via magic bytes (OPUS/OGG/WebM/FLAC/WAV/M4A, JPEG/PNG/WebP/GIF); HTML/scripts disguised as media are rejected. Upload formats are restricted by policy: Opus and lossless only.
- **Path traversal** — files referenced by `audio_url`/`cover_url` are read and deleted only inside the `UPLOAD_DIR` root via `resolveInside`.
- **Cookie** — `httpOnly`, `sameSite=lax`, `priority=high`, `secure` in production.
- **Ban** — the cookie of a logged-in banned user is forcefully cleared.
- **Audit** — every admin action (API and CLI) is written to `admin_log`; view via `GET /api/admin/audit`.

## Scripts

| Command          | Action                                              |
| ---------------- | --------------------------------------------------- |
| `npm run setup`  | Install: env, database, admin account               |
| `npm run admin`  | Admin CLI (see above)                               |
| `npm run dev`    | Run API (:4000) + Vite (:3000) in parallel          |
| `npm run build`  | Production frontend build into `dist/`              |
| `npm start`      | Production server (SPA + API + files) on :4000      |
| `npm run lint`   | TypeScript type-checking                            |
| `npm run clean`  | Full cleanup (`dist`, `data`, `uploads`, `.env`)    |

## Starting empty

The service starts empty: the feed, search, and library have no tracks. Tracks
appear only through requests — a user uploads a file (`/upload`), it enters the
`pending` queue, and an admin confirms it in the **Moderation** tab on `/admin`.

## Structure

```
server/               Express backend
  routes/auth.ts      register / login / me (rate limit + brute-force protection)
  routes/tracks.ts    feed, search, details, likes, download, deletion
  routes/upload.ts    file uploads (multer) + magic bytes + metadata → pending
  routes/admin.ts     moderation, users, statistics, audit
  routes/notifications.ts  notification center
  admin.ts            admin domain logic (shared by API and CLI)
  security.ts         rate limiter, brute-force, magic bytes, resolveInside
  audit.ts            audit log (admin_log)
  notify.ts           notification helper
  db.ts               SQLite schema (node:sqlite) + migrations
  seed.ts             owner/admin accounts (upsert, no password reset)
src/                  React frontend
  pages/              Home, Library, Search, Upload, MyUploads, Track, Notifications, Auth, Admin, UserProfile
  components/         Header, Player, Toast, TrackCard, TrackListRow, StatusBadge, SupporterBadge, UploadForm, ...
  lib/                api client, AuthContext, NotificationsContext, PlayerContext
scripts/setup.ts      setup script
scripts/admin.ts      Admin CLI
```

## Deployment

The app is a single Node process that serves the built SPA **and** the API from
one port (`:4000`). State is two things on disk:

- the SQLite database (`DATABASE_PATH`, WAL mode) — **one writer only**;
- uploaded media (`UPLOAD_DIR`).

Both must live on a persistent volume. A `GET /api/health` endpoint is provided
for container probes.

> **Scale = 1 by default.** SQLite WAL and the in-memory rate limiter / brute-force
> lockout are not shared across replicas. Run a single replica backed by a
> `ReadWriteOnce` volume. To scale horizontally you must replace `node:sqlite`
> with Postgres and the in-memory limiter with a shared store (Redis). See
> [Scaling](#scaling) below.

### Required environment

| Variable         | Notes                                                          |
| ---------------- | ------------------------------------------------------------- |
| `NODE_ENV`       | set to `production` (refuses a weak `JWT_SECRET` otherwise)    |
| `JWT_SECRET`     | ≥16 chars; shared by **all** replicas; rotates all sessions   |
| `REMOVAL_KEY`    | required to wipe the server; generate with `openssl rand`     |
| `DATABASE_PATH`  | inside the persistent volume (e.g. `/data/open-audio.db`)     |
| `UPLOAD_DIR`     | inside the persistent volume (e.g. `/data/uploads`)           |
| `COOKIE_SECURE`  | `1` behind HTTPS                                               |
| `TRUST_PROXY`    | `1` behind a load balancer / Ingress                           |
| `HELMET_CSP`     | `1` to enable the strict CSP + HSTS                            |
| `OWNER_*`        | owner account created/updated idempotently on first boot      |

In Docker/Kubernetes these values win over any persisted file, so every pod uses
the same `JWT_SECRET` and `REMOVAL_KEY` (config in `scripts/setup.ts`).

### Docker (single host)

```bash
cp .env.example .env
# set JWT_SECRET, REMOVAL_KEY, OWNER_PASSWORD in .env
docker compose up -d --build
# → http://localhost:4000
```

The `sparkle-data` volume holds the DB and uploads. The image builds on
`node:24` (required for stable `node:sqlite`).

### Kubernetes

Manifests live in `k8s/` (`namespace`, `configmap`, `secret`, `pvc`,
`deployment`, `service`, `ingress`). Secret values are not committed — create
the Secret first:

```bash
kubectl apply -f k8s/namespace.yaml

kubectl -n sparkle-audio create secret generic sparkle-audio \
  --from-literal=JWT_SECRET=$(openssl rand -hex 32) \
  --from-literal=REMOVAL_KEY=$(openssl rand -base64 24) \
  --from-literal=OWNER_PASSWORD=$(openssl rand -base64 18) \
  --from-literal=OWNER_EMAIL=owner@example.com

# Edit k8s/configmap.yaml (APP_URL, OWNER_USERNAME) and k8s/ingress.yaml (host,
# TLS) for your domain, then:
kubectl apply -f k8s/ -n sparkle-audio
```

The Deployment runs **one replica** with a `ReadWriteOnce` PVC, health probes
on `/api/health`, and a hardened security context. The nginx Ingress raises the
upload body limit to 64 MB (tracks can be up to 60 MB). The container runs the
`scripts/docker-entrypoint.mjs` entrypoint, which runs `npm run setup`
(non-interactively, from env) and then starts the server.

### Scaling

Horizontal scaling is **not** supported as-is:

- **Database** — SQLite allows only one writer. Move to Postgres
  (`DATABASE_PATH` is the only DB knob today; a SQL-driver swap is needed).
- **Uploads** — files are written to local disk. Either keep a single replica,
  or mount a shared (non-NFS-locked) volume and ensure sticky sessions.
- **Rate limiting / brute-force** — the limiter is an in-memory `Map`. Behind
  multiple pods each pod counts independently, so limits are per-pod, not
  per-client. Replace with a shared store (Redis) for true global limits.

Until then, run `replicas: 1` and scale the node vertically.

## Management utility (`open-audio`)

A system-level bash utility for managing the project's lifecycle on Linux
(complementing the app-level `npm run setup` / `npm run admin`). It handles the
service/process, volumes, env, and status for both deployment modes.

```bash
./open-audio <command> [options]
```

| Command                     | Action                                                        |
| --------------------------- | ------------------------------------------------------------- |
| `install [--service]`       | install deps/owner (native) or build+run image (docker); `--service` installs a systemd unit |
| `start` / `stop` / `restart` | control the running instance                                |
| `status`                    | mode, port, data dir, running state, health                   |
| `health`                    | probe `GET /api/health`                                       |
| `logs [-f]`                 | show logs (journalctl for systemd, `docker logs`, or file)    |
| `config list\|get\|set\|edit\|secret\|removal-key` | manage `.env` (secrets are masked); `set`/`secret`/`removal-key` restart automatically |
| `update`                    | pull + reinstall/rebuild + restart                            |
| `backup [dir]` / `restore <dir>` | DB + uploads snapshot via the admin CLI                 |
| `admin <args…>`             | pass-through to `npm run admin`                               |
| `uninstall [--purge]`       | stop + remove service/container; `--purge` also wipes data    |
| `remove [--yes] [reason]`   | trigger the app's full server-removal flow (confirm in UI)    |
| `mode <native\|docker>`     | switch deployment mode (persisted)                            |
| `self-install`              | symlink to `/usr/local/bin/open-audio`                        |
| `version` / `help`          | version / usage                                              |

The utility remembers its mode in `.open-audio-state`. `config secret` rotates
`JWT_SECRET` and **invalidates all sessions and TOTP secrets** (they are
encrypted with the old key) — see the Security notes.

> Native mode runs the server as `node node_modules/.bin/tsx server/index.ts`
> (equivalent to `npm start`) via `nohup` or a systemd unit. Docker mode builds
> the local `open-audio:latest` image and runs it with a `/data` volume.

