/**
 * JWT authentication helpers and middleware.
 */

import jwt from 'jsonwebtoken';

// In production, use an environment variable. For this prototype, a hardcoded secret is fine.
const JWT_SECRET = process.env.JWT_SECRET || 'dnd-crawler-secret-key-change-in-prod';
const TOKEN_EXPIRY = '7d';

/**
 * Generate a JWT for a user.
 * @param {{ id: number, username: string }} user
 * @returns {string}
 */
export function generateToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username },
    JWT_SECRET,
    { expiresIn: TOKEN_EXPIRY }
  );
}

/**
 * Express middleware – verifies the Authorization header and attaches `req.user`.
 */
/**
 * Verify a JWT token string and return the decoded payload.
 * Returns null if invalid/expired.
 */
export function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

/**
 * Express middleware – verifies the Authorization header and attaches `req.user`.
 */
export function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // "Bearer <token>"

  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded; // { id, username, iat, exp }
    next();
  } catch (err) {
    return res.status(403).json({ error: 'Invalid or expired token' });
  }
}
