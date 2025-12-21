import pool from "../models/db.js";
import eventBus from "../events/eventBus.js"; 

/* =========================================
   GET PENDING VERIFICATIONS
========================================= */

export const getPendingVerifications = async (req, res) => {
  try {
    const search = req.query.q ? `%${req.query.q.toLowerCase()}%` : null;
    const dateRange = req.query.dateRange || null;

    let query = `
      SELECT 
        id,
        username,
        email,
        profile_pic_url,
        created_at AS "AccountCreatedAt"
      FROM users
      WHERE role_id = 3
        AND is_verified = false
    `;

    const params = [];

    if (search) {
      params.push(search);
      query += ` AND (LOWER(username) LIKE $${params.length} OR LOWER(email) LIKE $${params.length})`;
    }

    if (dateRange === "today") {
      query += ` AND created_at::date = CURRENT_DATE`;
    } else if (dateRange === "week") {
      query += ` AND created_at >= NOW() - INTERVAL '7 days'`;
    } else if (dateRange === "month") {
      query += ` AND created_at >= NOW() - INTERVAL '30 days'`;
    }

    query += " ORDER BY created_at DESC";

    const { rows } = await pool.query(query, params);
    res.json({ data: rows });
  } catch (err) {
    console.error("Error fetching verifications:", err);
    res.status(500).json({ message: "Failed to fetch verifications" });
  }
};


/* =========================================
   APPROVE VERIFICATION
========================================= */
export const approveVerification = async (req, res) => {
  try {
    const { id } = req.params;

    await pool.query(
      `UPDATE users 
       SET is_verified = true, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [id]
    );

    try {
      eventBus.emit("freelancer.verificationApproved", {
        freelancerId: id,
        adminId: req.token?.userId || null,
      });
    } catch (e) {
      console.error("eventBus error freelancer.verificationApproved:", e);
    }

    res.json({ success: true, message: "Freelancer approved" });
  } catch (err) {
    console.error("Error approving verification:", err);
    res.status(500).json({ message: "Failed to approve verification" });
  }
};

/* =========================================
   REJECT VERIFICATION
========================================= */
export const rejectVerification = async (req, res) => {
  try {
    const { id } = req.params;

    await pool.query(
      `UPDATE users 
       SET is_verified = false, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [id]
    );

    try {
      eventBus.emit("freelancer.verificationRejected", {
        freelancerId: id,
        adminId: req.token?.userId || null,
      });
    } catch (e) {
      console.error("eventBus error freelancer.verificationRejected:", e);
    }

    res.json({ success: true, message: "Freelancer rejected" });
  } catch (err) {
    console.error("Error rejecting verification:", err);
    res.status(500).json({ message: "Failed to reject verification" });
  }
};
