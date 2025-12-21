// controllers/subscriptionsController.js

import pool from "../../models/db.js";

// =======================================================
//  ADMIN — GET ALL SUBSCRIPTIONS
// =======================================================
export const getAllSubscriptions = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
         s.id,
         s.status,
         s.created_at,
         u.id AS user_id,
         u.name AS user_name,
         u.email AS user_email,
         p.name AS plan_name
       FROM subscriptions s
       LEFT JOIN users u ON s.user_id = u.id
       LEFT JOIN plans p ON s.plan_id = p.id
       ORDER BY s.created_at DESC`
    );

    res.status(200).json({ success: true, subscriptions: result.rows });

  } catch (err) {
    console.error("❌ Error fetching subscriptions:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};
