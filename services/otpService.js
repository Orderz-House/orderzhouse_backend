import crypto from "crypto";
import dotenv from "dotenv";

dotenv.config();

const OTP_SECRET = process.env.OTP_SECRET || process.env.JWT_SECRET;

if (!OTP_SECRET) {
  console.warn("⚠️  OTP_SECRET not set. Using JWT_SECRET as fallback. Set OTP_SECRET for better security.");
}

/**
 * Generate a random 6-digit OTP
 * @returns {string} 6-digit OTP string
 */
export const generateOtp = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

/**
 * Hash OTP using HMAC-SHA256 for secure storage
 * @param {string} otp - Plain text OTP
 * @returns {string} Hex-encoded HMAC hash
 */
export const hashOtp = (otp) => {
  if (!OTP_SECRET) {
    throw new Error("OTP_SECRET is required for hashing");
  }
  return crypto.createHmac("sha256", OTP_SECRET).update(otp).digest("hex");
};

/**
 * Verify OTP using constant-time comparison to prevent timing attacks
 * @param {string} plainOtp - User-provided plain text OTP
 * @param {string} hashedOtp - Stored hashed OTP
 * @returns {boolean} True if OTP matches
 */
export const verifyOtp = (plainOtp, hashedOtp) => {
  if (!plainOtp || !hashedOtp) {
    return false;
  }
  if (!OTP_SECRET) {
    throw new Error("OTP_SECRET is required for verification");
  }
  const computedHash = hashOtp(plainOtp);
  // Use constant-time comparison to prevent timing attacks
  return crypto.timingSafeEqual(
    Buffer.from(computedHash, "hex"),
    Buffer.from(hashedOtp, "hex")
  );
};
