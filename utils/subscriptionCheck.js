import pool from "../models/db.js";

export const hasActiveSubscription = async (freelancerId) => {
  const { rows } = await pool.query(
    `SELECT id 
     FROM subscriptions 
     WHERE freelancer_id = $1
       AND status = 'active'
       AND start_date IS NOT NULL
       AND end_date >= NOW()
     LIMIT 1`,
    [freelancerId]
  );

  return rows.length > 0;
};
