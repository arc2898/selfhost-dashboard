require('dotenv').config();
const path = require('path');
const fs = require('fs');

function resolveList(str, fallback) {
  if (!str) return [fallback];
  return str.split(',').map(s => path.resolve(s.trim()));
}

const FILE_ROOT = path.resolve(process.env.FILE_ROOT || './data/files');
const MEDIA_DIRS = resolveList(process.env.MEDIA_DIRS, FILE_ROOT);

// Ensure required directories exist so a fresh checkout "just works"
for (const dir of [FILE_ROOT, path.join(__dirname, '..', 'data')]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

const config = {
  port: parseInt(process.env.PORT || '8443', 10),
  host: process.env.HOST || '0.0.0.0',
  jwtSecret: process.env.JWT_SECRET || 'INSECURE_DEV_SECRET_CHANGE_ME',
  fileRoot: FILE_ROOT,
  mediaDirs: MEDIA_DIRS,
  sessionHours: parseInt(process.env.SESSION_HOURS || '12', 10),
  cookieSecure: (process.env.COOKIE_SECURE || 'false').toLowerCase() === 'true',
  usersFile: path.join(__dirname, '..', 'data', 'users.json'),
  auditLogFile: path.join(__dirname, '..', 'data', 'audit.log'),
};

if (config.jwtSecret === 'INSECURE_DEV_SECRET_CHANGE_ME') {
  console.warn('[WARN] JWT_SECRET is not set in .env — using an insecure default. Set it before exposing this server.');
}

if (config.cookieSecure) {
  console.warn('[WARN] COOKIE_SECURE=true — the session cookie will only be stored/sent over HTTPS.');
  console.warn('[WARN] If you are opening this over plain http:// (e.g. http://localhost or a bare Tailscale IP),');
  console.warn('[WARN] the browser will silently discard the cookie and every login will bounce straight back');
  console.warn('[WARN] to the login page. Set COOKIE_SECURE=false in .env unless you have real HTTPS in front of this server.');
}

module.exports = config;
