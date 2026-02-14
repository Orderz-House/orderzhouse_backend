import pool from "../../models/db.js";

/**
 * Get current subscription status for a freelancer
 * Returns: status, remaining_days, activated_at, yearly_fee_paid
 */
export const getSubscriptionStatus = async (req, res) => {
  try {
    const freelancerId = req.token?.userId;
    const roleId = req.token?.role || req.token?.roleId;

    if (!freelancerId) {
      return res.status(401).json({ success: false, error: "Unauthorized" });
    }

    // Only freelancers (role_id = 3) can view subscription status
    if (Number(roleId) !== 3) {
      return res.status(403).json({ success: false, error: "Forbidden - Freelancers only" });
    }

    // Get current subscription (handle missing activated_at column gracefully)
    let subs;
    try {
      const result = await pool.query(
        `SELECT 
          s.id,
          s.status,
          s.start_date,
          s.end_date,
          s.activated_at,
          p.duration,
          p.plan_type,
          p.name as plan_name
         FROM subscriptions s
         JOIN plans p ON s.plan_id = p.id
         WHERE s.freelancer_id = $1
           AND s.status IN ('pending_start', 'active', 'cancelled')
         ORDER BY s.id DESC
         LIMIT 1`,
        [freelancerId]
      );
      subs = result.rows;
    } catch (err) {
      // If activated_at column doesn't exist, query without it
      if (err.message && err.message.includes('activated_at')) {
        const result = await pool.query(
          `SELECT 
            s.id,
            s.status,
            s.start_date,
            s.end_date,
            NULL as activated_at,
            p.duration,
            p.plan_type,
            p.name as plan_name
           FROM subscriptions s
           JOIN plans p ON s.plan_id = p.id
           WHERE s.freelancer_id = $1
             AND s.status IN ('pending_start', 'active', 'cancelled')
           ORDER BY s.id DESC
           LIMIT 1`,
          [freelancerId]
        );
        subs = result.rows;
      } else {
        throw err;
      }
    }

    // Get yearly fee payment status from user_yearly_fees table
    const currentYear = new Date().getFullYear();
    const { rows: feeRows } = await pool.query(
      `SELECT fee_year FROM user_yearly_fees 
       WHERE user_id = $1 AND fee_year = $2 
       LIMIT 1`,
      [freelancerId, currentYear]
    );
    const yearlyFeePaid = feeRows.length > 0;

    if (subs.length === 0) {
      return res.json({
        success: true,
        subscription: null,
        status: "none",
        remaining_days: 0,
        yearly_fee_paid: yearlyFeePaid,
      });
    }

    const subscription = subs[0];
    let remainingDays = 0;
    let statusMessage = "";

    // Check if subscription is activated (activated_at IS NOT NULL)
    const isActivated = subscription.activated_at !== null;

    if (!isActivated || subscription.status === "pending_start") {
      // Not activated yet - show full duration but label as not started
      if (subscription.plan_type === "monthly") {
        remainingDays = subscription.duration * 30; // Convert months to days
      } else {
        remainingDays = subscription.duration * 365; // Convert years to days
      }
      statusMessage = "Starts when you start your first project";
    } else if (subscription.status === "active" && isActivated) {
      // Active subscription - calculate remaining days from end_date
      const endDate = new Date(subscription.end_date);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      endDate.setHours(0, 0, 0, 0);

      const diffTime = endDate - today;
      remainingDays = Math.max(0, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));
      statusMessage = `${remainingDays} days remaining`;
    } else {
      // Expired or cancelled
      statusMessage = "Subscription expired";
      remainingDays = 0;
    }

    res.json({
      success: true,
      subscription: {
        id: subscription.id,
        plan_name: subscription.plan_name,
        status: subscription.status,
        activated_at: subscription.activated_at,
        start_date: subscription.start_date,
        end_date: subscription.end_date,
      },
      status: subscription.status,
      remaining_days: remainingDays,
      status_message: statusMessage,
      yearly_fee_paid: yearlyFeePaid,
    });
  } catch (err) {
    console.error("getSubscriptionStatus error:", err);
    res.status(500).json({ success: false, error: "Server error" });
  }
};
