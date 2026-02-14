import pool from "../models/db.js";

/**
 * Middleware to require tender vault management permission
 * Checks that user is a client (role_id = 2) and has can_manage_tender_vault = true
 */
const requireTenderVaultPermission = async (req, res, next) => {
  try {
    const userId = req.token?.userId;
    const roleId = req.token?.role || req.token?.roleId;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    // Check if user is client
    if (Number(roleId) !== 2) {
      return res.status(403).json({
        success: false,
        message: "Access denied. Tender vault is only available for clients.",
      });
    }

    // Check if user has permission
    const { rows } = await pool.query(
      `SELECT can_manage_tender_vault 
       FROM users 
       WHERE id = $1 AND is_deleted = false`,
      [userId]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    if (!rows[0].can_manage_tender_vault) {
      return res.status(403).json({
        success: false,
        message: "Access denied. You do not have permission to manage tender vault.",
      });
    }

    next();
  } catch (err) {
    console.error("requireTenderVaultPermission error:", err);
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

export default requireTenderVaultPermission;
