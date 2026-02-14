import jwt from "jsonwebtoken";

const ACCESS_EXPIRES = process.env.ACCESS_TOKEN_EXPIRES || "1h"; // was 15m; 1h reduces logout-after-idle
const REFRESH_EXPIRES_DAYS = Number(process.env.REFRESH_TOKEN_EXPIRES_DAYS) || 30;
const REFRESH_COOKIE_NAME = "refreshToken";

function getRefreshExpiresIn() {
  return `${REFRESH_EXPIRES_DAYS}d`;
}

function getRefreshMaxAgeMs() {
  return REFRESH_EXPIRES_DAYS * 24 * 60 * 60 * 1000;
}

/**
 * Build payload for access/refresh (same shape for verification).
 */
export function buildTokenPayload(user) {
  return {
    userId: user.id,
    role: user.role_id,
    is_verified: user.email_verified,
    username: user.username,
    is_deleted: user.is_deleted,
    is_two_factor_enabled: user.is_two_factor_enabled,
  };
}

/**
 * Issue short-lived access token (15m).
 */
export function issueAccessToken(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: ACCESS_EXPIRES });
}

/**
 * Issue long-lived refresh token (default 30d). Uses REFRESH_TOKEN_SECRET.
 */
export function issueRefreshToken(payload) {
  const secret = process.env.REFRESH_TOKEN_SECRET || process.env.JWT_SECRET;
  return jwt.sign(payload, secret, { expiresIn: getRefreshExpiresIn() });
}

/**
 * Verify refresh token. Returns decoded payload or throws.
 */
export function verifyRefreshToken(token) {
  const secret = process.env.REFRESH_TOKEN_SECRET || process.env.JWT_SECRET;
  return jwt.verify(token, secret);
}

/**
 * Set httpOnly refresh cookie on res.
 */
export function setRefreshTokenCookie(res, refreshToken) {
  const isProduction = process.env.NODE_ENV === "production";
  res.cookie(REFRESH_COOKIE_NAME, refreshToken, {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
    path: "/",
    maxAge: getRefreshMaxAgeMs(),
  });
}

/**
 * Clear refresh cookie (logout).
 */
export function clearRefreshTokenCookie(res) {
  res.clearCookie(REFRESH_COOKIE_NAME, {
    httpOnly: true,
    path: "/",
  });
}
