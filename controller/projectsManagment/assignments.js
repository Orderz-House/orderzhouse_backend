
import pool from "../../models/db.js";

export const getAssignmentForFreelancer = async (req, res) => {
  try {
    const { projectId } = req.params;
    const freelancerId = req.token?.userId; 

    if (!projectId || !freelancerId) {
      return res
        .status(400)
        .json({ success: false, message: "projectId and freelancerId are required" });
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
        COALESCE(NULLIF(TRIM(u.first_name || ' ' || u.last_name), ''), u.username, 'Anonymous') AS client_fullname,
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
      return res.status(404).json({ success: false, message: "No assignment found for this project" });
    }

    return res.status(200).json({ success: true, assignment: rows[0] });
  } catch (err) {
    console.error("getAssignmentForFreelancer error:", err);
    return res.status(500).json({ success: false, message: "Server error", error: err.message });
  }
};

/**
 * Check if a freelancer is assigned to a given project
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
      `SELECT 1 FROM project_assignments 
       WHERE project_id = $1 AND freelancer_id = $2 
       LIMIT 1`,
      [projectId, freelancerId]
    );

    const isAssigned = rows.length > 0;

    return res.status(200).json({ success: true, is_assigned: isAssigned });
  } catch (err) {
    console.error("checkIfAssigned error:", err);
    return res
      .status(500)
      .json({ success: false, message: "Server error", error: err.message });
  }
};