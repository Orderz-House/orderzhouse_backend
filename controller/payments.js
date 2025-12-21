import pool from "../models/db.js";

// =======================================================
//  GET ALL PAYMENTS FOR A USER
// =======================================================
export const getUserPayments = async (req, res) => {
  const { user_id } = req.params;

  try {
    const result = await pool.query(
      `SELECT 
         p.id,
         p.amount,
         p.currency,
         p.created_at,
         p.stripe_session_id,
         pl.name AS plan_name
       FROM payments p
       LEFT JOIN plans pl ON p.plan_id = pl.id
       WHERE p.user_id = $1
       ORDER BY p.created_at DESC`,
      [user_id]
    );

    res.status(200).json({ success: true, payments: result.rows });

  } catch (err) {
    console.error("❌ Error fetching user payments:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};


// =======================================================
//  ADMIN — GET ALL PAYMENTS
// =======================================================
export const getAllPayments = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
         p.id,
         p.amount,
         p.currency,
         p.created_at,
         u.id AS user_id,
         u.name AS user_name,
         u.email AS user_email,
         pl.name AS plan_name
       FROM payments p
       LEFT JOIN users u ON p.user_id = u.id
       LEFT JOIN plans pl ON p.plan_id = pl.id
       ORDER BY p.created_at DESC`
    );

    res.status(200).json({ success: true, payments: result.rows });

  } catch (err) {
    console.error("❌ Error fetching all payments:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};
