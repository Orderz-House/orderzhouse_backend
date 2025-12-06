// controller/auth.js
import pool from "../models/db.js";
import speakeasy from "speakeasy";
import qrcode from "qrcode";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";

dotenv.config();

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

    const tokenPayload = {
      userId: user.id,
      role: user.role_id,
      is_verified: user.email_verified,
      username: user.username,
      is_deleted: user.is_deleted,
      is_two_factor_enabled: user.is_two_factor_enabled,
    };

    const token = jwt.sign(tokenPayload, process.env.JWT_SECRET, {
      expiresIn: "1d",
    });

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
    });
  } catch (error) {
    console.error("verifyTwoFactorLogin Error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error verifying 2FA code",
    });
  }
};
