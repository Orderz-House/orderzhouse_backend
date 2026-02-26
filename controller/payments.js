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

    const balance = Number(rows[0]?.balance ?? 0);
    res.json({
      success: true,
      balance,
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

    const [txResult, walletResult] = await Promise.all([
      pool.query(
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
      ),
      pool.query(`SELECT balance FROM wallets WHERE user_id = $1`, [userId]),
    ]);

    const rows = txResult.rows;
    const balance = Number(walletResult.rows[0]?.balance ?? 0);

    res.json({ success: true, balance, transactions: rows });

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
   ADMIN – One-time repair: release stuck escrow for completed projects
   Input: optional body { projectId } or query ?projectId=416 to release one project; else all stuck.
   Idempotent: safe to run multiple times.
============================================================ */
export const releaseHeldEscrowForCompletedProjects = async (req, res) => {
  try {
    if (Number(req.token.role) !== 1) {
      return res.status(403).json({ success: false, message: "Admin only" });
    }

    const { releaseEscrowToFreelancer } = await import("../services/escrowService.js");

    const singleProjectId = Number(req.body?.projectId) || Number(req.query?.projectId) || null;

    let stuck;
    if (singleProjectId) {
      const { rows } = await pool.query(
        `SELECT e.id AS escrow_id, e.project_id, e.freelancer_id, e.amount
         FROM escrow e
         INNER JOIN projects p ON p.id = e.project_id AND p.is_deleted = false
         WHERE e.project_id = $1 AND e.status = 'held'
           AND (LOWER(COALESCE(p.completion_status, '')) = 'completed' OR LOWER(COALESCE(p.status, '')) = 'completed')`,
        [singleProjectId]
      );
      stuck = rows;
    } else {
      const { rows } = await pool.query(
        `SELECT e.id AS escrow_id, e.project_id, e.freelancer_id, e.amount
         FROM escrow e
         INNER JOIN projects p ON p.id = e.project_id AND p.is_deleted = false
         WHERE e.status = 'held'
           AND (LOWER(COALESCE(p.completion_status, '')) = 'completed' OR LOWER(COALESCE(p.status, '')) = 'completed')`
      );
      stuck = rows;
    }

    const results = [];
    for (const row of stuck) {
      const projectId = row.project_id;
      try {
        const result = await releaseEscrowToFreelancer(projectId);
        if (result.released) {
          try {
            await pool.query(
              `UPDATE projects SET payment_released_at = NOW() WHERE id = $1`,
              [projectId]
            );
          } catch (upErr) {
            console.warn("[releaseHeldEscrow] payment_released_at update failed for project", projectId, upErr.message);
          }
        }
        results.push({
          projectId,
          freelancerId: row.freelancer_id,
          amount: row.amount,
          released: result.released,
          alreadyReleased: result.alreadyReleased ?? false,
          reason: result.reason ?? null,
        });
      } catch (err) {
        results.push({
          projectId,
          freelancerId: row.freelancer_id,
          amount: row.amount,
          released: false,
          error: err.message,
        });
      }
    }

    return res.json({
      success: true,
      message: singleProjectId
        ? `Processed project ${singleProjectId} (${results.length} row(s)).`
        : `Processed ${stuck.length} completed project(s) with held escrow`,
      count: stuck.length,
      results,
    });
  } catch (err) {
    console.error("releaseHeldEscrowForCompletedProjects:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

/* ============================================================
   8️⃣ GET /payments/history – real wallet-based data (no TEMP placeholder)
   Uses wallets + wallet_transactions for authenticated user.
============================================================ */
export const getPaymentHistory = async (req, res) => {
  try {
    const userId = req.token?.userId ?? req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const { page = 1, limit = 50 } = req.query;
    const offset = Math.max(0, (Number(page) - 1) * Number(limit));
    const limitNum = Math.min(100, Math.max(1, Number(limit)));

    // [TEMP DEBUG]
    console.log("[getPaymentHistory] req.user.id / req.token.userId:", req.user?.id ?? req.token?.userId);

    // 1) Wallet balance: wallets where user_id = current user
    const walletResult = await pool.query(
      `SELECT balance FROM wallets WHERE user_id = $1`,
      [userId]
    );
    const walletRow = walletResult.rows[0] ?? null;
    const balance = Number(walletRow?.balance ?? 0);

    // [TEMP DEBUG]
    console.log("[getPaymentHistory] wallet row found:", !!walletRow, "balance:", balance);

    // 2) Transaction rows: wallet_transactions where user_id = current user, newest first
    const txResult = await pool.query(
      `SELECT id, amount, type, note, created_at
       FROM wallet_transactions
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limitNum, offset]
    );
    const rows = txResult.rows || [];

    // [TEMP DEBUG]
    console.log("[getPaymentHistory] transactions count:", rows.length);

    // 3) Map to UI table fields: id, purpose, reference, amount, status, date
    const transactions = rows.map((row) => ({
      id: row.id,
      purpose: row.note ? (row.note.length > 80 ? row.note.slice(0, 80) + "…" : row.note) : (row.type === "credit" ? "Wallet credit" : "Wallet debit"),
      reference: row.type === "credit" ? "Credit" : "Debit",
      amount: Number(row.amount) || 0,
      status: row.type === "credit" ? "paid" : "debit",
      date: row.created_at,
      created_at: row.created_at,
      source: "wallet",
      reference_id: row.id,
    }));

    const response = {
      success: true,
      balance,
      totalAmount: balance,
      availableToWithdraw: balance,
      currency: "JOD",
      totals: { available: balance, totalAmount: balance },
      transactions,
    };

    res.json(response);
  } catch (err) {
    console.error("getPaymentHistory:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};