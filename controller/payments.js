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
