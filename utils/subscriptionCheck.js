import pool from "../models/db.js";

export const hasActiveSubscription = async (freelancerId) => {
  // Auto-expire subscriptions that have passed end_date
  await expireSubscriptionsIfNeeded(freelancerId);

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

/**
 * Auto-expire subscriptions where NOW() >= end_date
 * This is called lazily during subscription checks
 */
export const expireSubscriptionsIfNeeded = async (freelancerId = null) => {
  try {
    if (freelancerId) {
      // Expire for specific freelancer
      await pool.query(
        `UPDATE subscriptions
         SET status = 'expired'
         WHERE freelancer_id = $1
           AND status = 'active'
           AND end_date IS NOT NULL
           AND end_date < NOW()`,
        [freelancerId]
      );
    } else {
      // Expire all expired subscriptions (for cron-like usage)
      await pool.query(
        `UPDATE subscriptions
         SET status = 'expired'
         WHERE status = 'active'
           AND end_date IS NOT NULL
           AND end_date < NOW()`
      );
    }
  } catch (error) {
    console.error("expireSubscriptionsIfNeeded error:", error);
  }
};

/**
 * Check if freelancer has subscription that allows applying (active or pending_start)
 * Used for apply restriction enforcement
 */
export const canApplyToProjects = async (freelancerId) => {
  // Auto-expire subscriptions before checking
  await expireSubscriptionsIfNeeded(freelancerId);

  const { rows } = await pool.query(
    `SELECT id, status
     FROM subscriptions 
     WHERE freelancer_id = $1
       AND status IN ('active', 'pending_start')
     ORDER BY id DESC
     LIMIT 1`,
    [freelancerId]
  );

  if (rows.length === 0) {
    return { canApply: false, reason: "No subscription found" };
  }

  const subscription = rows[0];
  
  // If active, check if not expired
  if (subscription.status === 'active') {
    const { rows: activeRows } = await pool.query(
      `SELECT id 
       FROM subscriptions 
       WHERE freelancer_id = $1
         AND status = 'active'
         AND start_date IS NOT NULL
         AND end_date >= NOW()
       LIMIT 1`,
      [freelancerId]
    );
    
    if (activeRows.length === 0) {
      return { canApply: false, reason: "Subscription expired" };
    }
  }

  return { canApply: true, subscription };
};