import pool from "../models/db.js";
import eventBus from "../events/eventBus.js";
import { NotificationCreators } from "../services/notificationService.js"; // تركتها زي ما هي (حتى لو ما عاد تُستخدم)

/**
 * -------------------------------
 * GET ALL PROJECTS FOR OFFER
 * -------------------------------
 */
export const getAllProjectForOffer = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT p.*, u.id AS user_id, u.first_name, u.last_name, u.email, u.username
       FROM projects p
       JOIN users u ON u.id = p.user_id
       WHERE p.status = 'bidding'`
    );

    res.status(200).json({
      success: true,
      message: "All projects open for bidding",
      projects: result.rows,
    });
  } catch (err) {
    console.error("getAllProjectForOffer error:", err);
    res.status(500).json({
      success: false,
      message: "Server Error",
      error: err,
    });
  }
};

/**
 * -------------------------------
 * SEND OFFER (FREELANCER)
 * -------------------------------
 */
export const sendOffer = async (req, res) => {
  try {
    const freelancerId = req.token?.userId;
    const freelancerName = req.token?.username || "Freelancer";
    const { projectId } = req.params;

    const bid_amount =
      req.body.bid_amount ?? req.body.offer_amount ?? null;
    const proposal = req.body.proposal ?? "";

    if (!freelancerId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    // ✅ Enforce subscription restriction (server-side)
    const { canApplyToProjects } = await import("../utils/subscriptionCheck.js");
    const subscriptionCheck = await canApplyToProjects(freelancerId);
    if (!subscriptionCheck.canApply) {
      return res.status(403).json({
        success: false,
        message: subscriptionCheck.reason === "No subscription found"
          ? "You need an active subscription or pending subscription to submit offers"
          : subscriptionCheck.reason === "Subscription expired"
          ? "Your subscription has expired. Please renew to continue submitting offers"
          : "You cannot submit offers at this time",
      });
    }

    if (!projectId || bid_amount === null) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields",
      });
    }

    const bid = Number(bid_amount);
    if (!Number.isFinite(bid) || bid <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid bid amount",
      });
    }

    // ============================
    // Fetch project
    // ============================
    const projectQuery = await pool.query(
      `SELECT user_id, title, status, budget_min, budget_max
       FROM projects
       WHERE id = $1 AND is_deleted = false`,
      [projectId]
    );

    if (!projectQuery.rows.length) {
      return res.status(404).json({
        success: false,
        message: "Project not found",
      });
    }

    const project = projectQuery.rows[0];

    if (project.status !== "bidding") {
      return res.status(400).json({
        success: false,
        message: "Project not open for bidding",
      });
    }

    // ============================
    // Budget validation
    // ============================
    if (
      (project.budget_min !== null &&
        bid < Number(project.budget_min)) ||
      (project.budget_max !== null &&
        bid > Number(project.budget_max))
    ) {
      return res.status(400).json({
        success: false,
        message: `Bid must be between ${project.budget_min} and ${project.budget_max}`,
      });
    }

    // ============================
    // ✅ CORRECT offer check
    // ============================
    const existingOffer = await pool.query(
      `SELECT id
       FROM offers
       WHERE project_id = $1
         AND freelancer_id = $2
         AND offer_status IN ('pending', 'accepted')
       LIMIT 1`,
      [projectId, freelancerId]
    );

    if (existingOffer.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: "You have already submitted an offer for this project",
      });
    }

    // ============================
    // Insert offer
    // ============================
    const insertQuery = await pool.query(
      `INSERT INTO offers (
        freelancer_id,
        project_id,
        bid_amount,
        proposal,
        offer_status
      )
      VALUES ($1, $2, $3, $4, 'pending')
      RETURNING *`,
      [freelancerId, projectId, bid, proposal]
    );

    const newOffer = insertQuery.rows[0];

    try {
      eventBus.emit("offer.submitted", {
        offerId: newOffer.id,
        projectId,
        projectTitle: project.title,
        clientId: project.user_id,
        freelancerId,
        freelancerName,
        bidAmount: bid,
      });
    } catch (e) {
      console.error("eventBus error on offer.submitted:", e);
    }

    return res.status(201).json({
      success: true,
      message: "Offer sent successfully",
      offer: newOffer,
    });
  } catch (err) {
    console.error("sendOffer error:", err);
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};


/**
 * إتمام قبول العرض بعد دفع العميل للمبلغ (يُستدعى من تأكيد الدفع Stripe)
 */
export const completeOfferAcceptance = async (offerId) => {
  const client = await pool.connect();
  try {
    const { rows: offerRows } = await client.query(
      `SELECT o.*, p.user_id AS client_id, p.title AS project_title, p.project_type
       FROM offers o
       JOIN projects p ON o.project_id = p.id
       WHERE o.id = $1`,
      [offerId]
    );
    if (!offerRows.length) throw new Error("Offer not found");
    const offer = offerRows[0];
    if (String(offer.offer_status) === "accepted") return; // already done (idempotent)

    await client.query("BEGIN");

    const { rows: otherPendingOffers } = await client.query(
      `SELECT id, freelancer_id FROM offers
       WHERE project_id = $1 AND id <> $2 AND offer_status = 'pending'`,
      [offer.project_id, offerId]
    );

    await client.query(
      `UPDATE offers SET offer_status = 'accepted' WHERE id = $1`,
      [offerId]
    );
    await client.query(
      `UPDATE offers SET offer_status = 'rejected'
       WHERE project_id = $1 AND id <> $2 AND offer_status = 'pending'`,
      [offer.project_id, offerId]
    );

    const { rows: tenderCheck } = await client.query(
      `SELECT tv.id, tcy.order_id AS temp_project_id
       FROM tender_vault_projects tv
       JOIN tender_vault_cycles tcy ON tcy.tender_id = tv.id
       WHERE tcy.order_id = $1 AND tv.status = 'active' AND tcy.status = 'active'`,
      [offer.project_id]
    );

    if (tenderCheck.length > 0) {
      const { convertTenderToOrder } = await import("../services/tenderVaultRotation.js");
      await convertTenderToOrder(tenderCheck[0].id, offer.freelancer_id, offer.id);
    } else {
      await client.query(
        `UPDATE projects SET status = 'in_progress', completion_status = 'in_progress', updated_at = NOW()
         WHERE id = $1 AND is_deleted = false AND project_type = 'bidding'`,
        [offer.project_id]
      );
    }

    let assignmentId = null;
    try {
      const { rows: insertRows } = await client.query(
        `INSERT INTO project_assignments (project_id, freelancer_id, status, assigned_at)
         VALUES ($1, $2, 'active', NOW())
         RETURNING id`,
        [offer.project_id, offer.freelancer_id]
      );
      assignmentId = insertRows[0]?.id || null;
    } catch (assignErr) {
      if (assignErr.code === "23505") {
        const { rows: updateRows } = await client.query(
          `UPDATE project_assignments SET status = 'active', assigned_at = NOW()
           WHERE project_id = $1 AND freelancer_id = $2
           RETURNING id`,
          [offer.project_id, offer.freelancer_id]
        );
        assignmentId = updateRows[0]?.id || null;
      } else throw assignErr;
    }

    // B) Create escrow when freelancer is assigned (for bidding projects)
    // Get payment_id if project was paid (for fixed/hourly projects)
    const paymentResult = await client.query(
      `SELECT id, amount FROM payments 
       WHERE reference_id = $1 AND purpose = 'project' AND status = 'paid' 
       ORDER BY created_at DESC LIMIT 1`,
      [offer.project_id]
    );
    const paymentId = paymentResult.rows[0]?.id || null;
    const escrowAmount = paymentId ? paymentResult.rows[0].amount : offer.bid_amount;

    const { createEscrowHeld } = await import("../services/escrowService.js");
    await createEscrowHeld({
      projectId: offer.project_id,
      clientId: offer.client_id,
      freelancerId: offer.freelancer_id,
      amount: escrowAmount,
      paymentId,
    }, client);

    // ✅ Activate subscription if pending_start and this is first acceptance (within transaction)
    const { activateSubscriptionOnFirstAcceptance } = await import("../services/subscriptionActivation.js");
    const subscriptionActivation = await activateSubscriptionOnFirstAcceptance(
      offer.freelancer_id,
      client,
      assignmentId
    );

    try {
      eventBus.emit("offer.statusChanged", {
        offerId: offer.id,
        projectId: offer.project_id,
        projectTitle: offer.project_title,
        freelancerId: offer.freelancer_id,
        accepted: true,
      });
      eventBus.emit("freelancer.assignmentChanged", {
        projectId: offer.project_id,
        projectTitle: offer.project_title,
        freelancerId: offer.freelancer_id,
        assigned: true,
      });
      eventBus.emit("escrow.funded", {
        projectId: offer.project_id,
        projectTitle: offer.project_title,
        freelancerId: offer.freelancer_id,
        amount: offer.bid_amount,
      });
      for (const o of otherPendingOffers || []) {
        eventBus.emit("offer.statusChanged", {
          offerId: o.id,
          projectId: offer.project_id,
          projectTitle: offer.project_title,
          freelancerId: o.freelancer_id,
          accepted: false,
          autoRejected: true,
        });
      }
    } catch (e) {
      console.error("eventBus error (completeOfferAcceptance):", e);
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

/**
 * -------------------------------
 * APPROVE OR REJECT OFFER (CLIENT)
 * -------------------------------
 * For bidding: accept → requires payment; after payment, completeOfferAcceptance is called.
 */
export const approveOrRejectOffer = async (req, res) => {
  const client = await pool.connect();
  try {
    const clientId = req.token?.userId;
    const { offerId, action } = req.body;

    if (!clientId)
      return res.status(401).json({ success: false, message: "Unauthorized" });

    if (!["accept", "reject"].includes(action))
      return res.status(400).json({ success: false, message: "Invalid action" });

    const { rows: offerRows } = await client.query(
      `SELECT o.*, p.user_id AS client_id, p.title AS project_title, p.project_type
       FROM offers o
       JOIN projects p ON o.project_id = p.id
       WHERE o.id = $1`,
      [offerId]
    );

    if (!offerRows.length)
      return res.status(404).json({ success: false, message: "Offer not found" });

    const offer = offerRows[0];
    if (String(offer.client_id) !== String(clientId))
      return res.status(403).json({ success: false, message: "Not authorized" });

    if (action === "accept" && String(offer.project_type) === "bidding") {
      // Bidding: no Stripe; client accepts → project goes to admin approval, client sees payment panel (CliQ/Cash)
      await client.query("BEGIN");

      const { rows: acceptedCheck } = await client.query(
        `SELECT id FROM offers WHERE project_id = $1 AND offer_status = 'accepted'`,
        [offer.project_id]
      );

      if (acceptedCheck.length > 0) {
        await client.query("ROLLBACK");
        client.release();
        return res.status(400).json({
          success: false,
          message: "Only one offer can be accepted per project",
        });
      }

      await client.query(
        `UPDATE offers SET offer_status = 'accepted' WHERE id = $1`,
        [offerId]
      );

      await client.query(
        `UPDATE offers SET offer_status = 'rejected'
         WHERE project_id = $1 AND id <> $2 AND offer_status = 'pending'`,
        [offer.project_id, offerId]
      );

      // Set project to pending_admin_approval (only status + updated_at to avoid schema issues)
      await client.query(
        `UPDATE projects SET status = 'pending_admin_approval', updated_at = NOW() WHERE id = $1`,
        [offer.project_id]
      );
        
        // Create assignment with pending status (not active yet)
        let assignmentId = null;
        try {
          const { rows: insertRows } = await client.query(
            `INSERT INTO project_assignments (project_id, freelancer_id, status, assigned_at)
             VALUES ($1, $2, 'pending_admin_approval', NOW())
             RETURNING id`,
            [offer.project_id, offer.freelancer_id]
          );
          assignmentId = insertRows[0]?.id || null;
        } catch (assignErr) {
          if (assignErr.code === "23505") {
            const { rows: updateRows } = await client.query(
              `UPDATE project_assignments 
               SET status = 'pending_admin_approval', assigned_at = NOW()
               WHERE project_id = $1 AND freelancer_id = $2
               RETURNING id`,
              [offer.project_id, offer.freelancer_id]
            );
            assignmentId = updateRows[0]?.id || null;
          } else throw assignErr;
        }
        
        // Emit events
        try {
          eventBus.emit("offer.statusChanged", {
            offerId: offer.id,
            projectId: offer.project_id,
            projectTitle: offer.project_title,
            freelancerId: offer.freelancer_id,
            accepted: true,
            pendingAdminApproval: true,
          });
          
          const { rows: otherPendingOffers } = await client.query(
            `SELECT id, freelancer_id FROM offers
             WHERE project_id = $1 AND id <> $2 AND offer_status = 'pending'`,
            [offer.project_id, offerId]
          );
          
          for (const o of otherPendingOffers || []) {
            eventBus.emit("offer.statusChanged", {
              offerId: o.id,
              projectId: offer.project_id,
              projectTitle: offer.project_title,
              freelancerId: o.freelancer_id,
              accepted: false,
              autoRejected: true,
            });
          }
        } catch (e) {
          console.error("eventBus error (approveOrRejectOffer):", e);
        }
        
        await client.query("COMMIT");
        client.release();
        
      return res.json({
        success: true,
        pendingAdminApproval: true,
        showPaymentPanel: true,
        projectId: offer.project_id,
        message: "Offer accepted. Choose payment method (CliQ/Cash). Project is pending admin approval.",
      });
    }

    await client.query("BEGIN");

    if (action === "reject") {
      await client.query(
        `UPDATE offers SET offer_status = 'rejected' WHERE id = $1`,
        [offerId]
      );

      try {
        eventBus.emit("offer.statusChanged", {
          offerId: offer.id,
          projectId: offer.project_id,
          projectTitle: offer.project_title,
          freelancerId: offer.freelancer_id,
          accepted: false,
        });
      } catch (e) {
        console.error("eventBus error offer.statusChanged(reject):", e);
      }

      await client.query("COMMIT");
      return res.json({ success: true, message: "Offer rejected" });
    }

    if (action === "accept") {
      const acceptedOffer = await client.query(
        `SELECT id FROM offers WHERE project_id = $1 AND offer_status = 'accepted'`,
        [offer.project_id]
      );

      if (acceptedOffer.rows.length > 0) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          success: false,
          message: "Only one offer can be accepted per project",
        });
      }

      const activeAssignment = await client.query(
        `SELECT id
           FROM project_assignments
          WHERE freelancer_id = $1
            AND status IN ('active', 'pending_acceptance', 'in_progress')`,
        [offer.freelancer_id]
      );

      if (activeAssignment.rows.length > 0) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          success: false,
          message:
            "This freelancer is already assigned to another active or pending project.",
        });
      }

      const { rows: otherPendingOffers } = await client.query(
        `SELECT id, freelancer_id
           FROM offers
          WHERE project_id = $1
            AND id <> $2
            AND offer_status = 'pending'`,
        [offer.project_id, offerId]
      );

      await client.query(
        `UPDATE offers SET offer_status = 'accepted' WHERE id = $1`,
        [offerId]
      );

      await client.query(
        `UPDATE offers
            SET offer_status = 'rejected'
          WHERE project_id = $1
            AND id <> $2
            AND offer_status = 'pending'`,
        [offer.project_id, offerId]
      );

      // Check if this is a tender vault project (active tender)
      // Look for temp_project_id in tender_vault_cycles
      const { rows: tenderCheck } = await client.query(
        `SELECT tv.id, tcy.order_id AS temp_project_id
         FROM tender_vault_projects tv
         JOIN tender_vault_cycles tcy ON tcy.tender_id = tv.id
         WHERE tcy.order_id = $1 AND tv.status = 'active' AND tcy.status = 'active'`,
        [offer.project_id]
      );

      if (tenderCheck.length > 0) {
        // This is an active tender - convert to order
        const { convertTenderToOrder } = await import("../services/tenderVaultRotation.js");
        await convertTenderToOrder(tenderCheck[0].id, offer.freelancer_id, offer.id);
        console.log(`✅ Tender ${tenderCheck[0].id} converted to order ${offer.project_id} after offer acceptance`);
      } else {
        // Normal project - update status
        await client.query(
          `UPDATE projects
              SET status = 'in_progress',
                  completion_status = 'in_progress',
                  updated_at = NOW()
            WHERE id = $1
              AND is_deleted = false
              AND project_type = 'bidding'`,
          [offer.project_id]
        );
      }

      try {
        await client.query(
          `INSERT INTO project_assignments (project_id, freelancer_id, status, assigned_at)
           VALUES ($1, $2, 'active', NOW())`,
          [offer.project_id, offer.freelancer_id]
        );
      } catch (assignErr) {
        if (assignErr.code === "23505") {
          await client.query(
            `UPDATE project_assignments
                SET status = 'active', assigned_at = NOW()
              WHERE project_id = $1 AND freelancer_id = $2`,
            [offer.project_id, offer.freelancer_id]
          );
        } else {
          throw assignErr;
        }
      }

      try {
        await client.query(
          `INSERT INTO escrow (project_id, client_id, freelancer_id, amount, status)
           VALUES ($1, $2, $3, $4, 'held')`,
          [offer.project_id, offer.client_id, offer.freelancer_id, offer.bid_amount]
        );
      } catch (escrowErr) {
        if (escrowErr.code === "23505") {
          await client.query(
            `UPDATE escrow
                SET amount = $2, status = 'held'
              WHERE project_id = $1`,
            [offer.project_id, offer.bid_amount]
          );
        } else {
          throw escrowErr;
        }
      }

      try {
        eventBus.emit("offer.statusChanged", {
          offerId: offer.id,
          projectId: offer.project_id,
          projectTitle: offer.project_title,
          freelancerId: offer.freelancer_id,
          accepted: true,
        });

        eventBus.emit("freelancer.assignmentChanged", {
          projectId: offer.project_id,
          projectTitle: offer.project_title,
          freelancerId: offer.freelancer_id,
          assigned: true,
        });

        eventBus.emit("escrow.funded", {
          projectId: offer.project_id,
          projectTitle: offer.project_title,
          freelancerId: offer.freelancer_id,
          amount: offer.bid_amount,
        });

        if (Array.isArray(otherPendingOffers)) {
          for (const o of otherPendingOffers) {
            eventBus.emit("offer.statusChanged", {
              offerId: o.id,
              projectId: offer.project_id,
              projectTitle: offer.project_title,
              freelancerId: o.freelancer_id,
              accepted: false,
              autoRejected: true,
            });
          }
        }
      } catch (e) {
        console.error("eventBus error (non-critical):", e);
      }

      await client.query("COMMIT");
      return res.json({
        success: true,
        message:
          "Offer accepted, project started, other offers rejected, freelancer assigned, escrow funded",
      });
    }
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("approveOrRejectOffer error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  } finally {
    client.release();
  }
};


/**
 * -------------------------------
 * GET MY OFFERS (FREELANCER)
 * -------------------------------
 */
export const getMyOffersForProject = async (req, res) => {
  try {
    const freelancerId = req.token?.userId;
    const { projectId } = req.params;

    if (!freelancerId)
      return res.status(401).json({ success: false, message: "Unauthorized" });
    if (!projectId)
      return res.status(400).json({ success: false, message: "Missing projectId" });

    const offersQuery = await pool.query(
      `SELECT o.id, o.freelancer_id, o.bid_amount, o.proposal, o.offer_status, o.created_at,
              p.title AS project_title, p.budget_min, p.budget_max
       FROM offers o
       JOIN projects p ON o.project_id = p.id
       WHERE o.project_id = $1 AND o.freelancer_id = $2
       ORDER BY o.created_at DESC`,
      [projectId, freelancerId]
    );

    res.status(200).json({ success: true, offers: offersQuery.rows });
  } catch (err) {
    console.error("getMyOffersForProject error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * -------------------------------
 * GET OFFERS FOR MY PROJECTS (CLIENT)
 * -------------------------------
 */
export const getOffersForMyProjects = async (req, res) => {
  try {
    const ownerId = req.token?.userId;
    if (!ownerId)
      return res.status(401).json({ success: false, message: "Unauthorized" });

    const offersQuery = await pool.query(
      `SELECT 
         o.id AS offer_id,
         o.freelancer_id,
         o.project_id,
         o.bid_amount,
         o.proposal,
         o.offer_status
       FROM offers o
       JOIN projects p ON o.project_id = p.id
       WHERE p.user_id = $1
       ORDER BY o.id DESC`,
      [ownerId]
    );

    res.status(200).json({ success: true, data: offersQuery.rows, message: "Offers fetched successfully" });
  } catch (err) {
    console.error("getOffersForMyProjects error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * -------------------------------
 * GET OFFERS FOR A SPECIFIC PROJECT (CLIENT VIEW)
 * -------------------------------
 */
export const getOffersForProject = async (req, res) => {
  try {
    const ownerId = req.token?.userId;
    const { projectId } = req.params;

    if (!ownerId)
      return res.status(401).json({ success: false, message: "Unauthorized" });
    if (!projectId)
      return res
        .status(400)
        .json({ success: false, message: "Missing projectId" });

    const proj = await pool.query(
      `SELECT id, user_id, title 
       FROM projects 
       WHERE id = $1 AND is_deleted = false`,
      [projectId]
    );

    if (!proj.rows.length)
      return res
        .status(404)
        .json({ success: false, message: "Project not found" });

    if (String(proj.rows[0].user_id) !== String(ownerId))
      return res.status(403).json({
        success: false,
        message: "Not authorized to view offers for this project",
      });

    const q = `
      SELECT 
        o.*,
        u.first_name,
        u.last_name,
        u.first_name || ' ' || u.last_name AS freelancer_name,
        u.email AS freelancer_email,
        u.username,
        p.title AS project_title
      FROM offers o
      JOIN projects p ON o.project_id = p.id
      JOIN users u ON o.freelancer_id = u.id
      WHERE o.project_id = $1
      ORDER BY o.id DESC
    `;

    const { rows } = await pool.query(q, [projectId]);

    return res.status(200).json({
      success: true,
      data: rows,
      message: "Offers fetched successfully",
    });
  } catch (err) {
    console.error("getOffersForProject error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * Allows a freelancer to withdraw their pending offer
 */
export const cancelOffer = async (req, res) => {
  try {
    const freelancerId = req.token?.userId;
    const freelancerName = req.token?.username || "Freelancer";
    const { offerId } = req.params;

    const { rows } = await pool.query(
      `SELECT * FROM offers WHERE id = $1 AND freelancer_id = $2`,
      [offerId, freelancerId]
    );

    if (!rows.length)
      return res.status(404).json({ success: false, message: "Offer not found" });

    const offer = rows[0];
    if (offer.offer_status !== "pending")
      return res
        .status(400)
        .json({ success: false, message: "Only pending offers can be cancelled" });

    await pool.query(
      `UPDATE offers SET offer_status = 'withdrawn', updated_at = NOW() WHERE id = $1`,
      [offerId]
    );

    try {
      const { rows: proj } = await pool.query(
        `SELECT user_id, title FROM projects WHERE id = $1`,
        [offer.project_id]
      );
      const projectTitle = proj?.[0]?.title || null;
      const clientId = proj?.[0]?.user_id || null;

      eventBus.emit("offer.withdrawn", {
        offerId,
        projectId: offer.project_id,
        projectTitle,
        freelancerId,
        freelancerName,
        clientId,
      });
    } catch (e) {
      console.error("eventBus error offer.withdrawn:", e);
    }

    res.json({ success: true, message: "Offer withdrawn successfully" });
  } catch (err) {
    console.error("cancelOffer error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * Auto-expire old offers (runs on schedule)
 */
export const autoExpireOldOffers = async () => {
  try {
    const { rows } = await pool.query(
      `UPDATE offers 
       SET offer_status = 'expired', updated_at = NOW()
       WHERE offer_status = 'pending'
         AND (
           created_at <= NOW() - INTERVAL '7 days'
           OR project_id IN (SELECT id FROM projects WHERE status != 'bidding')
         )
       RETURNING id, freelancer_id, project_id`
    );

    if (rows.length > 0) {
      console.log(`Auto-expired ${rows.length} old offers`);

      for (const r of rows) {
        try {
          const { rows: p } = await pool.query(
            `SELECT title FROM projects WHERE id = $1`,
            [r.project_id]
          );
          const title = p?.[0]?.title || null;

          eventBus.emit("offer.expired", {
            offerId: r.id,
            projectId: r.project_id,
            projectTitle: title,
            freelancerId: r.freelancer_id,
          });
        } catch (e) {
          console.error("eventBus error offer.expired:", e);
        }
      }
    }
  } catch (err) {
    console.error("autoExpireOldOffers error:", err);
  }
};

/**
 * Allows admin or client to view all accepted offers
 */
export const getAcceptedOffers = async (req, res) => {
  try {
    const userId = req.token?.userId;
    const role = req.token?.role;

    let query;
    let params;

    if (role === 1) {
      query = `
        SELECT o.*, p.title AS project_title, u.username AS freelancer_name
        FROM offers o
        JOIN projects p ON o.project_id = p.id
        JOIN users u ON o.freelancer_id = u.id
        WHERE o.offer_status = 'accepted'
        ORDER BY o.updated_at DESC
      `;
      params = [];
    } else {
      query = `
        SELECT o.*, p.title AS project_title, u.username AS freelancer_name
        FROM offers o
        JOIN projects p ON o.project_id = p.id
        JOIN users u ON o.freelancer_id = u.id
        WHERE o.offer_status = 'accepted' AND p.user_id = $1
        ORDER BY o.updated_at DESC
      `;
      params = [userId];
    }

    const { rows } = await pool.query(query, params);
    res.json({ success: true, offers: rows });
  } catch (err) {
    console.error("getAcceptedOffers error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * -------------------------------
 * GET PENDING BIDDING APPROVALS (ADMIN)
 * -------------------------------
 * Returns all bidding projects with accepted offers waiting for admin approval.
 * Uses minimal columns to avoid schema mismatches (no project_assignments, no is_deleted if missing).
 */
export const getPendingBiddingApprovals = async (req, res) => {
  try {
    const userId = req.token?.userId;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    // Check if user is admin (users.role_id, users.is_deleted used elsewhere in app)
    const adminCheck = await pool.query(
      `SELECT role_id FROM users WHERE id = $1`,
      [userId]
    );
    if (!adminCheck.rows.length || Number(adminCheck.rows[0].role_id) !== 1) {
      return res.status(403).json({ success: false, message: "Admin access required" });
    }

    // Query avoids offers.created_at (column may not exist in some DBs); uses only offers.id, bid_amount, offer_status
    const { rows } = await pool.query(
      `SELECT 
        p.id AS project_id,
        p.title AS project_title,
        p.status,
        p.created_at AS project_created_at,
        u.id AS client_id,
        TRIM(u.first_name || ' ' || COALESCE(u.last_name, '')) AS client_name,
        u.email AS client_email,
        o.id AS offer_id,
        o.bid_amount,
        p.created_at AS offer_created_at,
        p.created_at AS accepted_at,
        f.id AS freelancer_id,
        TRIM(f.first_name || ' ' || COALESCE(f.last_name, '')) AS freelancer_name,
        f.email AS freelancer_email
       FROM projects p
       JOIN users u ON u.id = p.user_id
       JOIN offers o ON o.project_id = p.id AND o.offer_status = 'accepted'
       JOIN users f ON f.id = o.freelancer_id
       WHERE p.project_type = 'bidding'
         AND p.status = 'pending_admin_approval'
       ORDER BY p.created_at DESC`
    );

    return res.json({
      success: true,
      approvals: rows,
    });
  } catch (err) {
    console.error("getPendingBiddingApprovals error:", err);
    const msg = err.message || String(err);
    const code = err.code;
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: msg,
      ...(code && { code }),
    });
  }
};

/**
 * -------------------------------
 * ADMIN APPROVE BIDDING OFFER (ADMIN)
 * -------------------------------
 * Approves a pending bidding project offer, activates the project
 */
export const adminApproveBiddingOffer = async (req, res) => {
  const client = await pool.connect();
  try {
    const adminId = req.token?.userId;
    if (!adminId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    // Check if user is admin
    const { rows: userRows } = await client.query(
      `SELECT role_id FROM users WHERE id = $1 AND is_deleted = false`,
      [adminId]
    );
    if (!userRows.length || Number(userRows[0].role_id) !== 1) {
      return res.status(403).json({ success: false, message: "Admin access required" });
    }

    const { projectId } = req.params;

    await client.query("BEGIN");

    // Get project and accepted offer (client = project owner from p.user_id)
    const { rows: projectRows } = await client.query(
      `SELECT p.*, p.user_id AS client_id, o.id AS offer_id, o.freelancer_id, o.bid_amount
       FROM projects p
       JOIN offers o ON o.project_id = p.id AND o.offer_status = 'accepted'
       WHERE p.id = $1 
         AND p.project_type = 'bidding'
         AND p.status = 'pending_admin_approval'
         AND p.is_deleted = false`,
      [projectId]
    );

    if (!projectRows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        success: false,
        message: "Project not found or not in pending approval status",
      });
    }

    const project = projectRows[0];
    const offerId = project.offer_id;
    const freelancerId = project.freelancer_id;

    // Update project status to in_progress
    await client.query(
      `UPDATE projects 
       SET status = 'in_progress', 
           completion_status = 'in_progress',
           updated_at = NOW()
       WHERE id = $1`,
      [projectId]
    );

    // Update assignment status to active
    await client.query(
      `UPDATE project_assignments 
       SET status = 'active', assigned_at = NOW()
       WHERE project_id = $1 AND freelancer_id = $2`,
      [projectId, freelancerId]
    );

    // Create escrow (no payment for bidding projects that skipped payment)
    const { createEscrowHeld } = await import("../services/escrowService.js");
    await createEscrowHeld({
      projectId,
      clientId: project.client_id,
      freelancerId,
      amount: project.bid_amount,
      paymentId: null, // No payment for skipped payment bidding projects
    }, client);

    // Activate subscription if pending_start
    const { activateSubscriptionOnFirstAcceptance } = await import("../services/subscriptionActivation.js");
    const { rows: assignmentRows } = await client.query(
      `SELECT id FROM project_assignments 
       WHERE project_id = $1 AND freelancer_id = $2`,
      [projectId, freelancerId]
    );
    const assignmentId = assignmentRows[0]?.id || null;
    
    if (assignmentId) {
      await activateSubscriptionOnFirstAcceptance(freelancerId, client, assignmentId);
    }

    // Emit events
    try {
      eventBus.emit("offer.statusChanged", {
        offerId,
        projectId,
        projectTitle: project.title,
        freelancerId,
        accepted: true,
        adminApproved: true,
      });
      eventBus.emit("freelancer.assignmentChanged", {
        projectId,
        projectTitle: project.title,
        freelancerId,
        assigned: true,
      });
      eventBus.emit("escrow.funded", {
        projectId,
        projectTitle: project.title,
        freelancerId,
        amount: project.bid_amount,
      });
    } catch (e) {
      console.error("eventBus error (adminApproveBiddingOffer):", e);
    }

    await client.query("COMMIT");
    client.release();

    return res.json({
      success: true,
      message: "Bidding project approved. Project is now active and freelancer can start working.",
    });
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (_) {}
    if (client) client.release();
    console.error("adminApproveBiddingOffer error:", error);
    return res.status(500).json({
      success: false,
      message: error?.message || "Server error",
    });
  }
};

/**
 * -------------------------------
 * ADMIN REJECT BIDDING OFFER (ADMIN)
 * -------------------------------
 * Rejects a pending bidding project offer, reverts project to bidding status
 */
export const adminRejectBiddingOffer = async (req, res) => {
  const client = await pool.connect();
  try {
    const adminId = req.token?.userId;
    if (!adminId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    // Check if user is admin
    const { rows: userRows } = await client.query(
      `SELECT role_id FROM users WHERE id = $1 AND is_deleted = false`,
      [adminId]
    );
    if (!userRows.length || Number(userRows[0].role_id) !== 1) {
      return res.status(403).json({ success: false, message: "Admin access required" });
    }

    const { projectId } = req.params;
    const { reason } = req.body || {};

    await client.query("BEGIN");

    // Get project and accepted offer
    const { rows: projectRows } = await client.query(
      `SELECT p.*, o.id AS offer_id, o.freelancer_id
       FROM projects p
       JOIN offers o ON o.project_id = p.id AND o.offer_status = 'accepted'
       WHERE p.id = $1 
         AND p.project_type = 'bidding'
         AND p.status = 'pending_admin_approval'
         AND p.is_deleted = false`,
      [projectId]
    );

    if (!projectRows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        success: false,
        message: "Project not found or not in pending approval status",
      });
    }

    const project = projectRows[0];
    const offerId = project.offer_id;
    const freelancerId = project.freelancer_id;

    // Revert offer to pending (or rejected)
    await client.query(
      `UPDATE offers SET offer_status = 'rejected' WHERE id = $1`,
      [offerId]
    );

    // Revert project status to bidding and clear payment method so client can choose again on next accept
    // admin_approval_status is NOT NULL in DB, use 'none' not NULL
    await client.query(
      `UPDATE projects 
       SET status = 'bidding', 
           payment_method = NULL,
           admin_approval_status = 'none',
           updated_at = NOW()
       WHERE id = $1`,
      [projectId]
    );
    try {
      await client.query(
        `UPDATE projects SET completion_status = NULL WHERE id = $1`,
        [projectId]
      );
    } catch (_) {}

    // Remove assignment
    await client.query(
      `DELETE FROM project_assignments 
       WHERE project_id = $1 AND freelancer_id = $2`,
      [projectId, freelancerId]
    );

    // Emit events
    try {
      eventBus.emit("offer.statusChanged", {
        offerId,
        projectId,
        projectTitle: project.title,
        freelancerId,
        accepted: false,
        adminRejected: true,
        reason,
      });
    } catch (e) {
      console.error("eventBus error (adminRejectBiddingOffer):", e);
    }

    await client.query("COMMIT");
    client.release();

    return res.json({
      success: true,
      message: "Bidding project offer rejected. Project reverted to bidding status.",
    });
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch (_) {}
    if (client) client.release();
    console.error("adminRejectBiddingOffer error:", error);
    return res.status(500).json({ success: false, message: error?.message || "Server error" });
  }
};

export const checkMyPendingOffer = async (req, res) => {
  try {
    const freelancerId = req.token?.userId;
    const { projectId } = req.params;

    if (!freelancerId)
      return res.status(401).json({ success: false, message: "Unauthorized" });

    const { rows } = await pool.query(
      `SELECT id
       FROM offers
       WHERE project_id = $1
         AND freelancer_id = $2
         AND offer_status = 'pending'
       LIMIT 1`,
      [projectId, freelancerId]
    );

    return res.json({
      success: true,
      hasPendingOffer: rows.length > 0,
    });
  } catch (err) {
    console.error("checkMyPendingOffer error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};
