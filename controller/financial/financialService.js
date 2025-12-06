import pool from "../../models/db.js";

/**
 * @param {number} userId - User ID
 * @param {number} role - User role (2=client, 3=freelancer)
 * @returns {object} Financial overview
 */
const getFinancialOverview = async (userId, role) => {
  if (!userId || !role) throw new Error("Invalid parameters");

  let payments = [];
  let subscriptions = [];
  let escrow = [];
  let balance = 0;

  const walletRes = await pool.query(
    `SELECT balance FROM wallets WHERE user_id = $1`,
    [userId]
  );
  balance = walletRes.rows.length ? parseFloat(walletRes.rows[0].balance) : 0;

  const walletTx = await pool.query(
    `SELECT id AS transaction_id, amount, type, note, created_at AS date
     FROM wallet_transactions
     WHERE user_id = $1
     ORDER BY created_at DESC`,
    [userId]
  );

  if (role === 2) {
    // CLIENT: payments + escrow
    const paymentsRes = await pool.query(
      `SELECT
         p.id AS payment_id,
         p.project_id,
         p.amount,
         p.proof_url,
         p.payment_date AS date,
         CASE
           WHEN p.order_id IS NULL THEN 'pending'
           WHEN p.order_id = -1 THEN 'rejected'
           ELSE 'approved'
         END AS status
       FROM payments p
       WHERE p.payer_id = $1
       ORDER BY p.payment_date DESC`,
      [userId]
    );
    payments = paymentsRes.rows;

    const escrowRes = await pool.query(
      `SELECT id AS escrow_id, project_id, amount, status, created_at, released_at
       FROM escrow
       WHERE client_id = $1
       ORDER BY created_at DESC`,
      [userId]
    );
    escrow = escrowRes.rows;

  } else if (role === 3) {
    // FREELANCER: subscription payments + earned payments
    const subsRes = await pool.query(
      `SELECT s.id AS subscription_id, s.plan_id, s.start_date, s.end_date, s.status, p.amount, p.proof_url
       FROM subscriptions s
       LEFT JOIN payments p ON p.freelancer_id = s.freelancer_id
       WHERE s.freelancer_id = $1
       ORDER BY s.start_date DESC`,
      [userId]
    );
    subscriptions = subsRes.rows;

    const earnedPaymentsRes = await pool.query(
      `SELECT e.id AS escrow_id, e.project_id, e.amount, e.status, e.created_at, e.released_at
       FROM escrow e
       WHERE e.freelancer_id = $1 AND e.status = 'released'
       ORDER BY e.released_at DESC`,
      [userId]
    );
    payments = earnedPaymentsRes.rows;
  }

  // 3️⃣ Combine everything into a timeline
  const combined = [
    ...walletTx.rows.map(t => ({
      id: t.transaction_id,
      category: "wallet_transaction",
      type: t.type,
      note: t.note,
      amount: parseFloat(t.amount),
      date: t.date
    })),
    ...payments.map(p => ({
      id: p.payment_id || p.escrow_id,
      category: role === 2 ? "payment" : "earned_payment",
      project_id: p.project_id,
      amount: parseFloat(p.amount),
      proof_url: p.proof_url,
      status: p.status || p.status,
      date: p.payment_date || p.released_at || p.created_at
    })),
    ...subscriptions.map(s => ({
      id: s.subscription_id,
      category: "subscription",
      plan_id: s.plan_id,
      start_date: s.start_date,
      end_date: s.end_date,
      status: s.status,
      amount: s.amount,
      proof_url: s.proof_url,
      date: s.start_date
    })),
    ...escrow.map(e => ({
      id: e.escrow_id,
      category: "escrow",
      project_id: e.project_id,
      amount: parseFloat(e.amount),
      status: e.status,
      created_at: e.created_at,
      released_at: e.released_at,
      date: e.created_at
    }))
  ];

  combined.sort((a, b) => new Date(b.date) - new Date(a.date));

  return { balance, overview: combined };
};

/**
 * Wallet helpers
 */
const creditWallet = async (userId, amount, note) => {
  if (!userId || !amount || amount <= 0) throw new Error("Invalid parameters for creditWallet");
  await pool.query(
    `INSERT INTO wallet_transactions (user_id, amount, type, note, created_at)
     VALUES ($1, $2, 'credit', $3, CURRENT_TIMESTAMP)`,
    [userId, amount, note]
  );
  await pool.query(`UPDATE wallets SET balance = balance + $1 WHERE user_id = $2`, [amount, userId]);
  return true;
};

const debitWallet = async (userId, amount, note) => {
  if (!userId || !amount || amount <= 0) throw new Error("Invalid parameters for debitWallet");
  const walletRes = await pool.query(`SELECT balance FROM wallets WHERE user_id = $1`, [userId]);
  if (!walletRes.rows.length || walletRes.rows[0].balance < amount) throw new Error("Insufficient balance");

  await pool.query(
    `INSERT INTO wallet_transactions (user_id, amount, type, note, created_at)
     VALUES ($1, $2, 'debit', $3, CURRENT_TIMESTAMP)`,
    [userId, amount, note]
  );
  await pool.query(`UPDATE wallets SET balance = balance - $1 WHERE user_id = $2`, [amount, userId]);
  return true;
};

export { getFinancialOverview, creditWallet, debitWallet };
