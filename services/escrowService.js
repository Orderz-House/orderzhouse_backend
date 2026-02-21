import pool from "../models/db.js";

/**
 * Ensure wallet exists for user (create if missing)
 */
export const ensureWallet = async (userId, client = null) => {
  const queryClient = client || pool;
  await queryClient.query(
    `INSERT INTO wallets (user_id, balance) VALUES ($1, 0)
     ON CONFLICT (user_id) DO NOTHING`,
    [userId]
  );
};

/**
 * Create escrow with status 'held'
 * Idempotent: if escrow exists for (project_id, payment_id), do nothing
 */
export const createEscrowHeld = async ({ projectId, clientId, freelancerId, amount, paymentId }, client = null) => {
  const queryClient = client || pool;
  
  if (paymentId) {
    // For projects with payment_id (fixed/hourly paid projects)
    await queryClient.query(
      `INSERT INTO escrow (project_id, client_id, freelancer_id, amount, status, payment_id)
       VALUES ($1, $2, $3, $4, 'held', $5)
       ON CONFLICT (project_id, payment_id) DO NOTHING`,
      [projectId, clientId, freelancerId, amount, paymentId]
    );
  } else {
    // For bidding projects without payment_id.
    // Avoid ON CONFLICT (project_id) WHERE payment_id IS NULL so we don't depend on
    // the partial unique index existing (migration may not have been run).
    const exists = await queryClient.query(
      `SELECT id FROM escrow WHERE project_id = $1 AND payment_id IS NULL LIMIT 1`,
      [projectId]
    );
    if (exists.rows.length === 0) {
      await queryClient.query(
        `INSERT INTO escrow (project_id, client_id, freelancer_id, amount, status)
         VALUES ($1, $2, $3, $4, 'held')`,
        [projectId, clientId, freelancerId, amount]
      );
    }
  }
};

/**
 * Release escrow to freelancer wallet (transactional + idempotent)
 * Uses SELECT FOR UPDATE to prevent double release
 */
export const releaseEscrowToFreelancer = async (projectId, client = null) => {
  const queryClient = client || pool;
  const shouldCommit = !client; // If no client provided, we manage transaction
  
  try {
    if (shouldCommit) {
      await queryClient.query("BEGIN");
    }

    // Lock escrow row to prevent concurrent release
    const escrowResult = await queryClient.query(
      `SELECT id, freelancer_id, amount, status, payment_id
       FROM escrow
       WHERE project_id = $1 AND status = 'held'
       FOR UPDATE`,
      [projectId]
    );

    if (escrowResult.rows.length === 0) {
      if (shouldCommit) await queryClient.query("ROLLBACK");
      return { released: false, reason: "No held escrow found" };
    }

    const escrow = escrowResult.rows[0];

    // Idempotency check: already released
    if (escrow.status === 'released') {
      if (shouldCommit) await queryClient.query("ROLLBACK");
      return { released: false, reason: "Escrow already released" };
    }

    // Update escrow status
    await queryClient.query(
      `UPDATE escrow 
       SET status = 'released', released_at = NOW()
       WHERE id = $1`,
      [escrow.id]
    );

    // Ensure wallet exists
    await ensureWallet(escrow.freelancer_id, queryClient);

    // Credit freelancer wallet
    await queryClient.query(
      `UPDATE wallets 
       SET balance = balance + $1, updated_at = NOW()
       WHERE user_id = $2`,
      [escrow.amount, escrow.freelancer_id]
    );

    // Record transaction
    await queryClient.query(
      `INSERT INTO wallet_transactions (user_id, amount, type, note)
       VALUES ($1, $2, 'credit', $3)`,
      [escrow.freelancer_id, escrow.amount, `Escrow released for project #${projectId}`]
    );

    if (shouldCommit) {
      await queryClient.query("COMMIT");
    }

    return { 
      released: true, 
      freelancerId: escrow.freelancer_id, 
      amount: escrow.amount 
    };
  } catch (error) {
    if (shouldCommit) {
      await queryClient.query("ROLLBACK");
    }
    throw error;
  }
};
