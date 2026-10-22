const { audit } = require('../services/authService');

// Maps internal errors to safe, user-friendly messages. Never sends raw
// stack traces, file-system paths, or driver error strings to the client.
module.exports = function errorHandler(err, req, res, _next) {
  let status = 500;
  let message = 'Something went wrong on the server.';

  if (err.code === 'LIMIT_FILE_SIZE') {
    status = 413;
    message = 'The uploaded file exceeds the 2 GiB limit.';
  } else if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_PART_COUNT' || err.code === 'LIMIT_FIELD_COUNT') {
    status = 400;
    message = 'The upload contains too many files or fields.';
  } else if (err.code === 'EACCESS_PATH') {
    status = 403;
    message = 'Access to that location is not permitted.';
  } else if (err.code === 'ENOENT') {
    status = 404;
    message = 'File or folder not found.';
  } else if (err.code === 'EACCES' || err.code === 'EPERM') {
    status = 403;
    message = 'Permission denied.';
  } else if (err.code === 'ENOSPC') {
    status = 507;
    message = 'The disk is full.';
  } else if (err.status) {
    status = err.status;
    message = err.publicMessage || err.message;
  }

  audit('error', { path: req.originalUrl, status, message: err.message });
  console.error(`[error] ${req.method} ${req.originalUrl}:`, err.message);
  res.status(status).json({ error: message });
};
