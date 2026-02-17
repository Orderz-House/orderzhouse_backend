import pool from "../models/db.js";

/* ============================================================
   HELPERS
============================================================ */
const requireRole = (req, role) => {
  if (req.token.role !== role) {
    throw new Error("Access denied");
  }
};

/* ============================================================
   1️⃣ CLIENT – PAYMENT HISTORY (Stripe only)
============================================================ */
export const getClientPayments = async (req, res) => {
  try {
    requireRole(req, 2);

    const userId = req.token.userId;

    const { rows } = await pool.query(
      `
      SELECT
        p.id,
        p.amount,
        p.currency,
        p.status,
        p.purpose,
        p.reference_id,
        p.created_at,
        pr.title AS project_title
      FROM payments p
      LEFT JOIN projects pr
        ON p.purpose = 'project' AND p.reference_id = pr.id
      WHERE p.user_id = $1
      ORDER BY p.created_at DESC
      `,
      [userId]
    );

    res.json({ success: true, payments: rows });

  } catch (err) {
    console.error("getClientPayments:", err);
    res.status(403).json({ success: false, message: err.message });
  }
};

/* ============================================================
   1️⃣ CLIENT – TOTAL SPENT (From Payments Table)
============================================================ */
export const getClientTotalSpent = async (req, res) => {
  try {
    requireRole(req, 2);

    const userId = req.token.userId;

    // Get total spent from payments table (only paid status)
    const { rows } = await pool.query(
      `
      SELECT COALESCE(SUM(amount), 0) AS total_spent
      FROM payments
      WHERE user_id = $1
        AND status = 'paid'
      `,
      [userId]
    );

    const totalSpent = Number(rows[0]?.total_spent || 0);

    res.json({ success: true, totalSpent });

  } catch (err) {
    console.error("getClientTotalSpent:", err);
    res.status(403).json({ success: false, message: err.message });
  }
};

/* ============================================================
   1️⃣ CLIENT – ESCROW SUMMARY (Financial Overview)
============================================================ */
export const getClientEscrowSummary = async (req, res) => {
  try {
    requireRole(req, 2);

    const userId = req.token.userId;

    // Get escrow summary: held, released, refunded
    const { rows } = await pool.query(
      `
      SELECT
        status,
        COALESCE(SUM(amount), 0) AS total_amount,
        COUNT(*) AS count
      FROM escrow
      WHERE client_id = $1
      GROUP BY status
      `,
      [userId]
    );

    // Calculate totals by status
    const summary = {
      held: 0,
      released: 0,
      refunded: 0,
    };

    rows.forEach((row) => {
      const status = String(row.status || "").toLowerCase();
      const amount = Number(row.total_amount || 0);
      
      if (status === "held") {
        summary.held = amount;
      } else if (status === "released") {
        summary.released = amount;
      } else if (status === "refunded") {
        summary.refunded = amount;
      }
    });

    res.json({ success: true, summary });

  } catch (err) {
    console.error("getClientEscrowSummary:", err);
    res.status(403).json({ success: false, message: err.message });
  }
};

/* ============================================================
   2️⃣ FREELANCER – WALLET BALANCE
============================================================ */
export const getFreelancerWallet = async (req, res) => {
  try {
    requireRole(req, 3);

    const userId = req.token.userId;

    const { rows } = await pool.query(
      `SELECT balance FROM wallets WHERE user_id = $1`,
      [userId]
    );

    res.json({
      success: true,
      balance: rows[0]?.balance || 0,
    });

  } catch (err) {
    console.error("getFreelancerWallet:", err);
    res.status(403).json({ success: false, message: err.message });
  }
};

/* ============================================================
   3️⃣ FREELANCER – WALLET TRANSACTIONS
============================================================ */
export const getFreelancerWalletTransactions = async (req, res) => {
  try {
    requireRole(req, 3);

    const userId = req.token.userId;

    const { rows } = await pool.query(
      `
      SELECT
        id,
        amount,
        type,
        note,
        created_at
      FROM wallet_transactions
      WHERE user_id = $1
      ORDER BY created_at DESC
      `,
      [userId]
    );

    res.json({ success: true, transactions: rows });

  } catch (err) {
    console.error("getFreelancerWalletTransactions:", err);
    res.status(403).json({ success: false, message: err.message });
  }
};

/* ============================================================
   4️⃣ ADMIN – ALL PAYMENTS
============================================================ */
export const adminGetAllPayments = async (req, res) => {
  try {
    requireRole(req, 1);

    const { rows } = await pool.query(
      `
      SELECT
        p.*,
        u.email AS user_email,
        pr.title AS project_title
      FROM payments p
      JOIN users u ON u.id = p.user_id
      LEFT JOIN projects pr ON pr.id = p.reference_id
      ORDER BY p.created_at DESC
      `
    );

    res.json({ success: true, payments: rows });

  } catch (err) {
    console.error("adminGetAllPayments:", err);
    res.status(403).json({ success: false, message: err.message });
  }
};

/* ============================================================
   5️⃣ ADMIN – CREATE ESCROW (AFTER PROJECT ASSIGNMENT)
============================================================ */
export const createEscrow = async (req, res) => {
  try {
    requireRole(req, 1);

    const { project_id, client_id, freelancer_id, amount, payment_id } =
      req.body;

    const { rows } = await pool.query(
      `
      INSERT INTO escrow (
        project_id,
        client_id,
        freelancer_id,
        amount,
        payment_id
      )
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
      `,
      [project_id, client_id, freelancer_id, amount, payment_id]
    );

    res.json({ success: true, escrow: rows[0] });

  } catch (err) {
    console.error("createEscrow:", err);
    res.status(500).json({ success: false, message: "Failed to create escrow" });
  }
};

/* ============================================================
   6️⃣ ADMIN – RELEASE ESCROW (PAY FREELANCER)
============================================================ */
export const releaseEscrow = async (req, res) => {
  try {
    requireRole(req, 1);

    const { escrow_id } = req.params;

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const { rows } = await client.query(
        `SELECT * FROM escrow WHERE id = $1 AND status = 'held'`,
        [escrow_id]
      );

      if (!rows.length) throw new Error("Escrow not found");

      const escrow = rows[0];

      // 1️⃣ Update escrow
      await client.query(
        `
        UPDATE escrow
        SET status = 'released', released_at = NOW()
        WHERE id = $1
        `,
        [escrow_id]
      );

      // 2️⃣ Ensure wallet exists
      await client.query(
        `
        INSERT INTO wallets (user_id, balance)
        VALUES ($1, 0)
        ON CONFLICT (user_id) DO NOTHING
        `,
        [escrow.freelancer_id]
      );

      // 3️⃣ Credit wallet
      await client.query(
        `
        UPDATE wallets
        SET balance = balance + $1
        WHERE user_id = $2
        `,
        [escrow.amount, escrow.freelancer_id]
      );

      // 4️⃣ Wallet transaction
      await client.query(
        `
        INSERT INTO wallet_transactions
          (user_id, amount, type, note)
        VALUES
          ($1, $2, 'credit', 'Project payment released')
        `,
        [escrow.freelancer_id, escrow.amount]
      );

      await client.query("COMMIT");

      res.json({ success: true });

    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }

  } catch (err) {
    console.error("releaseEscrow:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

/* ============================================================
   7️⃣ ADMIN – REFUND ESCROW
============================================================ */
export const refundEscrow = async (req, res) => {
  try {
    requireRole(req, 1);

    const { escrow_id } = req.params;

    await pool.query(
      `
      UPDATE escrow
      SET status = 'refunded'
      WHERE id = $1 AND status = 'held'
      `,
      [escrow_id]
    );

    res.json({ success: true });

  } catch (err) {
    console.error("refundEscrow:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

/* ============================================================
   8️⃣ UNIFIED – PAYMENT HISTORY (All transactions)
============================================================ */
export const getPaymentHistory = async (req, res) => {
  try {
    const userId = req.token.userId;
    const roleId = req.token.role;
    const { type = 'all', page = 1, limit = 50 } = req.query;

    // Fetch more records to combine and sort, then limit after
    const fetchLimit = type === 'all' ? Number(limit) * 2 : Number(limit);
    const transactions = [];

    // 1️⃣ Get payments (plan or project payments)
    if (type === 'all' || type === 'plan' || type === 'project') {
      let paymentQuery = `
        SELECT
          p.id,
          p.amount,
          p.currency,
          p.status,
          p.purpose,
          p.reference_id,
          p.stripe_session_id,
          p.stripe_payment_intent,
          p.created_at,
          pr.title AS project_title,
          pr.user_id AS project_client_id,
          e.id AS escrow_id,
          e.freelancer_id AS escrow_freelancer_id,
          e.status AS escrow_status,
          e.released_at AS escrow_released_at,
          pl.name AS plan_name,
          pl.duration AS plan_duration,
          pl.plan_type AS plan_type
        FROM payments p
        LEFT JOIN projects pr ON p.purpose = 'project' AND p.reference_id = pr.id
        LEFT JOIN escrow e ON p.id = e.payment_id
        LEFT JOIN plans pl ON p.purpose = 'plan' AND p.reference_id = pl.id
        WHERE p.user_id = $1
      `;

      const paymentParams = [userId];

      if (type === 'plan') {
        paymentQuery += ` AND p.purpose = 'plan'`;
      } else if (type === 'project') {
        paymentQuery += ` AND p.purpose = 'project'`;
      }

      paymentQuery += ` ORDER BY p.created_at DESC LIMIT $${paymentParams.length + 1}`;
      paymentParams.push(fetchLimit);

      const paymentRows = await pool.query(paymentQuery, paymentParams);

      for (const row of paymentRows.rows) {
        const transaction = {
          id: row.id,
          source: row.purpose, // 'plan' or 'project'
          amount: parseFloat(row.amount) || 0,
          currency: row.currency || 'JOD',
          status: row.escrow_status || row.status || 'paid', // Use escrow status if available
          createdAt: row.created_at,
          title: '',
          description: '',
          project: null,
          reference: {
            paymentId: row.id,
            purpose: row.purpose,
            referenceId: row.reference_id,
            stripeSessionId: row.stripe_session_id,
            stripePaymentIntent: row.stripe_payment_intent,
          },
        };

        // Build title and description based on purpose
        if (row.purpose === 'plan') {
          if (row.plan_name) {
            transaction.title = row.plan_name;
            if (row.plan_duration && row.plan_type) {
              const durationLabel = row.plan_type === 'monthly' 
                ? `${row.plan_duration} Month${row.plan_duration > 1 ? 's' : ''}`
                : `${row.plan_duration} Year${row.plan_duration > 1 ? 's' : ''}`;
              transaction.description = `Plan Subscription - ${durationLabel}`;
            } else {
              transaction.description = 'Plan Subscription';
            }
          } else {
            transaction.title = 'Plan Subscription';
            transaction.description = 'Subscription payment';
          }
        } else if (row.purpose === 'project') {
          transaction.title = row.project_title || 'Project Payment';
          
          // Build description with escrow status if available
          if (row.escrow_id) {
            const escrowStatus = row.escrow_status || 'held';
            if (escrowStatus === 'held') {
              transaction.description = 'Escrow held for project';
            } else if (escrowStatus === 'released') {
              transaction.description = 'Escrow released - payment completed';
            } else if (escrowStatus === 'refunded') {
              transaction.description = 'Escrow refunded';
            } else {
              transaction.description = 'Project payment';
            }
          } else {
            transaction.description = 'Project payment';
          }

          // Add project details
          if (row.project_title && row.reference_id) {
            transaction.project = {
              projectId: row.reference_id,
              title: row.project_title,
              clientId: row.project_client_id || null,
              freelancerId: row.escrow_freelancer_id || null,
            };
          }
        }

        transactions.push(transaction);
      }
    }

    // 2️⃣ Get wallet transactions (for freelancers only)
    if ((type === 'all' || type === 'wallet') && roleId === 3) {
      let walletQuery = `
        SELECT
          id,
          amount,
          type,
          note,
          created_at
        FROM wallet_transactions
        WHERE user_id = $1
        ORDER BY created_at DESC
        LIMIT $2
      `;

      const walletRows = await pool.query(walletQuery, [userId, fetchLimit]);

      for (const row of walletRows.rows) {
        transactions.push({
          id: row.id,
          source: 'wallet',
          amount: parseFloat(row.amount) || 0,
          currency: 'JOD',
          status: row.type === 'credit' ? 'paid' : 'debit',
          createdAt: row.created_at,
          title: 'Wallet Transaction',
          description: row.note || (row.type === 'credit' ? 'Wallet credit' : 'Wallet debit'),
          project: null,
          reference: {
            transactionId: row.id,
            type: row.type, // 'credit' or 'debit'
          },
        });
      }
    }

    // 3️⃣ Sort all transactions by date (newest first) and apply pagination
    transactions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    
    // Apply pagination
    const offset = (Number(page) - 1) * Number(limit);
    const paginatedTransactions = transactions.slice(offset, offset + Number(limit));

    // 4️⃣ Get wallet balance for freelancers
    let balance = 0;
    if (roleId === 3) {
      const walletResult = await pool.query(
        `SELECT balance FROM wallets WHERE user_id = $1`,
        [userId]
      );
      balance = parseFloat(walletResult.rows[0]?.balance || 0);
    }

    res.json({
      success: true,
      balance: balance,
      currency: 'JOD',
      transactions: paginatedTransactions,
    });

  } catch (err) {
    console.error("getPaymentHistory:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};