import pool from "../../models/db.js";

/**
 * Get full assignment details for freelancer on a specific project
 */
export const getAssignmentForFreelancer = async (req, res) => {
  try {
    const { projectId } = req.params;
    const freelancerId = req.token?.userId;

    if (!projectId || !freelancerId) {
      return res.status(400).json({
        success: false,
        message: "projectId and freelancerId are required",
      });
    }

    const { rows } = await pool.query(
      `SELECT 
        pa.id AS assignment_id,
        pa.project_id,
        pa.freelancer_id,
        pa.status AS assignment_status,
        pa.assignment_type,
        pa.user_invited,
        pa.assigned_at,
        pa.deadline,
        p.title AS project_title,
        p.description AS project_description,
        p.status AS project_status,
        p.project_type,
        p.budget,
        p.budget_min,
        p.budget_max,
        p.hourly_rate,
        p.duration_days,
        p.duration_hours,
        p.category_id,
        p.sub_category_id,
        p.sub_sub_category_id,
        p.cover_pic,
        p.user_id AS client_id,
        u.username AS client_username,
        COALESCE(
          NULLIF(TRIM(u.first_name || ' ' || u.last_name), ''),
          u.username,
          'Anonymous'
        ) AS client_fullname,
        u.email AS client_email
      FROM project_assignments pa
      JOIN projects p ON pa.project_id = p.id
      JOIN users u ON p.user_id = u.id
      WHERE pa.project_id = $1
        AND pa.freelancer_id = $2
        AND p.is_deleted = false`,
      [projectId, freelancerId]
    );

    if (rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "No assignment found for this project" });
    }

    return res.status(200).json({ success: true, assignment: rows[0] });
  } catch (err) {
    console.error("getAssignmentForFreelancer error:", err);
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: err.message,
    });
  }
};

/**
 * Simple check: is this freelancer assigned to this project?
 */
export const checkIfAssigned = async (req, res) => {
  try {
    const { projectId } = req.params;
    const freelancerId = req.token?.userId;

    if (!projectId || !freelancerId) {
      return res.status(400).json({
        success: false,
        message: "projectId and freelancerId are required",
      });
    }

    const { rows } = await pool.query(
      `SELECT 1 
       FROM project_assignments 
       WHERE project_id = $1 AND freelancer_id = $2 
       LIMIT 1`,
      [projectId, freelancerId]
    );

    const isAssigned = rows.length > 0;

    return res.status(200).json({ success: true, is_assigned: isAssigned });
  } catch (err) {
    console.error("checkIfAssigned error:", err);
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: err.message,
    });
  }
};

/**
 * Get all freelancer applications (assignments) for a specific project
 */
// جلب كل التطبيقات (العروض) على بروجكت معيّن لصاحب المشروع / الأدمن
export const getAssignmentsForProject = async (req, res) => {
  try {
    const ownerId = req.token?.userId;
    const roleId = req.token?.role; // 1 = admin (عندك حسب النظام)
    const projectId = parseInt(req.params.projectId, 10);

    if (!ownerId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    if (Number.isNaN(projectId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid project ID",
      });
    }

    // نتأكد أن المشروع موجود وغير محذوف
    const { rows: projectRows } = await pool.query(
      `
      SELECT id, user_id, title
      FROM projects
      WHERE id = $1
        AND is_deleted = false
      `,
      [projectId]
    );

    if (!projectRows.length) {
      return res.status(404).json({
        success: false,
        message: "Project not found",
      });
    }

    const project = projectRows[0];

    // فقط صاحب المشروع أو الأدمن يقدر يشوف التطبيقات
    if (roleId !== 1 && String(project.user_id) !== String(ownerId)) {
      return res.status(403).json({
        success: false,
        message: "You are not allowed to view applications for this project",
      });
    }

    // التطبيقات على هذا البروجكت
    const { rows: applications } = await pool.query(
      `
      SELECT
        pa.id,
        pa.freelancer_id,
        pa.status,
        pa.assignment_type,
        pa.assigned_at,
        pa.deadline,
        pa.user_invited,
        u.username,
        u.first_name,
        u.last_name,
        u.email,
        u.role_id AS freelancer_role
      FROM project_assignments pa
      JOIN users u ON u.id = pa.freelancer_id
      WHERE pa.project_id = $1
      ORDER BY pa.assigned_at DESC
      `,
      [projectId]
    );

    return res.status(200).json({
      success: true,
      project_id: projectId,
      project_title: project.title,
      applications,
    });
  } catch (err) {
    console.error("getAssignmentsForProject error:", err);
    return res.status(500).json({
      success: false,
      message: "Server error while fetching applications",
    });
  }
};
