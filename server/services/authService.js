const fs = require('fs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const config = require('../config');

function loadUsers() {
  if (!fs.existsSync(config.usersFile)) return [];
  try {
    return JSON.parse(fs.readFileSync(config.usersFile, 'utf8'));
  } catch {
    return [];
  }
}

function saveUsers(users) {
  fs.writeFileSync(config.usersFile, JSON.stringify(users, null, 2));
}

function findUser(username) {
  return loadUsers().find(u => u.username.toLowerCase() === username.toLowerCase());
}

async function createUser(username, password, { isAdmin = true } = {}) {
  const users = loadUsers();
  if (users.some(u => u.username.toLowerCase() === username.toLowerCase())) {
    throw new Error('User already exists');
  }
  const passwordHash = await bcrypt.hash(password, 12);
  const user = { id: Date.now().toString(36), username, passwordHash, isAdmin, twoFactorSecret: null, createdAt: new Date().toISOString() };
  users.push(user);
  saveUsers(users);
  return user;
}

async function verifyPassword(username, password) {
  const user = findUser(username);
  if (!user) return null;
  const ok = await bcrypt.compare(password, user.passwordHash);
  return ok ? user : null;
}

function issueToken(user) {
  return jwt.sign(
    { sub: user.id, username: user.username, isAdmin: user.isAdmin },
    config.jwtSecret,
    { expiresIn: `${config.sessionHours}h` }
  );
}

function verifyToken(token) {
  try {
    return jwt.verify(token, config.jwtSecret);
  } catch {
    return null;
  }
}

function hasAnyUser() {
  return loadUsers().length > 0;
}

function audit(action, meta = {}) {
  const line = JSON.stringify({ ts: new Date().toISOString(), action, ...meta }) + '\n';
  fs.appendFile(config.auditLogFile, line, () => {});
}

module.exports = { findUser, createUser, verifyPassword, issueToken, verifyToken, hasAnyUser, audit, loadUsers, saveUsers };
