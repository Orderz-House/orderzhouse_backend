import pool from "../../models/db.js";


/**
 * Freelancer Get own subscription
 */
export const getFreelancerSubscription = async (req, res) => {
  const freelancerId = req.token?.userId;

  try {
    const query = `
      SELECT s.*, 
             p.id AS plan_id,
             p.name AS plan_name,
             p.price AS plan_price,
             p.duration AS plan_duration,
             p.description AS plan_description,
             p.features AS plan_features,
             p.plan_type AS plan_type
      FROM subscriptions s
      JOIN plans p ON p.id = s.plan_id
      WHERE s.freelancer_id = $1
      ORDER BY s.end_date DESC
      LIMIT 1;
    `;
    const { rows } = await pool.query(query, [freelancerId]);
    res.status(200).json({
      success: true,
      subscription: rows[0] ?? null,
    });
  } catch (err) {
    handleError(res, err, "Failed to fetch freelancer subscription");
  }
};


/**
 * Freelancer Subscribe to plan
 */
export const subscribeToPlan = async (req, res) => {
  const freelancerId = req.token?.userId;
  const { plan_id } = req.body;

  try {
    const { rows: existing } = await pool.query(
      `SELECT 1 FROM subscriptions WHERE freelancer_id = $1 AND status = 'active'`,
      [freelancerId]
    );
    if (existing.length)
      return res.status(400).json({
        success: false,
        message: "Already subscribed to an active plan.",
      });

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
