const express = require('express');
const rateLimit = require('express-rate-limit');
const { verifyPassword, issueToken, audit, hasAnyUser } = require('../services/authService');
const config = require('../config');

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Try again later.' },
});

router.get('/status', (req, res) => {
  res.json({ setupComplete: hasAnyUser() });
});

router.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required.' });
    }
    const user = await verifyPassword(username, password);
    if (!user) {
      audit('login_failed', { username, ip: req.ip });
      return res.status(401).json({ error: 'Invalid username or password.' });
    }
    const token = issueToken(user);
    res.cookie('session', token, {
      httpOnly: true,
      // 'lax' (not 'strict') because this is a plain top-level redirect after
      // login, not a cross-site request forgery vector - 'strict' has caused
      // the cookie to be dropped on that redirect in some browsers, which
      // then makes every authenticated call (including the WebSocket
      // upgrades) fail and bounce back to the login page.
      sameSite: 'lax',
      secure: config.cookieSecure,
      path: '/',
      maxAge: config.sessionHours * 60 * 60 * 1000,
    });
    audit('login_success', { username, ip: req.ip });
    res.json({ username: user.username, isAdmin: user.isAdmin });
  } catch (e) { next(e); }
});

router.post('/logout', (req, res) => {
  res.clearCookie('session');
  res.json({ ok: true });
});

router.get('/me', (req, res) => {
  res.json({ username: req.user.username, isAdmin: req.user.isAdmin });
});

module.exports = router;
