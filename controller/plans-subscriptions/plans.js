import pool from "../../models/db.js";

/**
 * error handler
 */
const handleError = (res, err, message = "Server error") => {
  console.error(`[Plans API] ${message}:`, err.message);
  return res.status(500).json({ success: false, message, error: err.message });
};

/**
 * Get all plans 
 * Use ?withCounts=true to include aggregated counts
 */
export const getPlans = async (req, res) => {
  const withCounts = req.query.withCounts === "true";

  try {
    const query = withCounts
      ? `
        SELECT 
          p.*,
          COALESCE(COUNT(s.id), 0) AS subscription_count
        FROM plans p
        LEFT JOIN subscriptions s ON p.id = s.plan_id
        GROUP BY p.id
        ORDER BY p.id ASC;
      `
      : `SELECT * FROM plans ORDER BY id ASC;`;

    const { rows } = await pool.query(query);
    res.status(200).json({ success: true, plans: rows });
  } catch (err) {
    handleError(res, err, "Failed to fetch plans");
  }
};

/**
 * Create a new plan (Admin only)
 */
export const createPlan = async (req, res) => {
  if (req.token.role !== 1)
    return res.status(403).json({ success: false, message: "Admin only" });

  const { name, price, duration, description, features, plan_type } = req.body;

  if (!name || !price || !duration)
    return res.status(400).json({
      success: false,
      message: "Missing required fields: name, price, duration",
    });

  try {
    const query = `
      INSERT INTO plans (name, price, duration, description, features, plan_type)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *;
    `;
    const { rows } = await pool.query(query, [
      name,
      price,
      duration,
      description || "",
      features || [],
      plan_type || "monthly",
    ]);

    res.status(201).json({
      success: true,
      message: "Plan created successfully",
      plan: rows[0],
    });
  } catch (err) {
    handleError(res, err, "Failed to create plan");
  }
};

/**
 * Edit plan (Admin only)
 */
export const editPlan = async (req, res) => {
  if (req.token.role !== 1)
    return res.status(403).json({ success: false, message: "Admin only" });

  const { id } = req.params;
  const { name, price, duration, description, features, plan_type } = req.body;

  try {
    const query = `
      UPDATE plans
      SET 
        name = $1,
        price = $2,
        duration = $3,
        description = $4,
        features = $5,
        plan_type = $6
      WHERE id = $7
      RETURNING *;
    `;
    const { rows } = await pool.query(query, [
      name,
      price,
      duration,
      description || "",
      features || [],
      plan_type || "monthly",
      id,
    ]);

    if (!rows.length)
      return res.status(404).json({ success: false, message: "Plan not found" });

    res.status(200).json({
      success: true,
      message: "Plan updated successfully",
      plan: rows[0],
    });
  } catch (err) {
    handleError(res, err, "Failed to update plan");
  }
};

/**
 * Delete plan (Admin only)
 
 */
export const deletePlan = async (req, res) => {
  if (req.token.role !== 1)
    return res.status(403).json({ success: false, message: "Admin only" });

  const { id } = req.params;

  try {
    // Check if plan has any subscriptions
    const { rows: subs } = await pool.query(
      "SELECT COUNT(*) as count FROM subscriptions WHERE plan_id = $1",
      [id]
    );
    
    if (parseInt(subs[0].count) > 0) {
      return res.status(400).json({ 
        success: false, 
        message: `Cannot delete plan. ${subs[0].count} subscription(s) exist. Please cancel or delete them first.` 
      });
    }

    const { rowCount } = await pool.query("DELETE FROM plans WHERE id = $1", [id]);
    if (rowCount === 0)
      return res.status(404).json({ success: false, message: "Plan not found" });

    res.status(200).json({ success: true, message: "Plan deleted successfully" });
  } catch (err) {
    handleError(res, err, "Failed to delete plan");
  }
};

/**
 * Get all plan subscription counts 
 */
export const getPlanSubscriptionCounts = async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT 
        p.id AS plan_id,
        COUNT(s.id) AS subscription_count
      FROM plans p
      LEFT JOIN subscriptions s ON p.id = s.plan_id
      GROUP BY p.id
      ORDER BY p.id;
    `);
    res.status(200).json({ success: true, counts: rows });
  } catch (err) {
    handleError(res, err, "Failed to fetch subscription counts");
  }
};

/* -------------------------------
   SUBSCRIPTIONS SECTION
--------------------------------*/

/**
 * Freelancer Subscribe to plan
 */
export const subscribeToPlan = async (req, res) => {
  const freelancerId = req.token?.userId;
  const { plan_id } = req.body;

  try {
    // Check if user already has an active or pending_start subscription
    const { rows: existing } = await pool.query(
      `SELECT id, status, end_date, start_date 
       FROM subscriptions 
       WHERE freelancer_id = $1 
         AND status IN ('active', 'pending_start')
         AND (end_date > NOW() OR start_date > NOW())
       LIMIT 1`,
      [freelancerId]
    );
    if (existing.length) {
      const existingSub = existing[0];
      const expirationDate = existingSub.end_date 
        ? new Date(existingSub.end_date).toLocaleDateString()
        : new Date(existingSub.start_date).toLocaleDateString();
      
      return res.status(400).json({
        success: false,
        message: `You already have an active or upcoming subscription. You cannot change plans until it expires.${existingSub.end_date ? ` Current subscription expires on ${expirationDate}.` : ''}`,
      });
    }

    const { rows: planRows } = await pool.query(
      "SELECT duration FROM plans WHERE id = $1",
      [plan_id]
    );
    if (!planRows.length)
      return res.status(404).json({ success: false, message: "Plan not found" });

    const query = `
      INSERT INTO subscriptions (freelancer_id, plan_id, start_date, end_date, status)
      VALUES ($1, $2, NOW(), NOW() + (p.duration || ' days')::interval, 'active')
      RETURNING *;
    `;
    const { rows } = await pool.query(query, [freelancerId, plan_id]);
    res.status(201).json({
      success: true,
      message: "Subscription created successfully.",
      subscription: rows[0],
    });
  } catch (err) {
    handleError(res, err, "Failed to subscribe to plan");
  }
};

/**
 * Freelancer Cancel own subscription
 */
export const cancelSubscription = async (req, res) => {
  const freelancerId = req.token?.userId;

  try {
    const { rows } = await pool.query(
      `UPDATE subscriptions
       SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
       WHERE freelancer_id = $1 AND status = 'active'
       RETURNING *;`,
      [freelancerId]
    );

    if (!rows.length)
      return res.status(400).json({
        success: false,
        message: "No active subscription found.",
      });

    res.status(200).json({
      success: true,
      message: "Subscription cancelled successfully.",
      subscription: rows[0],
    });
  } catch (err) {
    handleError(res, err, "Failed to cancel subscription");
  }
};

/**
 * Admin cancel a subscription 
 */
export const adminCancelSubscription = async (req, res) => {
  if (req.token.role !== 1)
    return res.status(403).json({ success: false, message: "Admin only" });

  const { id } = req.params; 

  try {
    const { rowCount } = await pool.query(
      "DELETE FROM subscriptions WHERE id = $1",
      [id]
    );

    if (rowCount === 0)
      return res.status(404).json({ 
        success: false, 
        message: "Subscription not found" 
      });

    res.status(200).json({ 
      success: true, 
      message: "Subscription deleted successfully" 
    });
  } catch (err) {
    handleError(res, err, "Failed to delete subscription");
  }
};


/**
 * Admin Update or change subscription status/date
 */
export const adminUpdateSubscription = async (req, res) => {
  if (req.token.role !== 1)
    return res.status(403).json({ success: false, message: "Admin only" });

  const { subscription_id, status, end_date } = req.body;

  try {
    const query = `
      UPDATE subscriptions
      SET 
        status = COALESCE($2, status),
        end_date = COALESCE($3, end_date),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING *;
    `;
    const { rows } = await pool.query(query, [subscription_id, status, end_date]);

    if (!rows.length)
      return res.status(404).json({ success: false, message: "Subscription not found" });

    res.status(200).json({
      success: true,
      message: "Subscription updated successfully",
      subscription: rows[0],
    });
  } catch (err) {
    handleError(res, err, "Failed to update subscription");
  }
};

/**
 * Admin Delete a subscription by ID 
 */
export const deleteSubscription = async (req, res) => {
  if (req.token.role !== 1)
    return res.status(403).json({ success: false, message: "Admin only" });

  const { id } = req.params; 

  try {
    const { rowCount } = await pool.query(
      "DELETE FROM subscriptions WHERE id = $1",
      [id]
    );

    if (rowCount === 0)
      return res.status(404).json({ 
        success: false, 
        message: "Subscription not found" 
      });

    res.status(200).json({ 
      success: true, 
      message: "Subscription deleted successfully" 
    });
  } catch (err) {
    handleError(res, err, "Failed to delete subscription");
  }
};


/**
 * Admin Get all subscriptions
 */
export const getAllSubscriptions = async (req, res) => {
  if (req.token.role !== 1)
    return res.status(403).json({ success: false, message: "Admin only" });

  try {
    const query = `
      SELECT 
        s.id AS subscription_id,
        s.start_date,
        s.end_date,
        s.status,
        u.id AS freelancer_id,
        u.email,
        p.id AS plan_id,
        p.name AS plan_name,
        p.price AS plan_price,
        p.duration AS plan_duration,
        p.plan_type
      FROM subscriptions s
      JOIN users u ON u.id = s.freelancer_id
      JOIN plans p ON p.id = s.plan_id
      ORDER BY s.start_date DESC;
    `;
    const { rows } = await pool.query(query);
    res.status(200).json({ success: true, subscriptions: rows });
  } catch (err) {
    handleError(res, err, "Failed to fetch all subscriptions");
  }
};

/**
 * Admin Get all subscribers for a plan
 */
export const getPlanSubscribers = async (req, res) => {
  if (req.token.role !== 1)
    return res.status(403).json({ success: false, message: "Admin only" });

  const { id } = req.params;

  try {
    const { rows } = await pool.query(
      `
      SELECT 
        s.id,
        u.id AS user_id,
        u.email,
        u.phone_number,
        s.start_date,
        s.end_date,
        s.status
      FROM subscriptions s
      JOIN users u ON u.id = s.freelancer_id
      WHERE s.plan_id = $1
      ORDER BY s.start_date DESC;
      `,
      [id]
    );

    res.status(200).json({
      success: true,
      users: rows,
    });
  } catch (err) {
    console.error("Failed to fetch plan subscribers:", err);
    res.status(500).json({
      success: false,
      message: "Failed to fetch plan subscribers",
      error: err.message,
    });
  }
};