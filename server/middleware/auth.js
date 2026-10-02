const cookie = require('cookie');
const { verifyToken } = require('../services/authService');

function requireAuth(req, res, next) {
  const token = req.cookies && req.cookies.session;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  const payload = verifyToken(token);
  if (!payload) return res.status(401).json({ error: 'Session expired' });
  req.user = payload;
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user || !req.user.isAdmin) return res.status(403).json({ error: 'Admin only' });
  next();
}

// Used to authenticate a WebSocket upgrade request using the same session cookie
function verifyWsRequest(request) {
  const cookies = cookie.parse(request.headers.cookie || '');
  const token = cookies.session;
  if (!token) return null;
  return verifyToken(token);
}

module.exports = { requireAuth, requireAdmin, verifyWsRequest };
