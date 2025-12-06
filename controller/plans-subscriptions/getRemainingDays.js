import pool from "../../models/db.js";

/**
 * Returns remaining days for a freelancer's active subscription.
 * 
 *
 * @param {number} freelancerId - user id
 * @returns {Promise<number>} - days remaining
 */
export const getRemainingDays = async (freelancerId) => {
  const { rows } = await pool.query(
    `SELECT end_date
     FROM subscriptions
     WHERE freelancer_id = $1
       AND status = 'active'
       AND start_date IS NOT NULL
       AND end_date >= NOW()
     ORDER BY end_date DESC
     LIMIT 1`,
    [freelancerId]
  );

  if (!rows.length) return 0;

  const endDate = new Date(rows[0].end_date);
  const today = new Date();

  const diffTime = endDate - today;
  const remainingDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  return remainingDays > 0 ? remainingDays : 0;
};
