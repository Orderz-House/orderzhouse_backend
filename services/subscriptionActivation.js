import pool from "../models/db.js";

/**
 * Activate subscription if it's pending_start and this is the freelancer's first acceptance.
 * This function should be called within a transaction context (client parameter).
 * 
 * @param {number} freelancerId - The freelancer's user ID
 * @param {object} client - PostgreSQL client (from pool.connect()) for transaction safety
 * @param {number} [excludeAssignmentId] - Optional assignment ID to exclude from first-acceptance check
 * @returns {Promise<{activated: boolean, subscription?: object}>}
 */
export const activateSubscriptionOnFirstAcceptance = async (freelancerId, client, excludeAssignmentId = null) => {
  try {
    // 1. Check if freelancer has a pending_start subscription
    // Guard: Only activate if start_date is NULL (not already activated)
    const { rows: subscriptionRows } = await client.query(
      `SELECT id, plan_id, status, start_date
       FROM subscriptions
       WHERE freelancer_id = $1
         AND status = 'pending_start'
         AND start_date IS NULL
       ORDER BY id DESC
       LIMIT 1`,
      [freelancerId]
    );

    if (subscriptionRows.length === 0) {
      return { activated: false, reason: "No pending_start subscription found or already activated" };
    }

    const subscription = subscriptionRows[0];

    // Guard: If start_date already exists, do not override
    if (subscription.start_date) {
      return { activated: false, reason: "Subscription already has start_date" };
    }

    // 2. Check if this is the freelancer's FIRST EVER acceptance
    // Look for any historical acceptance (status = 'active' indicates accepted assignment)
    // Exclude the current assignment if excludeAssignmentId is provided
    let previousAcceptanceQuery;
    let queryParams;
    
    if (excludeAssignmentId) {
      previousAcceptanceQuery = `
        SELECT id
        FROM project_assignments
        WHERE freelancer_id = $1
          AND status = 'active'
          AND id != $2
        LIMIT 1
      `;
      queryParams = [freelancerId, excludeAssignmentId];
    } else {
      // If no excludeAssignmentId, check for any previous acceptance
      // This is less safe but works if called before assignment is set to active
      previousAcceptanceQuery = `
        SELECT id
        FROM project_assignments
        WHERE freelancer_id = $1
          AND status = 'active'
        LIMIT 1
      `;
      queryParams = [freelancerId];
    }

    const { rows: previousAcceptanceRows } = await client.query(previousAcceptanceQuery, queryParams);

    // If there's a previous acceptance, this is NOT the first acceptance
    if (previousAcceptanceRows.length > 0) {
      return { activated: false, reason: "Not first acceptance" };
    }

    // 3. Fetch plan details to calculate end_date
    const { rows: planRows } = await client.query(
      `SELECT duration, plan_type
       FROM plans
       WHERE id = $1`,
      [subscription.plan_id]
    );

    if (planRows.length === 0) {
      return { activated: false, reason: "Plan not found" };
    }

    const plan = planRows[0];
    const duration = Number(plan.duration || 0);
    const planType = String(plan.plan_type || 'monthly').toLowerCase();

    if (duration <= 0) {
      return { activated: false, reason: "Invalid plan duration" };
    }

    // 4. Calculate end_date based on plan_type using SQL interval
    // Use PostgreSQL interval calculation to avoid timezone/month-length bugs
    const intervalUnit = planType === 'yearly' ? 'years' : 'months';
    const intervalString = `${duration} ${intervalUnit}`;

    // 5. Activate subscription: update status, dates
    // Use NOW() for start_date (timestamp) and calculate end_date using SQL interval
    // Example: NOW() + (1 || ' months')::interval for 1 month plan
    // Example: NOW() + (1 || ' years')::interval for 1 year plan
    const { rows: updatedRows } = await client.query(
      `UPDATE subscriptions
       SET status = 'active',
           start_date = NOW(),
           end_date = NOW() + ($2::text || ' ' || $3::text)::interval,
           updated_at = NOW()
       WHERE id = $1
         AND start_date IS NULL
       RETURNING id, status, start_date, end_date`,
      [subscription.id, duration.toString(), intervalUnit]
    );

    if (updatedRows.length === 0) {
      return { activated: false, reason: "Failed to update subscription (may have been activated concurrently)" };
    }

    return {
      activated: true,
      subscription: updatedRows[0],
    };
  } catch (error) {
    console.error("activateSubscriptionOnFirstAcceptance error:", error);
    return { activated: false, reason: error.message };
  }
};

/**
 * Legacy function name for backward compatibility.
 * This should be called OUTSIDE of a transaction (uses pool directly).
 * For new code, use activateSubscriptionOnFirstAcceptance within a transaction.
 */
export const activateSubscriptionIfPending = async (freelancerId) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await activateSubscriptionOnFirstAcceptance(freelancerId, client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("activateSubscriptionIfPending error:", error);
    return { activated: false, reason: error.message };
  } finally {
    client.release();
  }
};
