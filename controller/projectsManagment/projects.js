import pool from "../../models/db.js";
import { LogCreators, ACTION_TYPES } from "../../services/loggingService.js";
import cloudinary from "../../cloudinary/setupfile.js";
import { Readable } from "stream";
import { upload } from "../../middleware/uploadMiddleware.js";
import eventBus from "../../events/eventBus.js";

/**
 * Upload fields for cover + project files (if sent as form-data)
 */
export const uploadProjectMedia = upload.fields([
  { name: "cover_pic", maxCount: 1 },
  { name: "project_files", maxCount: 10 },
]);

/**
 * Upload Buffer to Cloudinary
 */
export const uploadToCloudinary = (buffer, folder = "project_files") => {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      { folder, resource_type: "auto" },
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      }
    );
    const stream = Readable.from(buffer);
    stream.pipe(uploadStream);
  });
};
/* ======================================================================
   1) CREATE PROJECT
====================================================================== */
export const createProject = async (req, res) => {
  const client = await pool.connect();
  try {
    const userId = req.token?.userId;
    
    // Check if user is client (role_id = 2) and get can_post_without_payment
    const { rows: userRows } = await pool.query(
      `SELECT role_id, can_post_without_payment FROM users WHERE id = $1 AND is_deleted = false`,
      [userId]
    );
    
    if (!userRows.length || Number(userRows[0].role_id) !== 2) {
      return res.status(403).json({
        success: false,
        message: "Only clients can create projects",
      });
    }

    const canPostWithoutPayment = userRows[0]?.can_post_without_payment === true;

    await client.query("SELECT pg_advisory_xact_lock($1)", [userId]);

    const {
      category_id,
      sub_category_id,
      sub_sub_category_id,
      title,
      description,
      budget,
      duration_type,
      duration_days,
      duration_hours,
      project_type,
      budget_min,
      budget_max,
      hourly_rate,
      preferred_skills,
    } = req.body;

    // ------------ Required validation ------------
    const missingFields = [];
    if (!category_id) missingFields.push("category_id");
    if (!sub_sub_category_id) missingFields.push("sub_sub_category_id");
    if (!title) missingFields.push("title");
    if (!description) missingFields.push("description");
    if (!duration_type) missingFields.push("duration_type");
    if (!["fixed", "hourly", "bidding"].includes(project_type))
      missingFields.push("project_type");

    if (duration_type === "days" && (!duration_days || duration_days <= 0))
      missingFields.push("duration_days");
    if (duration_type === "hours" && (!duration_hours || duration_hours <= 0))
      missingFields.push("duration_hours");

    if (project_type === "fixed" && (!budget || budget <= 0))
      missingFields.push("budget");
    if (project_type === "hourly" && (!hourly_rate || hourly_rate <= 0))
      missingFields.push("hourly_rate");
    if (project_type === "bidding") {
      if (!budget_min || budget_min <= 0) missingFields.push("budget_min");
      if (!budget_max || budget_max <= 0) missingFields.push("budget_max");
      if (budget_max < budget_min)
        missingFields.push("budget_max < budget_min");
    }

    if (missingFields.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Missing or invalid required fields: ${missingFields.join(", ")}`,
      });
    }

    // ------------ Length validation ------------
    const titleLength = title.trim().length;
    const descLength = description.trim().length;

    if (titleLength < 10 || titleLength > 100) {
      return res.status(400).json({
        success: false,
        message: "Title must be between 10 and 100 characters.",
      });
    }

    if (descLength < 100 || descLength > 2000) {
      return res.status(400).json({
        success: false,
        message: "Description must be between 100 and 2000 characters.",
      });
    }

    // Set project status - for skip-payment users, ensure it's 'active' to appear in listings
    let projectStatus;
    if (project_type === "bidding") {
      projectStatus = "bidding";
    } else {
      // For fixed/hourly projects, always set to 'active' so they appear in listings
      // This applies to both paid and skip-payment users
      projectStatus = "active";
    }

    // Debug: Log status for skip-payment users
    if (canPostWithoutPayment) {
      console.log(`[createProject] Skip-payment user ${userId} creating project with status: ${projectStatus}, project_type: ${project_type}`);
    }

    const durationDaysValue =
      duration_type === "days" ? Number(duration_days) : null;

    const durationHoursValue =
      duration_type === "hours" ? Number(duration_hours) : null;

    const normalizedBudget =
      project_type === "fixed" ? Number(budget) : null;

    const normalizedBudgetMin =
      project_type === "bidding" ? Number(budget_min) : null;

    const normalizedBudgetMax =
      project_type === "bidding" ? Number(budget_max) : null;

    const normalizedHourlyRate =
      project_type === "hourly" ? Number(hourly_rate) : null;

    // ------------ Step 0: Check for duplicate submission (within last 10 seconds) ------------
    const duplicateCheckQuery = `
      SELECT id, title, created_at
      FROM projects
      WHERE user_id = $1
        AND title = $2
        AND created_at > NOW() - INTERVAL '10 seconds'
        AND is_deleted = false
      ORDER BY created_at DESC
      LIMIT 1
    `;

    const { rows: duplicateRows } = await client.query(duplicateCheckQuery, [
      userId,
      title.trim(),
    ]);

    if (duplicateRows.length > 0) {
      const duplicateProject = duplicateRows[0];
      console.log(`[createProject] Duplicate submission detected for user ${userId}, returning existing project ${duplicateProject.id}`);
      
      // Return existing project instead of creating duplicate
      return res.status(200).json({
        success: true,
        project: duplicateProject,
        message: "Project already created (duplicate submission prevented)",
        isDuplicate: true,
      });
    }

    // ------------ Step 1: Insert project ------------
    const insertQuery = `
      INSERT INTO projects (
        user_id, category_id, sub_category_id, sub_sub_category_id,
        title, description, budget, duration_days, duration_hours,
        project_type, budget_min, budget_max, hourly_rate,
        preferred_skills, status, completion_status, is_deleted
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,
        $10,$11,$12,$13,$14,$15,'not_started',false
      ) RETURNING *;
    `;

    const { rows } = await client.query(insertQuery, [
      userId,
      category_id,
      sub_category_id,
      sub_sub_category_id,
      title.trim(),
      description.trim(),
      normalizedBudget,
      durationDaysValue,
      durationHoursValue,
      project_type,
      normalizedBudgetMin,
      normalizedBudgetMax,
      normalizedHourlyRate,
      preferred_skills || [],
      projectStatus,
    ]);

    let project = rows[0];

    // ------------ Step 2: Upload cover pic (optional) ------------
    if (req.files?.cover_pic && req.files.cover_pic.length > 0) {
      const coverPicFile = req.files.cover_pic[0];
      const coverPicResult = await uploadToCloudinary(
        coverPicFile.buffer,
        `projects/${project.id}/cover`
      );

      const { rows: updatedProject } = await client.query(
        `UPDATE projects SET cover_pic = $1 WHERE id = $2 RETURNING *`,
        [coverPicResult.secure_url, project.id]
      );
      project = updatedProject[0];
    }

    // ------------ Step 3: logs & notifications ------------
    await LogCreators.projectOperation(
      userId,
      ACTION_TYPES.PROJECT_CREATE,
      project.id,
      true,
      { title: project.title, category_id: project.category_id }
    );

    // ✅ only notify freelancers when project is ACTIVE
    // (bidding projects will be notified on adminApproveProject)
    try {
      if (String(project.status) === "active") {
        eventBus.emit("project.created", {
          projectId: project.id,
          projectTitle: project.title,
          clientId: userId,
          categoryId: project.category_id,
        });
      }
    } catch (err) {
      console.error("Error emitting project.created:", err);
    }

    // Debug: Log final project state for skip-payment users
    if (canPostWithoutPayment) {
      console.log(`[createProject] Skip-payment project created:`, {
        id: project.id,
        title: project.title,
        status: project.status,
        project_type: project.project_type,
        is_deleted: project.is_deleted,
        user_id: project.user_id,
      });
    }

    return res.status(201).json({ success: true, project });
  } catch (error) {
    console.error("createProject error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  } finally {
    client.release();
  }
};

/**
 * GET /projects/skills-suggestions?q=...
 * Returns skills used in previous projects: normalized (no duplicate wording), with count.
 * Used for autocomplete in Preferred Skills; optional q filters by prefix.
 */
export const getSkillSuggestions = async (req, res) => {
  try {
    const q = (req.query.q || "").trim().toLowerCase();
    const limit = Math.min(Number(req.query.limit) || 15, 30);

    const { rows } = await pool.query(
      `SELECT preferred_skills FROM projects WHERE preferred_skills IS NOT NULL AND is_deleted = false`
    );

    const countByNormalized = new Map();
    const displayByNormalized = new Map();

    for (const row of rows) {
      let arr = row.preferred_skills;
      if (typeof arr === "string") {
        try {
          arr = JSON.parse(arr);
        } catch {
          continue;
        }
      }
      if (!Array.isArray(arr)) continue;
      for (const s of arr) {
        const raw = typeof s === "string" ? s.trim() : String(s).trim();
        if (!raw) continue;
        const normalized = raw.toLowerCase();
        countByNormalized.set(normalized, (countByNormalized.get(normalized) || 0) + 1);
        if (!displayByNormalized.has(normalized) || raw.length < (displayByNormalized.get(normalized)?.length ?? 999)) {
          displayByNormalized.set(normalized, raw);
        }
      }
    }

    let list = [...countByNormalized.entries()]
      .map(([norm, count]) => ({ skill: displayByNormalized.get(norm) || norm, normalized: norm, count }))
      .filter((item) => !q || item.normalized.includes(q))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);

    const total = list.reduce((s, i) => s + i.count, 0);
    const suggestions = list.map(({ skill, count }) => ({
      skill,
      count,
      percentage: total > 0 ? Math.round((count / total) * 100) : 0,
    }));

    return res.json({ success: true, suggestions });
  } catch (error) {
    console.error("getSkillSuggestions error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// Admin approve project after payment

export const adminApproveProject = async (req, res) => {
  const { project_id } = req.body;

  const { rows } = await pool.query(
    `
    SELECT p.*, pay.id AS payment_id
    FROM projects p
    JOIN payments pay
      ON pay.reference_id = p.id
     AND pay.purpose = 'project'
     AND pay.status = 'paid'
    WHERE p.id = $1
    `,
    [project_id]
  );

  if (!rows.length) {
    return res.status(400).json({ error: "Payment not found" });
  }

  const project = rows[0];

  let escrowAmount =
    project.project_type === "fixed"
      ? project.budget
      : project.hourly_rate * 3;

  await pool.query(
    `
    INSERT INTO escrow (
      project_id, client_id, freelancer_id,
      amount, status, payment_id
    )
    VALUES ($1,$2,NULL,$3,'held',$4)
    `,
    [project.id, project.user_id, escrowAmount, project.payment_id]
  );

  await pool.query(
    "UPDATE projects SET status = 'active' WHERE id = $1",
    [project.id]
  );

  // ✅ when bidding project becomes active => notify freelancers now
  try {
    eventBus.emit("project.created", {
      projectId: project.id,
      projectTitle: project.title,
      clientId: project.user_id,
      categoryId: project.category_id,
    });
  } catch (err) {
    console.error("Error emitting project.created on approve:", err);
  }

  res.json({ success: true });
};

/* ======================================================================
   2) ASSIGNMENT / INVITES (CLIENT & FREELANCER)
====================================================================== */

/**
 * Client → invite specific freelancer to project
 */
export const assignFreelancer = async (req, res) => {
  try {
    const clientId = req.token?.userId;
    const { projectId } = req.params;
    const { freelancer_id } = req.body;

    if (!freelancer_id) {
      return res
        .status(400)
        .json({ success: false, message: "freelancer_id is required" });
    }

    const { rows: projectRows } = await pool.query(
      `SELECT id, title, user_id, status 
       FROM projects 
       WHERE id = $1 AND is_deleted = false`,
      [projectId]
    );

    if (!projectRows.length) {
      return res
        .status(404)
        .json({ success: false, message: "Project not found" });
    }

    const project = projectRows[0];
    if (project.user_id !== clientId) {
      return res.status(403).json({
        success: false,
        message: "You can only invite freelancers to your own projects",
      });
    }

    const { rows: freelancerRows } = await pool.query(
      `SELECT id, role_id, is_verified 
       FROM users 
       WHERE id = $1 AND is_deleted = false`,
      [freelancer_id]
    );

    if (!freelancerRows.length) {
      return res
        .status(404)
        .json({ success: false, message: "Freelancer not found" });
    }

    const freelancer = freelancerRows[0];
    if (freelancer.role_id !== 3 || !freelancer.is_verified) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid freelancer" });
    }

    const { rows: existing } = await pool.query(
      `SELECT id FROM project_assignments 
       WHERE project_id = $1 AND freelancer_id = $2`,
      [projectId, freelancer_id]
    );

    if (existing.length) {
      return res.status(400).json({
        success: false,
        message: "Freelancer already invited or assigned",
      });
    }

    const assignedAt = new Date();
    const { rows: assignmentRows } = await pool.query(
      `INSERT INTO project_assignments 
        (project_id, freelancer_id, assigned_at, status, assignment_type, user_invited)
       VALUES ($1, $2, $3, 'pending_acceptance', 'by_client', true)
       RETURNING *`,
      [projectId, freelancer_id, assignedAt]
    );

    const assignment = assignmentRows[0];

    await pool.query(
      `UPDATE projects
       SET status = 'pending_acceptance',
           completion_status = 'invitation_sent'
       WHERE id = $1`,
      [projectId]
    );

    await LogCreators.projectOperation(
      clientId,
      ACTION_TYPES.ASSIGNMENT_CREATE,
      projectId,
      true,
      {
        freelancer_id,
        assignment_id: assignment.id,
        type: "by_client",
        action: "invitation_sent",
      }
    );

    // ✅ emit event (listener will create notifications)
    try {
      eventBus.emit("freelancer.assignmentChanged", {
        projectId,
        freelancerId: freelancer_id,
        assigned: true,
      });
    } catch (err) {
      console.error("Notification emit error:", err);
    }

    return res.status(201).json({
      success: true,
      message:
        "Invitation sent successfully. Waiting for freelancer response.",
      assignment,
    });
  } catch (error) {
    console.error("assignFreelancer error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Server error" });
  }
};

/**
 * Freelancer → apply to active fixed/hourly project
 */
export const applyForProject = async (req, res) => {
  try {
    const freelancerId = req.token?.userId;
    const { projectId } = req.params;

    const { rows: freelancerRows } = await pool.query(
      `SELECT role_id, is_verified 
       FROM users 
       WHERE id = $1 AND is_deleted = false`,
      [freelancerId]
    );

    if (!freelancerRows.length || freelancerRows[0].role_id !== 3)
      return res.status(403).json({ success: false, message: "Only freelancers can apply" });

    if (!freelancerRows[0].is_verified)
      return res.status(403).json({ success: false, message: "Freelancer must be verified to apply" });

    const { rows: projectRows } = await pool.query(
      `SELECT id, user_id, title, project_type, status 
       FROM projects 
       WHERE id = $1 AND is_deleted = false`,
      [projectId]
    );

    if (!projectRows.length)
      return res.status(404).json({ success: false, message: "Project not found" });

    const project = projectRows[0];

    if (!["fixed", "hourly"].includes(project.project_type)) {
      return res.status(400).json({
        success: false,
        message: "You can only apply for fixed or hourly projects",
      });
    }

    if (project.status !== "active") {
      return res.status(400).json({
        success: false,
        message: "You can only apply to projects that are active",
      });
    }

    const { rows: existing } = await pool.query(
      `SELECT id 
       FROM project_assignments 
       WHERE project_id = $1 AND freelancer_id = $2`,
      [projectId, freelancerId]
    );

    if (existing.length) {
      return res.status(400).json({
        success: false,
        message: "You have already applied or are assigned to this project",
      });
    }

    const assignedAt = new Date();

    const { rows: inserted } = await pool.query(
      `INSERT INTO project_assignments 
        (project_id, freelancer_id, assigned_at, status, assignment_type)
       VALUES ($1, $2, $3, 'pending_client_approval', 'by_freelancer')
       RETURNING *`,
      [projectId, freelancerId, assignedAt]
    );

    const assignment = inserted[0];

    await LogCreators.projectOperation(
      freelancerId,
      ACTION_TYPES.ASSIGNMENT_CREATE,
      projectId,
      true,
      { freelancer_id: freelancerId, assignment_id: assignment.id, assignment_type: "by_freelancer" }
    );

    // ✅ emit event (listener will notify client)
    try {
      eventBus.emit("freelancer.appliedForProject", {
        clientId: project.user_id,
        freelancerId,
        projectId,
        projectTitle: project.title,
      });
    } catch (notifErr) {
      console.error("Notification emit error:", notifErr);
    }

    return res.status(201).json({
      success: true,
      message: "Application sent successfully. Waiting for client approval.",
      assignment,
    });

  } catch (error) {
    console.error("applyForProject error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * Client → approve or reject freelancer's application (by_freelancer)
 */
export const approveOrRejectApplication = async (req, res) => {
  const client = await pool.connect();
  try {
    const clientId = req.token?.userId;
    const { assignmentId, action } = req.body;

    if (!clientId) return res.status(401).json({ success: false, message: "Unauthorized" });
    if (!["accept", "reject"].includes(action))
      return res.status(400).json({ success: false, message: "Invalid action" });

    const { rows: assignmentRows } = await client.query(
      `SELECT pa.*, p.user_id AS client_id, p.title AS project_title 
       FROM project_assignments pa
       JOIN projects p ON pa.project_id = p.id
       WHERE pa.id = $1`,
      [assignmentId]
    );

    if (!assignmentRows.length)
      return res.status(404).json({ success: false, message: "Application not found" });

    const assignment = assignmentRows[0];
    if (assignment.client_id !== clientId)
      return res.status(403).json({ success: false, message: "Not authorized" });

    await client.query("BEGIN");

    // Reject case
    if (action === "reject") {
      await client.query(
        `UPDATE project_assignments SET status = 'rejected' WHERE id = $1`,
        [assignmentId]
      );
      await client.query("COMMIT");

      // ✅ emit event
      try {
        eventBus.emit("freelancer.applicationStatusChanged", {
          projectId: assignment.project_id,
          freelancerId: assignment.freelancer_id,
          projectTitle: assignment.project_title,
          accepted: false,
        });
      } catch (e) {
        console.error(e);
      }

      return res.json({ success: true, message: "Application rejected" });
    }

    const existingAccepted = await client.query(
      `SELECT id FROM project_assignments WHERE project_id = $1 AND status = 'active'`,
      [assignment.project_id]
    );
    if (existingAccepted.rows.length > 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        success: false,
        message: "Already have active freelancer",
      });
    }

    await client.query(
      `UPDATE project_assignments SET status = 'active' WHERE id = $1`,
      [assignmentId]
    );

    await client.query(
      `UPDATE project_assignments SET status = 'not_chosen' 
       WHERE project_id = $1 AND id <> $2 AND status = 'pending_client_approval'`,
      [assignment.project_id, assignmentId]
    );

    await client.query(`
  UPDATE projects
  SET status = 'in_progress',
      completion_status = 'in_progress',
      updated_at = NOW()
  WHERE id = $1
`, [assignment.project_id]);

    // B) Create escrow when freelancer starts working (if not already created)
    const paymentResult = await client.query(
      `SELECT id, amount FROM payments 
       WHERE reference_id = $1 AND purpose = 'project' AND status = 'paid' 
       ORDER BY created_at DESC LIMIT 1`,
      [assignment.project_id]
    );
    
    if (paymentResult.rows.length > 0) {
      const paymentId = paymentResult.rows[0].id;
      const amount = paymentResult.rows[0].amount;
      const projectResult = await client.query(
        `SELECT user_id AS client_id FROM projects WHERE id = $1`,
        [assignment.project_id]
      );
      
      if (projectResult.rows.length > 0) {
        const clientId = projectResult.rows[0].client_id;
        const { createEscrowHeld } = await import("../../services/escrowService.js");
        await createEscrowHeld({
          projectId: assignment.project_id,
          clientId,
          freelancerId: assignment.freelancer_id,
          amount,
          paymentId,
        }, client);
      }
    }

    await client.query("COMMIT");
    client.release();

    // Activate subscription if pending (after transaction commit)
    await activateSubscriptionIfPending(assignment.freelancer_id);

    // ✅ emit events
    try {
      eventBus.emit("freelancer.applicationStatusChanged", {
        projectId: assignment.project_id,
        freelancerId: assignment.freelancer_id,
        projectTitle: assignment.project_title,
        accepted: true,
      });

      eventBus.emit("freelancer.assigned", {
        freelancerId: assignment.freelancer_id,
        projectId: assignment.project_id,
        projectTitle: assignment.project_title,
      });
    } catch (e) {
      console.error(e);
    }

    return res.json({ success: true, message: "Freelancer accepted and project activated" });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("approveOrRejectApplication error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  } finally {
    client.release();
  }
};

/**
 * Freelancer → accept client invitation (assignment created by client)
 */
export const acceptAssignment = async (req, res) => {
  try {
    const freelancerId = req.token?.userId;
    const { assignmentId } = req.params;

    const { rows } = await pool.query(
      `SELECT * FROM project_assignments 
       WHERE id = $1 AND freelancer_id = $2 AND status = 'pending_acceptance'`,
      [assignmentId, freelancerId]
    );

    if (!rows.length)
      return res.status(404).json({ success: false, message: "No pending invitation found" });

    const assignment = rows[0];

    await pool.query(
      `UPDATE project_assignments SET status = 'active' WHERE id = $1`,
      [assignmentId]
    );

    // ✅ كان عندك client.query بدون client -> نفس المنطق بس pool.query
    await pool.query(
      `UPDATE projects
       SET status = 'in_progress',
           completion_status = 'in_progress',
           updated_at = NOW()
       WHERE id = $1`,
      [assignment.project_id]
    );

    // B) Create escrow when freelancer starts working (if not already created)
    const paymentResult = await pool.query(
      `SELECT id, amount FROM payments 
       WHERE reference_id = $1 AND purpose = 'project' AND status = 'paid' 
       ORDER BY created_at DESC LIMIT 1`,
      [assignment.project_id]
    );
    
    if (paymentResult.rows.length > 0) {
      const paymentId = paymentResult.rows[0].id;
      const amount = paymentResult.rows[0].amount;
      const projectResult = await pool.query(
        `SELECT user_id AS client_id FROM projects WHERE id = $1`,
        [assignment.project_id]
      );
      
      if (projectResult.rows.length > 0) {
        const clientId = projectResult.rows[0].client_id;
        const { createEscrowHeld } = await import("../../services/escrowService.js");
        await createEscrowHeld({
          projectId: assignment.project_id,
          clientId,
          freelancerId,
          amount,
          paymentId,
        });
      }
    }

    // Activate subscription if pending
    await activateSubscriptionIfPending(freelancerId);

    await LogCreators.projectOperation(
      freelancerId,
      ACTION_TYPES.ASSIGNMENT_ACCEPT,
      assignment.project_id,
      true
    );

    // ✅ emit event
    try {
      eventBus.emit("freelancer.acceptedAssignment", {
        projectId: assignment.project_id,
        freelancerId,
      });
    } catch (err) {
      console.error("Notification emit error:", err);
    }

    res.json({ success: true, message: "Assignment accepted successfully, project now in progress" });
  } catch (error) {
    console.error("acceptAssignment error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * Freelancer → reject client invitation
 */
export const rejectAssignment = async (req, res) => {
  try {
    const freelancerId = req.token?.userId;
    const { assignmentId } = req.params;

    const { rows } = await pool.query(
      `SELECT * FROM project_assignments WHERE id = $1 AND freelancer_id = $2 AND status = 'pending_acceptance'`,
      [assignmentId, freelancerId]
    );
    if (!rows.length)
      return res.status(404).json({ success: false, message: "No pending invitation found" });

    const assignment = rows[0];

    await pool.query(
      `UPDATE project_assignments SET status = 'rejected' WHERE id = $1`,
      [assignmentId]
    );

    await LogCreators.projectOperation(
      freelancerId,
      ACTION_TYPES.ASSIGNMENT_REJECT,
      assignment.project_id,
      true
    );

    // ✅ emit event
    try {
      eventBus.emit("freelancer.rejectedAssignment", {
        projectId: assignment.project_id,
        freelancerId,
      });
    } catch (err) {
      console.error("Notification emit error:", err);
    }

    res.json({ success: true, message: "Assignment rejected successfully" });
  } catch (error) {
    console.error("rejectAssignment error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * Client → get all applications on his projects
 */
export const getApplicationsForMyProjects = async (req, res) => {
  try {
    const ownerId = req.token?.userId;
    if (!ownerId)
      return res.status(401).json({ success: false, message: "Unauthorized" });

    const { rows } = await pool.query(
      `SELECT pa.id AS assignment_id, pa.freelancer_id, u.username AS freelancer_name,
              u.email AS freelancer_email, pa.status, pa.assigned_at,
              p.id AS project_id, p.title AS project_title
       FROM project_assignments pa
       JOIN projects p ON pa.project_id = p.id
       JOIN users u ON pa.freelancer_id = u.id
       WHERE p.user_id = $1
       ORDER BY pa.assigned_at DESC`,
      [ownerId]
    );

    res.json({ success: true, applications: rows });
  } catch (err) {
    console.error("getApplicationsForMyProjects error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/* ======================================================================
   3) WORK COMPLETION (CLIENT REVIEW + FREELANCER RESUBMIT)
====================================================================== */

/**
 * Client → approve work or request revision
 */
export const approveWorkCompletion = async (req, res) => {
  try {
    const clientId = req.token.userId;
    const { projectId } = req.params;
    const { action } = req.body;

    if (!["approve", "revision_requested"].includes(action)) {
      return res.status(400).json({
        success: false,
        message: "Invalid action",
      });
    }

    // 1) Load project with completion status
    const { rows } = await pool.query(
      `SELECT id, user_id, title, status, completion_status
       FROM projects
       WHERE id = $1 AND is_deleted = false`,
      [projectId]
    );

    if (!rows.length) {
      return res.status(404).json({
        success: false,
        message: "Project not found",
      });
    }

    const project = rows[0];

    // 2) Only client can approve
    if (String(project.user_id) !== String(clientId)) {
      return res.status(403).json({
        success: false,
        message: "Only client can approve work",
      });
    }

    // 3) Validate that work was delivered before allowing approve
    if (action === "approve") {
      if (project.status !== "pending_review" && project.completion_status !== "pending_review") {
        return res.status(400).json({
          success: false,
          message: "Work must be submitted for review before it can be approved",
        });
      }
    }

    const newStatus =
      action === "approve" ? "completed" : "revision_requested";

    // 3) Update BOTH status fields to ensure UI consistency
    await pool.query(
      `UPDATE projects
       SET status = $1,
           completion_status = $1,
           updated_at = NOW()
       WHERE id = $2`,
      [newStatus, projectId]
    );

    // C) Release escrow and credit freelancer wallet when project is completed
    if (action === "approve" && newStatus === "completed") {
      const { releaseEscrowToFreelancer } = await import("../../services/escrowService.js");
      try {
        const releaseResult = await releaseEscrowToFreelancer(projectId);
        if (releaseResult.released) {
          console.log(`✅ Escrow released for project ${projectId}: ${releaseResult.amount} credited to freelancer ${releaseResult.freelancerId}`);
        }
      } catch (escrowError) {
        console.error("[approveWorkCompletion] Escrow release error:", escrowError);
        // Don't fail approval if escrow release fails - log and continue
      }
    }

    // 4) Optional notification (safe)
    try {
      const { rows: freelancers } = await pool.query(
        `SELECT freelancer_id
         FROM project_assignments
         WHERE project_id = $1 AND status = 'active'`,
        [projectId]
      );

      for (const f of freelancers) {
        try {
          eventBus.emit("work.reviewed", {
            freelancerId: f.freelancer_id,
            projectId,
            projectTitle: project.title,
            status: newStatus,
          });
        } catch {}
      }
    } catch {}

    return res.json({
      success: true,
      message: `Work ${action}`,
      completion_status: newStatus,
    });
  } catch (err) {
    console.error("approveWorkCompletion error:", err);
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};


/**
 * Freelancer → resubmit work after revision requested
 */
export const resubmitWorkCompletion = async (req, res) => {
  try {
    const freelancerId = req.token.userId;
    const { projectId } = req.params;
    const files = req.files || [];

    const { rows: projectRows } = await pool.query(
      `SELECT assigned_freelancer_id, title, completion_status
       FROM projects WHERE id = $1 AND is_deleted = false`,
      [projectId]
    );

    if (!projectRows.length) {
      return res
        .status(404)
        .json({ success: false, message: "Project not found" });
    }
    const project = projectRows[0];

    if (project.assigned_freelancer_id !== freelancerId) {
      return res.status(403).json({
        success: false,
        message: "Only assigned freelancer can resubmit",
      });
    }

    if (project.completion_status !== "revision_requested") {
      return res.status(400).json({
        success: false,
        message: "Project is not requesting revision",
      });
    }

    const uploadedFiles = [];

    for (const file of files) {
      const result = await uploadToCloudinary(
        file.buffer,
        `projects/${projectId}`
      );

      uploadedFiles.push({
        file_name: file.originalname,
        file_size: file.size,
        file_url: result.secure_url,
        public_id: result.public_id,
      });
    }

    await pool.query(
      `UPDATE projects 
         SET completion_status = 'pending_review', 
             completion_requested_at = NOW() 
       WHERE id = $1`,
      [projectId]
    );

    for (const fileData of uploadedFiles) {
      await pool.query(
        `INSERT INTO project_files 
          (project_id, sender_id, file_name, file_url, file_size, public_id) 
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          projectId,
          freelancerId,
          fileData.file_name,
          fileData.file_url,
          fileData.file_size,
          fileData.public_id,
        ]
      );
    }

    await pool.query(
      `INSERT INTO completion_history (project_id, event, timestamp, actor, notes)
       VALUES ($1, 'revision_resubmitted', NOW(), $2, $3)`,
      [projectId, freelancerId, "Freelancer resubmitted after revision request"]
    );

    await LogCreators.projectOperation(
      freelancerId,
      ACTION_TYPES.PROJECT_STATUS_CHANGE,
      projectId,
      true,
      { action: "revision_resubmitted" }
    );

    // ✅ emit event
    try {
      eventBus.emit("work.resubmitted", {
        projectId,
        projectTitle: project.title,
        freelancerId,
      });
    } catch (notifErr) {
      console.error("Notification emit error:", notifErr);
    }

    return res.json({
      success: true,
      message: "Revision resubmitted",
      files: uploadedFiles,
    });
  } catch (err) {
    console.error("resubmitWorkCompletion error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

/* ======================================================================
   4) HOURLY PROJECT COMPLETION
====================================================================== */

export const completeHourlyProject = async (req, res) => {
  try {
    const { projectId } = req.params;
    const { total_hours } = req.body;
    const userId = req.token?.userId;

    if (!userId) {
      return res
        .status(401)
        .json({ success: false, message: "Unauthorized" });
    }

    if (typeof total_hours !== "number" || total_hours < 0) {
      return res.status(400).json({
        success: false,
        message: "total_hours must be a non-negative number",
      });
    }

    const { rows: projectRows } = await pool.query(
      `SELECT * FROM projects WHERE id = $1 AND is_deleted = false`,
      [projectId]
    );
    if (!projectRows.length) {
      return res
        .status(404)
        .json({ success: false, message: "Project not found" });
    }

    const project = projectRows[0];

    if (String(project.user_id) !== String(userId)) {
      return res.status(403).json({
        success: false,
        message: "Only the project owner can complete this hourly project",
      });
    }

    if (project.project_type !== "hourly") {
      return res
        .status(400)
        .json({ success: false, message: "Not an hourly project" });
    }

    const prepaidHours = project.prepaid_hours || 3;
    const hourlyRate = project.hourly_rate;

    let refundAmount = 0,
      extraPayment = 0;
    if (total_hours < prepaidHours)
      refundAmount = (prepaidHours - total_hours) * hourlyRate;
    else if (total_hours > prepaidHours)
      extraPayment = (total_hours - prepaidHours) * hourlyRate;

    const finalAmount = total_hours * hourlyRate;

    const { rows: updated } = await pool.query(
      `UPDATE projects 
         SET total_hours = $1, amount_to_pay = $2, status = 'completed' 
       WHERE id = $3 
       RETURNING *`,
      [total_hours, finalAmount, projectId]
    );

    if (refundAmount > 0) {
      await pool.query(
        `UPDATE wallets SET balance = balance + $1 WHERE user_id = $2`,
        [refundAmount, project.user_id]
      );
    }
    if (extraPayment > 0) {
      await pool.query(
        `UPDATE wallets SET balance = balance - $1 WHERE user_id = $2`,
        [extraPayment, project.user_id]
      );
    }

    return res.status(200).json({
      success: true,
      project: updated[0],
      refund: refundAmount || null,
      extra_payment: extraPayment || null,
    });
  } catch (error) {
    console.error("completeHourlyProject error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

/* ======================================================================
   5) PROJECT FILES (CHAT / DELIVERY FILES)
====================================================================== */

export const addProjectFiles = async (req, res) => {
  const { projectId } = req.params;
  const userId = req.token?.userId;

  if (!userId)
    return res
      .status(401)
      .json({ success: false, message: "Unauthorized" });
  if (!req.files || req.files.length === 0)
    return res
      .status(400)
      .json({ success: false, message: "No files uploaded" });

  try {
    const uploadedFiles = [];

    for (const file of req.files) {
      const result = await uploadToCloudinary(
        file.buffer,
        `projects/${projectId}`
      );

      const { rows } = await pool.query(
        `INSERT INTO project_files 
          (project_id, sender_id, file_name, file_url, file_size, public_id) 
         VALUES ($1, $2, $3, $4, $5, $6) 
         RETURNING *`,
        [
          projectId,
          userId,
          file.originalname,
          result.secure_url,
          file.size,
          result.public_id,
        ]
      );

      uploadedFiles.push(rows[0]);
    }

    res.json({ success: true, files: uploadedFiles });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      success: false,
      message: "File upload failed",
      error: err.message,
    });
  }
};

/* ======================================================================
   6) DELETE PROJECT + TIMELINE
====================================================================== */

/**
 * Client → soft delete own project
 */
export const deleteProjectByOwner = async (req, res) => {
  try {
    const userId = req.token?.userId;
    const { projectId } = req.params;

    if (!userId)
      return res
        .status(401)
        .json({ success: false, message: "Unauthorized" });
    if (!projectId)
      return res
        .status(400)
        .json({ success: false, message: "Missing projectId" });

    const { rows } = await pool.query(
      `SELECT id, user_id, title 
       FROM projects 
       WHERE id = $1 AND is_deleted = false`,
      [projectId]
    );

    if (!rows.length)
      return res
        .status(404)
        .json({ success: false, message: "Project not found" });
    const project = rows[0];
    if (String(project.user_id) !== String(userId))
      return res
        .status(403)
        .json({ success: false, message: "Not authorized to delete this project" });

    await pool.query(`UPDATE projects SET is_deleted = true WHERE id = $1`, [
      projectId,
    ]);

    try {
      await LogCreators.projectOperation(
        userId,
        ACTION_TYPES.PROJECT_DELETE,
        projectId,
        true,
        { title: project.title }
      );
    } catch (e) {
      console.error("project delete log error:", e);
    }

    return res.status(200).json({
      success: true,
      message: "Project deleted successfully",
      data: { id: projectId },
    });
  } catch (err) {
    console.error("deleteProjectByOwner error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * Timeline of project status (for client/freelancer UI)
 */
export const getProjectTimeline = async (req, res) => {
  try {
    const { projectId } = req.params;

    const { rows: projectRows } = await pool.query(
      `SELECT 
         p.id, p.title, p.status, p.completion_status, 
         p.created_at, p.assigned_freelancer_id, 
         u.username AS client_name, 
         f.username AS freelancer_name
       FROM projects p
       LEFT JOIN users u ON u.id = p.user_id
       LEFT JOIN users f ON f.id = p.assigned_freelancer_id
       WHERE p.id = $1 AND p.is_deleted = false`,
      [projectId]
    );

    if (!projectRows.length)
      return res
        .status(404)
        .json({ success: false, message: "Project not found" });

    const project = projectRows[0];

    const { rows: history } = await pool.query(
      `SELECT event, timestamp 
       FROM completion_history 
       WHERE project_id = $1 
       ORDER BY timestamp ASC`,
      [projectId]
    );

    const getEventTime = (eventName) =>
      history.find((h) => h.event === eventName)?.timestamp || null;

    const timeline = [
      {
        step: "Project Created",
        status: "done",
        timestamp: project.created_at,
      },
      {
        step: "Freelancer Invited / Application Sent",
        status: ["pending_acceptance", "pending_client_approval"].includes(
          project.status
        )
          ? "active"
          : ["in_progress", "pending_review", "completed", "revision_requested"].includes(
              project.status
            )
          ? "done"
          : "pending",
        timestamp: getEventTime("invitation_sent"),
      },
      {
        step: "Freelancer Accepted",
        status:
          project.status === "in_progress" ||
          ["pending_review", "completed", "revision_requested"].includes(
            project.completion_status
          )
            ? "done"
            : "pending",
        timestamp: getEventTime("freelancer_accepted"),
      },
      {
        step: "Work in Progress",
        status:
          project.status === "in_progress" &&
          project.completion_status === "in_progress"
            ? "active"
            : ["pending_review", "revision_requested", "completed"].includes(
                project.completion_status
              )
            ? "done"
            : "pending",
        timestamp: getEventTime("work_started"),
      },
      {
        step: "Work Submitted for Review",
        status:
          project.completion_status === "pending_review"
            ? "active"
            : ["revision_requested", "completed"].includes(
                project.completion_status
              )
            ? "done"
            : "pending",
        timestamp: getEventTime("completion_requested"),
      },
      {
        step: "Client Review / Revision",
        status:
          project.completion_status === "revision_requested"
            ? "active"
            : project.completion_status === "completed"
            ? "done"
            : "pending",
        timestamp: getEventTime("revision_requested"),
      },
      {
        step: "Project Completed",
        status:
          project.completion_status === "completed" ? "done" : "pending",
        timestamp: getEventTime("completed"),
      },
    ];

    return res.json({
      success: true,
      project_id: project.id,
      title: project.title,
      client: project.client_name,
      freelancer: project.freelancer_name,
      status: project.status,
      completion_status: project.completion_status,
      timeline,
    });
  } catch (error) {
    console.error("getProjectTimeline error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/* ======================================================================
   7) DISCOVERY / HELPERS
====================================================================== */

/**
 * -------------------------------
 * GET ALL FREELANCERS FOR ADMIN
 * -------------------------------
 */
export const getAllFreelancers = async (req, res) => {
  try {
    const { rows: freelancers } = await pool.query(
      `
      SELECT id, username, email, first_name, last_name, profile_pic
      FROM users
      WHERE role_id = 3
        AND is_deleted = false
        AND is_verified = true
      ORDER BY username ASC;
      `
    );

    res.status(200).json({
      success: true,
      count: freelancers.length,
      freelancers,
    });
  } catch (error) {
    console.error("Error fetching all freelancers:", error);
    res.status(500).json({
      success: false,
      message: "Server error while fetching freelancers",
    });
  }
};

/**
 * -------------------------------
 * GET ALL PROJECTS FOR ADMIN DASHBOARD
 * -------------------------------
 */
export const getAllProjectsForAdmin = async (req, res) => {
  try {
    const { rows: projects } = await pool.query(`
      SELECT 
        p.id,
        p.title,
        p.project_type,
        p.status,
        p.completion_status,
        p.created_at,
        u.username AS client_name
      FROM projects p
      LEFT JOIN users u ON p.user_id = u.id
      WHERE p.is_deleted = false
      ORDER BY p.created_at DESC
    `);

    res.status(200).json({
      success: true,
      count: projects.length,
      projects,
    });
  } catch (error) {
    console.error("Error fetching all projects for admin:", error);
    res.status(500).json({
      success: false,
      message: "Server error while fetching projects",
    });
  }
};


/**
 * -------------------------------
 * REASSIGN FREELANCER TO PROJECT (ADMIN ONLY)
 * -------------------------------
 */
export const reassignFreelancer = async (req, res) => {
  try {
    const { projectId } = req.params;
    const { freelancerId } = req.body;

    // Check if project exists and is an admin project
    const { rows: projectRows } = await pool.query(
      `SELECT id, category_id, title FROM projects WHERE id = $1 AND is_deleted = false`,
      [projectId]
    );

    if (!projectRows.length) {
      return res.status(404).json({ success: false, message: "Project not found" });
    }

    const project = projectRows[0];
    
    // Check if it's an admin project (category_id = 999)
    if (project.category_id !== 999) {
      return res.status(400).json({ success: false, message: "Only admin projects can be reassigned" });
    }

    // Check if freelancer exists and is valid
    const { rows: freelancerRows } = await pool.query(
      `SELECT id, role_id, is_verified FROM users WHERE id = $1 AND is_deleted = false`,
      [freelancerId]
    );

    if (!freelancerRows.length || freelancerRows[0].role_id !== 3 || !freelancerRows[0].is_verified) {
      return res.status(400).json({ success: false, message: "Invalid freelancer" });
    }

    // Update the project with the new assigned freelancer
    await pool.query(
      `UPDATE projects SET assigned_freelancer_id = $1 WHERE id = $2`,
      [freelancerId, projectId]
    );

    // Update or create project assignment record
    const assignedAt = new Date();
    const { rows: existingAssignments } = await pool.query(
      `SELECT id FROM project_assignments WHERE project_id = $1 AND freelancer_id = $2`,
      [projectId, freelancerId]
    );

    if (existingAssignments.length > 0) {
      // Update existing assignment
      await pool.query(
        `UPDATE project_assignments SET assigned_at = $1, status = 'active' WHERE project_id = $2 AND freelancer_id = $3`,
        [assignedAt, projectId, freelancerId]
      );
    } else {
      // Create new assignment
      await pool.query(
        `INSERT INTO project_assignments (project_id, freelancer_id, assigned_at, status, assignment_type, user_invited)
         VALUES ($1, $2, $3, 'active', 'admin_assigned', true)`,
        [projectId, freelancerId, assignedAt]
      );
    }

    // Update project status to active if it's not already
    await pool.query(
      `UPDATE projects SET status = 'active' WHERE id = $1 AND status != 'active'`,
      [projectId]
    );

    res.status(200).json({
      success: true,
      message: "Freelancer reassigned successfully",
      projectId,
      freelancerId
    });
  } catch (error) {
    console.error("Error reassigning freelancer:", error);
    res.status(500).json({
      success: false,
      message: "Server error while reassigning freelancer",
    });
  }
};


/* ======================================================================
   5.B) DELIVERY (Freelancer -> Client) using project_files
====================================================================== */

export const submitProjectDelivery = async (req, res) => {
  const freelancerId = req.token?.userId;
  const { projectId } = req.params;
  const files = req.files?.project_files || [];

  if (!freelancerId) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }
  if (!projectId) {
    return res.status(400).json({ success: false, message: "Missing projectId" });
  }
  if (!files.length) {
    return res.status(400).json({ success: false, message: "No files uploaded" });
  }

  try {
    const { rows: projectRows } = await pool.query(
      `SELECT id, user_id AS client_id, status, title
         FROM projects
        WHERE id = $1 AND is_deleted = false`,
      [projectId]
    );

    if (!projectRows.length) {
      return res.status(404).json({ success: false, message: "Project not found" });
    }

    const project = projectRows[0];

    // تحقق الصلاحية عبر project_assignments فقط
    const { rows: activeAssignment } = await pool.query(
      `SELECT 1
         FROM project_assignments
        WHERE project_id = $1
          AND freelancer_id = $2
          AND status = 'active'
        LIMIT 1`,
      [projectId, freelancerId]
    );

    if (!activeAssignment.length) {
      return res.status(403).json({
        success: false,
        message: "Only an active freelancer on this project can submit a delivery",
      });
    }

    const st = String(project.status || "").toLowerCase();
    if (st !== "in_progress") {
      return res.status(400).json({
        success: false,
        message: "Project must be in progress to submit a delivery",
      });
    }

    const sentAt = new Date();
    const uploadedFiles = [];

    for (const file of files) {
      const result = await uploadToCloudinary(
        file.buffer,
        `projects/${projectId}/deliveries`
      );

      const { rows } = await pool.query(
        `INSERT INTO project_files
          (project_id, sender_id, file_name, file_url, file_size, public_id, sent_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [
          projectId,
          freelancerId,
          file.originalname,
          result.secure_url,
          file.size || 0,
          result.public_id,
          sentAt,
        ]
      );

      uploadedFiles.push(rows[0]);
    }
    await pool.query(
      `UPDATE project_change_requests
          SET is_resolved = true
        WHERE project_id = $1
          AND freelancer_id = $2
          AND is_resolved = false`,
      [projectId, freelancerId]
    );
    await pool.query(
      `UPDATE projects
          SET status = 'pending_review',
              completion_status = 'pending_review',
              updated_at = NOW()
        WHERE id = $1`,
      [projectId]
    );

    // ✅ emit event (notify client about submission)
    try {
      eventBus.emit("work.submitted", {
        clientId: project.client_id,
        projectId,
        projectTitle: project.title,
        freelancerId,
        messageText: `📦 Work submitted for "${project.title || "your project"}".`,
      });
    } catch (e) {
      console.error("work.submitted emit error:", e);
    }

    return res.status(201).json({
      success: true,
      message: "Delivery submitted successfully",
      sent_at: sentAt,
      files: uploadedFiles,
    });
  } catch (err) {
    console.error("submitProjectDelivery error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};


export const getProjectDeliveries = async (req, res) => {
  const userId = req.token?.userId;
  const { projectId } = req.params;

  if (!userId) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }
  if (!projectId) {
    return res.status(400).json({ success: false, message: "Missing projectId" });
  }

  try {
    // 1) Load project (NO assigned_freelancer_id)
    const { rows: projectRows } = await pool.query(
      `SELECT id,
              user_id AS client_id
         FROM projects
        WHERE id = $1
          AND is_deleted = false`,
      [projectId]
    );

    if (!projectRows.length) {
      return res.status(404).json({ success: false, message: "Project not found" });
    }

    const project = projectRows[0];

    // 2) Permission:
    // - client can view
    // - OR any freelancer with active / pending assignment
    const isClient = String(project.client_id) === String(userId);

    let isFreelancer = false;
    if (!isClient) {
      const { rows: activeAssignment } = await pool.query(
        `SELECT 1
           FROM project_assignments
          WHERE project_id = $1
            AND freelancer_id = $2
            AND status IN ('active', 'pending_client_approval', 'pending_acceptance')
          LIMIT 1`,
        [projectId, userId]
      );

      isFreelancer = activeAssignment.length > 0;
    }

    if (!isClient && !isFreelancer) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to view this project's deliveries",
      });
    }

    // 3) Pull all files and group by sent_at (each group = delivery version)
    const { rows: files } = await pool.query(
      `SELECT id,
              project_id,
              sender_id,
              file_name,
              file_url,
              file_size,
              public_id,
              sent_at
         FROM project_files
        WHERE project_id = $1
        ORDER BY sent_at DESC, id DESC`,
      [projectId]
    );

    const map = new Map();

    for (const f of files) {
      const key = f.sent_at
        ? new Date(f.sent_at).toISOString()
        : "unknown";

      if (!map.has(key)) {
        map.set(key, {
          id: key,
          sent_at: f.sent_at,
          files: [],
        });
      }

      map.get(key).files.push(f);
    }

    const deliveries = Array.from(map.values()).sort((a, b) => {
      const ta = a.sent_at ? new Date(a.sent_at).getTime() : 0;
      const tb = b.sent_at ? new Date(b.sent_at).getTime() : 0;
      return tb - ta;
    });

    return res.json({
      success: true,
      deliveries,
    });
  } catch (err) {
    console.error("getProjectDeliveries error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

/// Get change requests for a project (freelancer)
/// GET /projects/:projectId/change-requests
export const getProjectChangeRequests = async (req, res) => {
  const requesterId = req.token?.userId;
  const { projectId } = req.params;

  if (!requesterId) return res.status(401).json({ success: false, message: "Unauthorized" });
  if (!projectId) return res.status(400).json({ success: false, message: "Missing projectId" });

  try {
    // Check if project exists
    const { rows: pr } = await pool.query(
      `SELECT id, user_id AS client_id
         FROM projects
        WHERE id = $1 AND is_deleted = false`,
      [projectId]
    );
    if (!pr.length) {
      return res.status(404).json({ success: false, message: "Project not found" });
    }

    // Get active freelancer assignment
    const { rows: ar } = await pool.query(
      `SELECT freelancer_id
         FROM project_assignments
        WHERE project_id = $1 AND status = 'active'`,
      [projectId]
    );

    if (!ar.length) {
      // No active assignment - return empty list
      return res.status(200).json({ success: true, requests: [] });
    }

    const freelancerId = ar[0].freelancer_id;

    // Check if requester is the assigned freelancer or the client owner
    const isFreelancer = String(requesterId) === String(freelancerId);
    const isClient = String(requesterId) === String(pr[0].client_id);

    if (!isFreelancer && !isClient) {
      return res.status(403).json({ success: false, message: "Not authorized" });
    }

    // Get change requests for this project and freelancer
    const { rows } = await pool.query(
      `SELECT 
         id,
         project_id,
         client_id,
         freelancer_id,
         message,
         is_resolved,
         created_at
       FROM project_change_requests
       WHERE project_id = $1 AND freelancer_id = $2
       ORDER BY created_at DESC`,
      [projectId, freelancerId]
    );

    return res.status(200).json({ success: true, requests: rows || [] });
  } catch (err) {
    console.error("getProjectChangeRequests error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

/// Mark all change requests for a project as read (resolved) for the current freelancer
/// PUT /projects/:projectId/change-requests/mark-read
export const markProjectChangeRequestsAsRead = async (req, res) => {
  const freelancerId = req.token?.userId;
  const { projectId } = req.params;

  if (!freelancerId) return res.status(401).json({ success: false, message: "Unauthorized" });
  if (!projectId) return res.status(400).json({ success: false, message: "Missing projectId" });

  try {
    const { rowCount } = await pool.query(
      `UPDATE project_change_requests
       SET is_resolved = true
       WHERE project_id = $1 AND freelancer_id = $2 AND is_resolved = false`,
      [projectId, freelancerId]
    );
    return res.status(200).json({ success: true, marked: rowCount || 0 });
  } catch (err) {
    console.error("markProjectChangeRequestsAsRead error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

export const requestProjectChanges = async (req, res) => {
  const clientId = req.token?.userId;
  const { projectId } = req.params;
  const { message } = req.body;

  if (!clientId) return res.status(401).json({ success: false, message: "Unauthorized" });
  if (!projectId) return res.status(400).json({ success: false, message: "Missing projectId" });
  if (!String(message || "").trim()) {
    return res.status(400).json({ success: false, message: "Message is required" });
  }

  try {
    // project + owner check
    const { rows: pr } = await pool.query(
      `SELECT id, user_id AS client_id
         FROM projects
        WHERE id = $1 AND is_deleted = false`,
      [projectId]
    );
    if (!pr.length) return res.status(404).json({ success: false, message: "Project not found" });
    if (String(pr[0].client_id) !== String(clientId)) {
      return res.status(403).json({ success: false, message: "Not authorized" });
    }

    // get active freelancer assignment
    const { rows: ar } = await pool.query(
      `SELECT freelancer_id
         FROM project_assignments
         WHERE project_id = $1 AND status = 'active'
        `,
      [projectId]
    );
    if (!ar.length) {
      return res.status(400).json({ success: false, message: "No active freelancer assignment" });
    }
    const freelancerId = ar[0].freelancer_id;

    // 1) change status back to in_progress
    await pool.query(
      `UPDATE projects
          SET status = 'in_progress',
              completion_status = 'in_progress',
              updated_at = NOW()
        WHERE id = $1`,
      [projectId]
    );

    // 2) store change request message
    const { rows: cr } = await pool.query(
      `INSERT INTO project_change_requests (project_id, client_id, freelancer_id, message)
       VALUES ($1, $2, $3, $4)
       RETURNING id, project_id, freelancer_id, message, created_at`,
      [projectId, clientId, freelancerId, message.trim()]
    );

    return res.json({ success: true, change_request: cr[0] });
  } catch (err) {
    console.error("requestProjectChanges error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};
