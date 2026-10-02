# Self-Hosted Server Dashboard

A private server control panel: real-time system monitor, full file manager,
media center, and a browser-based terminal — behind authentication, meant to
be reached over your Tailscale network.

## 1. Architecture

**Stack:** Node.js/Express (backend) + vanilla HTML/CSS/JS (frontend, no build
step). Chosen so it runs identically on Windows (dev/test) and Linux
(deployment) with zero compiled frontend tooling — `npm install && npm start`
is the whole workflow on either OS.

```
selfhost-dashboard/
├── server/
│   ├── index.js              Express app, HTTP server, WS upgrade routing
│   ├── config.js             Loads .env, resolves FILE_ROOT/MEDIA_DIRS
│   ├── setup.js              One-time CLI to create the first admin user
│   ├── middleware/
│   │   ├── auth.js           requireAuth / requireAdmin / WS cookie auth
│   │   ├── security.js       safeResolve() — the path-traversal firewall
│   │   └── errorHandler.js   Converts internal errors to safe messages
│   ├── routes/
│   │   ├── auth.js           /api/auth/*
│   │   ├── system.js         /api/system/*
│   │   ├── files.js          /api/files/*
│   │   └── media.js          /api/media/*
│   ├── services/
│   │   ├── authService.js    User store (data/users.json), JWT, audit log
│   │   ├── systemMonitor.js  Wraps `systeminformation` for CPU/mem/disk/net
│   │   ├── fileService.js    All file CRUD, zip/unzip, safe path resolution
│   │   └── terminalService.js Spawns real PTY shells via `node-pty`
│   └── ws/
│       ├── systemSocket.js   Broadcasts live stats every 2s to all clients
│       └── terminalSocket.js Bridges an xterm.js session to a PTY
├── public/                   Static frontend (served directly by Express)
│   ├── index.html / login.html
│   ├── css/style.css
│   └── js/{app,dashboard,monitor,files,media,terminal}.js
└── data/                     Created at runtime: users.json, audit.log, files/
```

**Why this split:** every filesystem and process action funnels through
`fileService.js` / `systemMonitor.js`, which are the only modules that touch
the OS. Routes stay thin (validate → call service → respond), so the security
boundary (path traversal, auth) lives in exactly one place
(`middleware/security.js` and `middleware/auth.js`) instead of being
re-implemented per route.

### Authentication & security model
- Username/password, `bcryptjs`-hashed, stored in `data/users.json` (created
  by `npm run setup` — nothing ships with a default password).
- Session = JWT in an `httpOnly`, `SameSite=Strict` cookie. No token ever
  touches `localStorage` or client JS.
- The same cookie authenticates WebSocket upgrades (`server/index.js` verifies
  it in the `upgrade` handler before a socket is ever accepted).
- `express-rate-limit` on `/api/auth/login` (10 attempts / 15 min) and on the
  whole `/api` surface (300 req/min) as a blanket throttle.
- `helmet` for standard security headers.
- **Path traversal:** `safeResolve()` resolves every user-supplied path
  against `FILE_ROOT` and throws if the result would land outside it —
  applied to every single file operation, including uploads, zip, and the
  raw/stream endpoints used by the media player. There's no code path where a
  browser-supplied path reaches `fs` without going through it first.
- **Terminal:** runs as whatever OS user started the Node process — it is not
  a separate unauthenticated shell service. There is no `sudo` elevation and
  no root-required setup baked in; if you want the terminal to have broader
  permissions, run the whole Node process as that user (with the risk that
  implies).
- **Audit log:** `data/audit.log` — append-only, one JSON line per login,
  upload, delete, rename, process kill, terminal open/close, etc.
- **2FA:** the user record already has a `twoFactorSecret` field reserved so
  TOTP can be added later without a schema change; it is not wired up yet.

### API reference (all under `/api`, all require the `session` cookie except `/auth/*`)

| Method & Path | Purpose |
|---|---|
| `GET /auth/status` | Whether initial setup has been run |
| `POST /auth/login` | `{username, password}` → sets session cookie |
| `POST /auth/logout` | Clears session cookie |
| `GET /auth/me` | Current user |
| `GET /system/overview` | Full stats snapshot (also pushed via WS) |
| `GET /system/network` | Per-interface network detail |
| `GET /system/processes` | Live process table |
| `POST /system/processes/:pid/kill` | `{signal?}`, terminates a process |
| `GET /system/identity` | Hostname, local IP, detected Tailscale IP |
| `GET /files/list?path=&hidden=&sortBy=&order=` | Directory listing |
| `GET /files/search?path=&q=` | Recursive name search |
| `POST /files/mkdir` | `{path, name}` |
| `POST /files/create-file` | `{path, name}` |
| `POST /files/rename` | `{path, newName}` |
| `POST /files/delete` | `{paths: []}` |
| `POST /files/copy` / `/files/move` | `{paths: [], destination}` |
| `POST /files/duplicate` | `{path}` |
| `GET/PUT /files/content` | Read/write a text file (editor) |
| `GET /files/download` | Single-file download |
| `GET /files/download-zip?paths=&name=` | Zip one or more paths on the fly |
| `POST /files/extract` | `{path, destination}` — unzip |
| `POST /files/upload?path=` | `multipart/form-data`, field `files` |
| `GET /files/raw?path=` | Byte stream with HTTP Range support |
| `GET /media/library` | Scanned media, grouped by type |
| `GET /media/stream?dir=&path=` | Ranged media byte stream |

### WebSocket events

- `wss://host/ws/system` — server → client only, `{type:'stats', data:{...}}` every 2s.
- `wss://host/ws/terminal` — bidirectional:
  - client → server: `{type:'input', data}`, `{type:'resize', cols, rows}`
  - server → client: `{type:'output', data}`, `{type:'exit', code}`, `{type:'error', message}`

---

## 2. Setup — test on Windows

### One-run option
Double-click **`start.bat`** (or run it from a terminal). On first run it
installs dependencies, copies `.env.example` → `.env`, prompts you to create
an admin account, and starts the server. Re-running it later just starts the
server — it skips steps that are already done.

### Manual, step-by-step (equivalent to what start.bat does)
1. Install [Node.js 18+](https://nodejs.org) (LTS).
2. Unzip the project, then in that folder:
   ```powershell
   npm install
   ```
   `node-pty` compiles a native module. If it fails on Windows, install the
   **"Desktop development with C++"** workload from Visual Studio Build
   Tools, then re-run `npm install`. (If you don't need the terminal feature
   for local testing, everything else works fine even if `node-pty` fails —
   the app degrades gracefully and shows an error only when you open the
   Terminal tab; the server also prints a warning about this on startup.)
3. Copy the environment template:
   ```powershell
   copy .env.example .env
   ```
   For local Windows testing, `FILE_ROOT` can point anywhere you like, e.g.
   `FILE_ROOT=C:\Users\you\Desktop\dashboard-files`. Leave `COOKIE_SECURE=false`
   — it must stay `false` unless you're actually serving over HTTPS, or every
   login will silently fail to persist (see Troubleshooting below).
4. Create your admin account:
   ```powershell
   npm run setup
   ```
5. Start it:
   ```powershell
   npm start
   ```
6. Open `http://localhost:8443` in your browser and sign in.

On Windows the terminal tab opens `powershell.exe`; on Linux it opens `$SHELL`
(bash by default).

---

## 3. Deploy — on Linux (the real target)

### One-run option
```bash
./start.sh
```
Same behavior as `start.bat` above: installs dependencies, creates `.env` on
first run, prompts for an admin account if none exists, then starts the
server. Safe to re-run any time.

### Manual, step-by-step
1. Copy the project to the server, e.g. `/opt/selfhost-dashboard`.
2. Install Node 18+ (via your distro's package manager or [nvm](https://github.com/nvm-sh/nvm)).
3. `npm install --omit=dev` (installing `node-pty` needs `make`, `g++`,
   `python3` — on Debian/Ubuntu: `sudo apt install build-essential python3`).
4. `cp .env.example .env` and edit:
   - `HOST=0.0.0.0` so it's reachable from your Tailscale interface.
   - `FILE_ROOT=/path/you/want/exposed` — pick deliberately; everything under
     it is reachable to anyone who can log in.
   - `JWT_SECRET=` — generate one: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`.
   - Leave `COOKIE_SECURE=false` until you have real HTTPS in front of the
     server (see step 6/Tailscale Serve below) — flipping it early is the
     single most common cause of "login redirects back to login."
5. `npm run setup` to create the admin account, then `npm start` to test it
   manually — confirm `http://<tailscale-ip>:8443` loads from another device
   on your tailnet. The server prints the exact URL it's listening on at startup.
6. Run it persistently. Simplest option, `systemd`:
   ```ini
   # /etc/systemd/system/dashboard.service
   [Unit]
   Description=Self-Hosted Dashboard
   After=network.target

   [Service]
   Type=simple
   User=youruser
   WorkingDirectory=/opt/selfhost-dashboard
   ExecStart=/usr/bin/node server/index.js
   Restart=on-failure
   EnvironmentFile=/opt/selfhost-dashboard/.env

   [Install]
   WantedBy=multi-user.target
   ```
   ```bash
   sudo systemctl enable --now dashboard
   ```

---

## 4. Access it over Tailscale

- Install Tailscale on the server and on the device you'll use to connect,
  and join both to the same tailnet.
- Find the server's Tailscale IP with `tailscale ip -4` on the server (the
  Dashboard's own header also detects and displays it automatically).
- From any device on the tailnet: `http://<tailscale-ip>:8443`.
- For a real domain + HTTPS instead of a bare IP:port, use
  [Tailscale Serve or Funnel](https://tailscale.com/kb/1242/tailscale-serve)
  (`tailscale serve https / http://localhost:8443`) — this also gets you a
  trusted TLS cert for free on your tailnet's `*.ts.net` domain. Once you're
  serving over HTTPS this way, set `COOKIE_SECURE=true` in `.env`.
- If you'd rather use plain port forwarding instead of Tailscale, put this
  behind a reverse proxy (nginx/Caddy) with TLS — don't expose port 8443
  directly to the public internet without HTTPS in front of it, since the
  login form submits credentials there.

---

## 5. Troubleshooting

**Login succeeds but immediately bounces back to the login page**, or the
dashboard's cards/charts stay stuck on their loading skeleton, or the System
Monitor updates for a bit and then stops: in every case this was a session
cookie failing to persist, most commonly because `COOKIE_SECURE=true` is set
in `.env` while the app is being accessed over plain `http://` (not real
HTTPS). The browser silently discards a `Secure` cookie on a non-HTTPS
connection, so the login *looks* successful (you get a 200 back) but nothing
you do afterwards is actually authenticated. Fix: set `COOKIE_SECURE=false`
unless this server is genuinely behind HTTPS (e.g. via Tailscale Serve). The
server now also prints a warning at startup if this flag is on, and the login
page itself will tell you plainly if the session didn't take instead of just
silently redirecting you in a circle.

**Port already in use on startup:** the server checks this before binding and
tells you which port — change `PORT` in `.env` or stop whatever else is using it.

**"Missing dependencies" on startup:** run `npm install` (or just use
`start.sh` / `start.bat`, which do this automatically before every run).

---

## 6. Notes & honest limitations

- **MKV/HEVC playback** depends on the visiting browser's codec support, not
  the server — Chrome/Edge play MKV containers with H.264 fine but not all
  codecs inside them; there's no server-side transcoding built in yet.
- **Subtitle support** is via `<track>` if you place a matching `.vtt` file
  next to the video and reference it — there's no automatic subtitle
  discovery/muxing yet.
- **Quality selection** for video isn't implemented (no transcode pipeline);
  the player streams the source file as-is with range support for seeking.
- **2FA** has a reserved field but isn't wired into the login flow yet.
- The process list's "End process" respects OS permissions — killing a
  process owned by another user (or root, if you're not root) will correctly
  fail with a permission error rather than silently doing nothing.
