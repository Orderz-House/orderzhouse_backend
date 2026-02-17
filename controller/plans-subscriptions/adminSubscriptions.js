import pool from "../../models/db.js";

/**
 * Admin: Assign subscription to freelancer
 * POST /admin/subscriptions/assign
 */
export const assignSubscriptionToFreelancer = async (req, res) => {
  try {
    const adminRole = req.token.role || req.token.roleId;
    const adminId = req.token.userId;

    // Check if user is admin (role_id = 1)
    if (Number(adminRole) !== 1) {
      return res.status(403).json({
        success: false,
        message: "Only admins can assign subscriptions",
      });
    }

    const { freelancer_id, plan_id } = req.body;

    // Validate required fields
    if (!freelancer_id || !plan_id) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields: freelancer_id and plan_id",
      });
    }

    // Validate freelancer exists and is freelancer role
    const { rows: freelancerRows } = await pool.query(
      `SELECT id, role_id, first_name, last_name, email
       FROM users
       WHERE id = $1 AND is_deleted = false`,
      [freelancer_id]
    );

    if (freelancerRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Freelancer not found",
      });
    }

    const freelancer = freelancerRows[0];
    if (Number(freelancer.role_id) !== 3) {
      return res.status(400).json({
        success: false,
        message: "User is not a freelancer",
      });
    }

    // Validate plan exists
    const { rows: planRows } = await pool.query(
      `SELECT id, name, duration, plan_type
       FROM plans
       WHERE id = $1`,
      [plan_id]
    );

    if (planRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Plan not found",
      });
    }

    const plan = planRows[0];

    // Check if freelancer already has an active or pending_start subscription
    const { rows: existingSubs } = await pool.query(
      `SELECT id, status, start_date, end_date
       FROM subscriptions
       WHERE freelancer_id = $1
         AND status IN ('active', 'pending_start')
       ORDER BY id DESC
       LIMIT 1`,
      [freelancer_id]
    );

    // If there's an existing pending_start or active subscription, update it
    // Otherwise create new one
    let subscription;
    if (existingSubs.length > 0) {
      // Update existing subscription
      const { rows: updatedRows } = await pool.query(
        `UPDATE subscriptions
         SET plan_id = $1,
             status = 'pending_start',
             start_date = NULL,
             end_date = NULL,
             updated_at = NOW()
         WHERE id = $2
         RETURNING *`,
        [plan_id, existingSubs[0].id]
      );
      subscription = updatedRows[0];
    } else {
      // Create new subscription with pending_start status
      // Note: start_date and end_date are NULL - will be set when freelancer starts first project
      const { rows: newRows } = await pool.query(
        `INSERT INTO subscriptions (freelancer_id, plan_id, status, start_date, end_date)
         VALUES ($1, $2, 'pending_start', NULL, NULL)
         RETURNING *`,
        [freelancer_id, plan_id]
      );
      subscription = newRows[0];
    }

    return res.json({
      success: true,
      message: "Subscription assigned successfully",
      subscription: {
        ...subscription,
        freelancer: {
          id: freelancer.id,
          name: `${freelancer.first_name} ${freelancer.last_name}`,
          email: freelancer.email,
        },
        plan: {
          id: plan.id,
          name: plan.name,
          duration: plan.duration,
          plan_type: plan.plan_type,
        },
      },
    });
  } catch (err) {
    console.error("assignSubscriptionToFreelancer error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to assign subscription",
      error: err.message,
    });
  }
};

/**
 * Admin: Get all freelancers with subscription info
 * GET /admin/subscriptions/freelancers
 */
export const getFreelancersWithSubscriptions = async (req, res) => {
  try {
    const adminRole = req.token.role || req.token.roleId;

    // Check if user is admin (role_id = 1)
    if (Number(adminRole) !== 1) {
      return res.status(403).json({
        success: false,
        message: "Only admins can view freelancers",
      });
    }

    // Get all freelancers with their most recent subscription
    const query = `
      SELECT 
        u.id AS freelancer_id,
        u.first_name,
        u.last_name,
        u.email,
        s.id AS subscription_id,
        s.plan_id,
        s.status AS subscription_status,
        s.start_date,
        s.end_date,
        p.name AS plan_name,
        p.duration AS plan_duration,
        p.plan_type
      FROM users u
      LEFT JOIN LATERAL (
        SELECT s.*
        FROM subscriptions s
        WHERE s.freelancer_id = u.id
        ORDER BY s.id DESC
        LIMIT 1
      ) s ON true
      LEFT JOIN plans p ON p.id = s.plan_id
      WHERE u.role_id = 3
        AND u.is_deleted = false
      ORDER BY u.id ASC
    `;

    const { rows } = await pool.query(query);

    const freelancers = rows.map((row) => ({
      id: row.freelancer_id,
      first_name: row.first_name,
      last_name: row.last_name,
      email: row.email,
      subscription: row.subscription_id
        ? {
            id: row.subscription_id,
            plan_id: row.plan_id,
            status: row.subscription_status,
            start_date: row.start_date,
            end_date: row.end_date,
            plan_name: row.plan_name,
            plan_duration: row.plan_duration,
            plan_type: row.plan_type,
          }
        : null,
    }));

    return res.json({
      success: true,
      count: freelancers.length,
      freelancers,
    });
  } catch (err) {
    console.error("getFreelancersWithSubscriptions error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch freelancers",
      error: err.message,
    });
  }
};

/**
 * Admin: Get all subscriptions with filters
 * GET /admin/subscriptions?status=pending_start|active|expired
 */
export const getAdminSubscriptions = async (req, res) => {
  try {
    const adminRole = req.token.role || req.token.roleId;

    // Check if user is admin (role_id = 1)
    if (Number(adminRole) !== 1) {
      return res.status(403).json({
        success: false,
        message: "Only admins can view subscriptions",
      });
    }

    const { status } = req.query;

    let query = `
      SELECT 
        s.id,
        s.freelancer_id,
        s.plan_id,
        s.status,
        s.start_date,
        s.end_date,
        u.first_name || ' ' || u.last_name AS freelancer_name,
        u.email AS freelancer_email,
        p.name AS plan_name,
        p.duration AS plan_duration,
        p.plan_type AS plan_type
      FROM subscriptions s
      LEFT JOIN users u ON s.freelancer_id = u.id
      LEFT JOIN plans p ON s.plan_id = p.id
      WHERE u.is_deleted = false
    `;

    const params = [];

    if (status) {
      query += ` AND s.status = $1`;
      params.push(status);
    }

    query += ` ORDER BY s.id DESC`;

    const { rows } = await pool.query(query, params);

    return res.json({
      success: true,
      count: rows.length,
      subscriptions: rows,
    });
  } catch (err) {
    console.error("getAdminSubscriptions error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch subscriptions",
      error: err.message,
    });
  }
};

/**
 * Admin: Activate subscription with start date
 * POST /admin/subscriptions/:id/activate
 */
export const activateSubscription = async (req, res) => {
  try {
    const adminRole = req.token.role || req.token.roleId;

    // Check if user is admin (role_id = 1)
    if (Number(adminRole) !== 1) {
      return res.status(403).json({
        success: false,
        message: "Only admins can activate subscriptions",
      });
    }

    const subscriptionId = Number(req.params.id);
    const { start_date } = req.body;

    if (!subscriptionId || !Number.isInteger(subscriptionId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid subscription ID",
      });
    }

    if (!start_date) {
      return res.status(400).json({
        success: false,
        message: "start_date is required",
      });
    }

    // Validate start_date format
    const startDateObj = new Date(start_date);
    if (isNaN(startDateObj.getTime())) {
      return res.status(400).json({
        success: false,
        message: "Invalid start_date format",
      });
    }

    // Get subscription with plan details
    const { rows: subRows } = await pool.query(
      `SELECT s.id, s.freelancer_id, s.plan_id, s.status, p.plan_type, p.duration
       FROM subscriptions s
       LEFT JOIN plans p ON p.id = s.plan_id
       WHERE s.id = $1`,
      [subscriptionId]
    );

    if (subRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Subscription not found",
      });
    }

    const subscription = subRows[0];
    const planType = String(subscription.plan_type || "monthly").toLowerCase();
    const duration = Number(subscription.duration || 0);

    if (duration <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid plan duration",
      });
    }

    // Calculate end_date using SQL interval
    const intervalUnit = planType === "yearly" ? "years" : "months";
    const intervalString = `${duration} ${intervalUnit}`;

    // Update subscription
    const { rows: updatedRows } = await pool.query(
      `UPDATE subscriptions
       SET status = 'active',
           start_date = $1::date,
           end_date = $1::date + ($2::text || ' ' || $3::text)::interval,
           updated_at = NOW()
       WHERE id = $4
         AND status = 'pending_start'
       RETURNING id, status, start_date, end_date, plan_id`,
      [start_date, duration.toString(), intervalUnit, subscriptionId]
    );

    if (updatedRows.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Subscription not found or not in pending_start status",
      });
    }

    return res.json({
      success: true,
      message: "Subscription activated successfully",
      subscription: updatedRows[0],
    });
  } catch (err) {
    console.error("activateSubscription error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to activate subscription",
      error: err.message,
    });
  }
};

/**
 * Admin: Cancel subscription
 * POST /admin/subscriptions/:id/cancel
 */
export const cancelSubscription = async (req, res) => {
  try {
    const adminRole = req.token.role || req.token.roleId;

    // Check if user is admin (role_id = 1)
    if (Number(adminRole) !== 1) {
      return res.status(403).json({
        success: false,
        message: "Only admins can cancel subscriptions",
      });
    }

    const subscriptionId = Number(req.params.id);
    const { reason } = req.body;

    if (!subscriptionId || !Number.isInteger(subscriptionId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid subscription ID",
      });
    }

    // Check if subscription exists and is active
    const { rows: subRows } = await pool.query(
      `SELECT id, status FROM subscriptions WHERE id = $1`,
      [subscriptionId]
    );

    if (subRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Subscription not found",
      });
    }

    if (subRows[0].status !== "active") {
      return res.status(400).json({
        success: false,
        message: "Only active subscriptions can be cancelled",
      });
    }

    // Update subscription to cancelled
    // Check if cancelled_at column exists, if not use updated_at
    const { rows: updatedRows } = await pool.query(
      `UPDATE subscriptions
       SET status = 'cancelled',
           updated_at = NOW()
       WHERE id = $1
       RETURNING id, status, updated_at`,
      [subscriptionId]
    );

    return res.json({
      success: true,
      message: "Subscription cancelled successfully",
      subscription: updatedRows[0],
    });
  } catch (err) {
    console.error("cancelSubscription error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to cancel subscription",
      error: err.message,
    });
  }
};
