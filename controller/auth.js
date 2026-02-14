// controller/auth.js
import pool from "../models/db.js";
import speakeasy from "speakeasy";
import qrcode from "qrcode";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import crypto from "crypto";
import { OAuth2Client } from "google-auth-library";
import dotenv from "dotenv";
import {
  buildTokenPayload,
  issueAccessToken,
  issueRefreshToken,
  setRefreshTokenCookie,
} from "../utils/tokenHelper.js";

dotenv.config();

const GOOGLE_CLIENT_ID = process.env.GOOGLE_WEB_CLIENT_ID || process.env.GOOGLE_CLIENT_ID;

/**
 * POST /auth/google
 * Sign in with Google idToken. Verifies token, finds user by email, returns app JWT.
 * Body: { idToken: string, accessToken?: string }
 */
export const loginWithGoogle = async (req, res) => {
  try {
    const { idToken } = req.body;
    if (!idToken) {
      return res.status(400).json({
        success: false,
        message: "idToken is required",
      });
    }
    if (!GOOGLE_CLIENT_ID) {
      console.error("GOOGLE_AUTH: GOOGLE_WEB_CLIENT_ID or GOOGLE_CLIENT_ID not set in .env");
      return res.status(500).json({
        success: false,
        message: "Google Sign-In is not configured on the server",
      });
    }

    const client = new OAuth2Client(GOOGLE_CLIENT_ID);
    const ticket = await client.verifyIdToken({
      idToken,
      audience: GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    if (!payload || !payload.email) {
      return res.status(400).json({
        success: false,
        message: "Invalid Google token: missing email",
      });
    }

    const email = payload.email.toLowerCase();
    const givenName = payload.given_name || payload.name || "";
    const familyName = payload.family_name || "";
    const picture = payload.picture || null;

    let { rows } = await pool.query(
      "SELECT * FROM users WHERE email = $1 AND is_deleted = FALSE",
      [email]
    );
    let user = rows[0];

    // First-time Google sign-in: create user and ask for profile completion
    if (!user) {
      const randomPassword = crypto.randomBytes(32).toString("hex");
      const hashedPassword = await bcrypt.hash(randomPassword, 10);
      const username = email;

      const insertResult = await pool.query(
        `INSERT INTO users (role_id, first_name, last_name, email, password, phone_number, country, username, email_verified, profile_pic_url)
         VALUES (2, $1, $2, $3, $4, '', '', $5, TRUE, $6)
         RETURNING id, email, first_name, last_name, username, role_id, profile_pic_url, phone_number, country, is_deleted, is_two_factor_enabled, email_verified`,
        [givenName, familyName, email, hashedPassword, username, picture]
      );
      user = insertResult.rows[0];
    }

    const { CURRENT_TERMS_VERSION } = await import("../config/terms.js");
    const mustAcceptTerms = !user.terms_accepted_at || user.terms_version !== CURRENT_TERMS_VERSION;

    const tokenPayload = buildTokenPayload({
      id: user.id,
      role_id: user.role_id,
      email_verified: user.email_verified,
      username: user.username,
      is_deleted: user.is_deleted,
      is_two_factor_enabled: user.is_two_factor_enabled,
    });
    const token = issueAccessToken(tokenPayload);
    const refreshToken = issueRefreshToken(tokenPayload);
    setRefreshTokenCookie(res, refreshToken);

    const needsProfileCompletion = !!(
      (!user.phone_number || user.phone_number === "") &&
      (!user.country || user.country === "") &&
      user.role_id === 2
    );

    return res.status(200).json({
      success: true,
      message: needsProfileCompletion ? "Account created. Complete your profile." : "Login successful",
      token,
      userInfo: {
        id: user.id,
        username: user.username,
        email: user.email,
        role_id: user.role_id,
        first_name: user.first_name,
        last_name: user.last_name,
        profile_pic_url: user.profile_pic_url,
        phone_number: user.phone_number,
        country: user.country,
        is_deleted: user.is_deleted,
        is_two_factor_enabled: user.is_two_factor_enabled,
        email_verified: user.email_verified,
      },
      must_accept_terms: mustAcceptTerms,
      terms_version_required: CURRENT_TERMS_VERSION,
      needs_profile_completion: !!needsProfileCompletion,
    });
  } catch (error) {
    console.error("GOOGLE_AUTH Error:", error);
    const message =
      !GOOGLE_CLIENT_ID
        ? "Server: Google Client ID not set. Add GOOGLE_WEB_CLIENT_ID or GOOGLE_CLIENT_ID to backend .env"
        : error.message || "Google sign-in failed";
    return res.status(500).json({
      success: false,
      message,
    });
  }
};

/**
 * POST /auth/2fa/generate
 * إنشاء سيكرت + QR Code للـ 2FA من صفحة الإعدادات
 */
export const generateTwoFactorSecret = async (req, res) => {
  try {
    const userId = req.token.userId;

    const userResult = await pool.query(
      "SELECT email FROM users WHERE id = $1 AND is_deleted = FALSE",
      [userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const userEmail = userResult.rows[0].email;

    const secret = speakeasy.generateSecret({
      name: `OrderzHouse (${userEmail})`,
    });

    await pool.query(
      `UPDATE users 
       SET two_factor_secret = $1, is_two_factor_enabled = FALSE 
       WHERE id = $2`,
      [secret.base32, userId]
    );

    qrcode.toDataURL(secret.otpauth_url, (err, data_url) => {
      if (err) {
        console.error("QR Code Generation Error:", err);
        return res.status(500).json({
          success: false,
          message: "Could not generate QR code.",
        });
      }

      return res.status(200).json({
        success: true,
        message: "Scan this QR code with your authenticator app.",
        qrCodeUrl: data_url,
        secret: secret.base32,
      });
    });
  } catch (error) {
    console.error("2FA Generate Error:", error);
    res.status(500).json({
      success: false,
      message: "Server error while generating 2FA secret.",
    });
  }
};

/**
 * POST /auth/2fa/verify
 * التحقق من كود الـ 2FA وقت التفعيل من صفحة الإعدادات
 */
export const verifyTwoFactorToken = async (req, res) => {
  try {
    const userId = req.token.userId;
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({
        success: false,
        message: "Verification token is required.",
      });
    }

    const userResult = await pool.query(
      `SELECT two_factor_secret FROM users WHERE id = $1 AND is_deleted = FALSE`,
      [userId]
    );

    if (userResult.rowCount === 0 || !userResult.rows[0].two_factor_secret) {
      return res.status(400).json({
        success: false,
        message: "2FA secret not found. Please generate one first.",
      });
    }

    const secret = userResult.rows[0].two_factor_secret;

    const verified = speakeasy.totp.verify({
      secret: secret,
      encoding: "base32",
      token,
      window: 1,
    });

    if (!verified) {
      return res.status(400).json({
        success: false,
        message: "Invalid 2FA token. Please try again.",
      });
    }

    await pool.query(
      `UPDATE users SET is_two_factor_enabled = TRUE WHERE id = $1`,
      [userId]
    );

    return res.status(200).json({
      success: true,
      message: "2FA has been enabled successfully!",
    });
  } catch (error) {
    console.error("2FA Verify Error:", error);
    res.status(500).json({
      success: false,
      message: "Server error while verifying 2FA token.",
    });
  }
};

/**
 * POST /auth/2fa/disable
 * تعطيل 2FA من صفحة الإعدادات (بعد ما تكون تحققت الباسورد في endpoint ثاني)
 */
export const disableTwoFactor = async (req, res) => {
  try {
    const userId = req.token.userId;

    await pool.query(
      `UPDATE users 
       SET is_two_factor_enabled = FALSE, two_factor_secret = NULL 
       WHERE id = $1`,
      [userId]
    );

    return res.status(200).json({
      success: true,
      message: "2FA has been disabled.",
    });
  } catch (error) {
    console.error("2FA Disable Error:", error);
    res.status(500).json({
      success: false,
      message: "Server error while disabling 2FA.",
    });
  }
};

/**
 * POST /auth/2fa/verify-login
 * التحقق من كود الـ 2FA أثناء تسجيل الدخول (يستخدم temp_token)
 * هذا الراوت غير محمي بـ authentication
 */
export const verifyTwoFactorLogin = async (req, res) => {
  try {
    const { temp_token, code } = req.body;

    if (!temp_token || !code) {
      return res.status(400).json({
        success: false,
        message: "Temp token and code are required",
      });
    }

    let decoded;
    try {
      decoded = jwt.verify(temp_token, process.env.JWT_SECRET);
    } catch (err) {
      console.error("verifyTwoFactorLogin jwt error:", err);
      return res.status(403).json({
        success: false,
        message: "2FA session expired. Please login again.",
      });
    }

    if (!decoded || decoded.stage !== "2fa_login" || !decoded.userId) {
      return res.status(403).json({
        success: false,
        message: "Invalid 2FA session",
      });
    }

    const userId = decoded.userId;

    const { rows } = await pool.query(
      "SELECT * FROM users WHERE id=$1 AND is_deleted = FALSE",
      [userId]
    );

    if (!rows.length) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const user = rows[0];

    if (!user.two_factor_secret || !user.is_two_factor_enabled) {
      return res.status(400).json({
        success: false,
        message: "2FA is not enabled for this account",
      });
    }

    const verified = speakeasy.totp.verify({
      secret: user.two_factor_secret,
      encoding: "base32",
      token: code,
      window: 1,
    });

    if (!verified) {
      return res.status(403).json({
        success: false,
        message: "Invalid 2FA code",
      });
    }

    const tokenPayload = buildTokenPayload(user);
    const token = issueAccessToken(tokenPayload);
    const refreshToken = issueRefreshToken(tokenPayload);
    setRefreshTokenCookie(res, refreshToken);

    // Check terms acceptance
    const { CURRENT_TERMS_VERSION } = await import("../config/terms.js");
    const mustAcceptTerms = !user.terms_accepted_at || user.terms_version !== CURRENT_TERMS_VERSION;

    return res.status(200).json({
      success: true,
      message: "Login successful",
      token,
      userInfo: {
        id: user.id,
        username: user.username,
        email: user.email,
        role_id: user.role_id,
        first_name: user.first_name,
        last_name: user.last_name,
        profile_pic_url: user.profile_pic_url,
        is_deleted: user.is_deleted,
        is_two_factor_enabled: user.is_two_factor_enabled,
        email_verified: user.email_verified,
      },
      must_accept_terms: mustAcceptTerms,
      terms_version_required: CURRENT_TERMS_VERSION,
    });
  } catch (error) {
    console.error("verifyTwoFactorLogin Error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error verifying 2FA code",
    });
  }
};

/**
 * POST /auth/accept-terms
 * Accept Terms & Conditions
 */
export const acceptTerms = async (req, res) => {
  try {
    const userId = req.token.userId;
    const { CURRENT_TERMS_VERSION } = await import("../config/terms.js");

    // Update user's terms acceptance
    await pool.query(
      `UPDATE users 
       SET terms_accepted_at = NOW(), terms_version = $1 
       WHERE id = $2`,
      [CURRENT_TERMS_VERSION, userId]
    );

    return res.status(200).json({
      success: true,
      message: "Terms & Conditions accepted successfully",
    });
  } catch (error) {
    console.error("Accept Terms Error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error while accepting terms",
    });
  }
};

/**
 * PATCH /auth/change-password
 * Change user password (requires current password verification)
 */
export const changePassword = async (req, res) => {
  try {
    const userId = req.token.userId;
    const { currentPassword, newPassword } = req.body;

    // Validate inputs
    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: "Current password and new password are required",
      });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({
        success: false,
        message: "New password must be at least 8 characters long",
      });
    }

    // Fetch user's current password hash
    const userResult = await pool.query(
      "SELECT password FROM users WHERE id = $1 AND is_deleted = FALSE",
      [userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const currentHash = userResult.rows[0].password;

    // Verify current password
    const isMatch = await bcrypt.compare(currentPassword, currentHash);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: "Current password is incorrect",
      });
    }

    // Hash new password
    const salt = await bcrypt.genSalt(10);
    const newHash = await bcrypt.hash(newPassword, salt);

    // Update password in database
    await pool.query(
      "UPDATE users SET password = $1, updated_at = NOW() WHERE id = $2",
      [newHash, userId]
    );

    return res.status(200).json({
      success: true,
      message: "Password changed successfully",
    });
  } catch (error) {
    console.error("Change Password Error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error while changing password",
    });
  }
};
