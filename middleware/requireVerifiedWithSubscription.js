import pool from "../models/db.js";
import { hasActiveSubscription } from "../utils/subscriptionCheck.js";

const requireVerifiedWithSubscription = async (req, res, next) => {
  try {
    const userId = req.token?.userId;
    const role = req.token?.role;

    if (!userId)
      return res.status(401).json({ success: false, message: "Unauthorized" });

    // Admins (1) and Clients (2) bypass this restriction
    if (role === 1 || role === 2) return next();

    if (role === 3) {
      const { rows: userRows } = await pool.query(
        `SELECT is_verified FROM users WHERE id = $1 AND is_deleted = false`,
        [userId]
      );

      if (!userRows.length) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      const isVerified = userRows[0].is_verified;
      if (!isVerified) {
        return res.status(403).json({
          success: false,
          message: "Your account must be verified to perform this action",
        });
      }

      const hasPlan = await hasActiveSubscription(userId);
      if (!hasPlan) {
        return res.status(403).json({
          success: false,
          message: "You need an active subscription plan to perform this action",
        });
      }
    }

    next();
  } catch (err) {
    console.error("requireVerifiedWithSubscription error:", err);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: err.message,
    });
  }
};

export default requireVerifiedWithSubscription;
