import pool from "../../models/db.js";

/**
 * Shared filter based on type/status
 */
const buildStatusCondition = () => {
  return `
    AND p.is_deleted = false
    AND (
      (p.project_type IN ('fixed', 'hourly') AND p.status = 'active')
      OR (p.status = 'bidding')
    )
  `;
};

/* ===================================================
    AUTHENTICATED ROUTES (Require Token)
   =================================================== */

/**
 * Get projects by main category
 */
export const getProjectsByCategory = async (req, res) => {
  const { category_id } = req.params;
  const userId = req.token?.userId;

  try {
    const { rows } = await pool.query(
      `
      SELECT 
        p.*, 
        c.name AS category_name,
        sc.name AS sub_category_name,
        ssc.name AS sub_sub_category_name,
        u.first_name,
        u.last_name,
        u.profile_pic_url
      FROM projects p
      JOIN categories c ON p.category_id = c.id
      LEFT JOIN sub_categories sc ON p.sub_category_id = sc.id
      LEFT JOIN sub_sub_categories ssc ON p.sub_sub_category_id = ssc.id
      LEFT JOIN users u ON u.id = p.user_id
      WHERE p.category_id = $1
      ${buildStatusCondition()}
      ORDER BY p.created_at DESC
      `,
      [category_id]
    );

    return res.status(200).json({
      success: true,
      projects: rows,
      userId,
      note:
        rows.length === 0
          ? "No available projects in this category."
          : undefined,
    });
  } catch (error) {
    console.error("Error fetching projects by category:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * Get projects by sub-category
 */
export const getProjectsBySubCategory = async (req, res) => {
  const { sub_category_id } = req.params;
  const userId = req.token?.userId;

  try {
    const { rows } = await pool.query(
      `
      SELECT 
        p.*, 
        sc.name AS sub_category_name,
        c.name AS category_name,
        ssc.name AS sub_sub_category_name,
        u.first_name,
        u.last_name,
        u.profile_pic_url
      FROM projects p
      JOIN sub_categories sc ON p.sub_category_id = sc.id
      JOIN categories c ON sc.category_id = c.id
      LEFT JOIN sub_sub_categories ssc ON p.sub_sub_category_id = ssc.id
      LEFT JOIN users u ON u.id = p.user_id
      WHERE p.sub_category_id = $1
      ${buildStatusCondition()}
      ORDER BY p.created_at DESC
      `,
      [sub_category_id]
    );

    return res.status(200).json({
      success: true,
      projects: rows,
      userId,
      note:
        rows.length === 0
          ? "No available projects in this sub-category."
          : undefined,
    });
  } catch (error) {
    console.error("Error fetching projects by sub-category:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * Get projects by sub-sub-category
 */
export const getProjectsBySubSubCategory = async (req, res) => {
  const { sub_sub_category_id } = req.params;
  const userId = req.token?.userId;

  try {
    const { rows } = await pool.query(
      `
      SELECT 
        p.*, 
        ssc.name AS sub_sub_category_name,
        sc.name AS sub_category_name,
        c.name AS category_name,
        u.first_name,
        u.last_name,
        u.profile_pic_url
      FROM projects p
      JOIN sub_sub_categories ssc ON p.sub_sub_category_id = ssc.id
      JOIN sub_categories sc ON ssc.sub_category_id = sc.id
      JOIN categories c ON sc.category_id = c.id
      LEFT JOIN users u ON u.id = p.user_id
      WHERE p.sub_sub_category_id = $1
      ${buildStatusCondition()}
      ORDER BY p.created_at DESC
      `,
      [sub_sub_category_id]
    );

    return res.status(200).json({
      success: true,
      projects: rows,
      userId,
      note:
        rows.length === 0
          ? "No available projects in this sub-sub-category."
          : undefined,
    });
  } catch (error) {
    console.error("Error fetching projects by sub-sub-category:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

/* ===================================================
   PUBLIC ROUTES (NO AUTH)
   =================================================== */

export const getPublicCategories = async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name 
       FROM categories 
       WHERE is_active = true 
       ORDER BY name`
    );
    res.json({ success: true, categories: rows });
  } catch (error) {
    console.error("getPublicCategories error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

export const getProjectsByCategoryId = async (req, res) => {
  try {
    const { categoryId } = req.params;

    if (!categoryId || isNaN(categoryId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid category ID" });
    }

    const result = await pool.query(
      `
      SELECT 
        p.*, 
        u.username AS client_username, 
        u.first_name,
        u.last_name,
        u.profile_pic_url,
        c.name AS category_name
      FROM projects p
      JOIN users u ON u.id = p.user_id
      JOIN categories c ON c.id = p.category_id
      WHERE 
        p.category_id = $1 
        AND p.is_deleted = false
        AND p.status = 'bidding'
      ORDER BY p.created_at DESC
      `,
      [categoryId]
    );

    return res.json({ success: true, projects: result.rows });
  } catch (error) {
    console.error("getProjectsByCategoryId error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

export const getProjectsBySubCategoryId = async (req, res) => {
  try {
    const { subCategoryId } = req.params;

    if (!subCategoryId || isNaN(subCategoryId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid subcategory ID" });
    }

    const result = await pool.query(
      `
      SELECT 
        p.*, 
        u.username AS client_username, 
        u.first_name,
        u.last_name,
        u.profile_pic_url,
        c.name AS category_name,
        sc.name AS sub_category_name
      FROM projects p
      JOIN users u ON u.id = p.user_id
      JOIN categories c ON c.id = p.category_id
      LEFT JOIN sub_categories sc ON sc.id = p.sub_category_id
      WHERE 
        p.sub_category_id = $1 
        AND p.is_deleted = false
        AND p.status = 'bidding'
      ORDER BY p.created_at DESC;
      `,
      [subCategoryId]
    );

    return res.json({ success: true, projects: result.rows });
  } catch (error) {
    console.error("getProjectsBySubCategoryId error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

export const getProjectsBySubSubCategoryId = async (req, res) => {
  try {
    const { subSubCategoryId } = req.params;

    if (!subSubCategoryId || isNaN(subSubCategoryId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid sub-subcategory ID" });
    }

    const { rows } = await pool.query(
      `
      SELECT 
        p.*,
        u.username AS client_username,
        u.first_name,
        u.last_name,
        u.profile_pic_url,
        c.name AS category_name,
        sc.name AS sub_category_name,
        ssc.name AS sub_sub_category_name
      FROM projects p
      JOIN users u ON u.id = p.user_id
      LEFT JOIN categories c ON c.id = p.category_id
      LEFT JOIN sub_categories sc ON sc.id = p.sub_category_id
      LEFT JOIN sub_sub_categories ssc ON ssc.id = p.sub_sub_category_id
      WHERE 
        p.sub_sub_category_id = $1 
        AND p.is_deleted = false
        AND p.status = 'bidding'
      ORDER BY p.created_at DESC;
      `,
      [subSubCategoryId]
    );

    return res.json({ success: true, projects: rows });
  } catch (err) {
    console.error("getProjectsBySubSubCategoryId error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/* ===================================================
   PROJECT DETAILS / BY USER ROLE / FILES
   =================================================== */

export const getProjectById = async (req, res) => {
  try {
    const { projectId } = req.params;

    if (!projectId) {
      return res
        .status(400)
        .json({ success: false, message: "projectId is required" });
    }

    const { rows: projectRows } = await pool.query(
      `SELECT 
         p.*,
         u.username AS client_username,
         u.email AS client_email,
         u.first_name,
         u.last_name,
         u.profile_pic_url,
         COALESCE(
           NULLIF(TRIM(u.first_name || ' ' || u.last_name), ''),
           u.username,
           'Anonymous'
         ) AS client_fullname,
         c.name AS category_name,
         sc.name AS sub_category_name,
         ssc.name AS sub_sub_category_name
       FROM projects p
       LEFT JOIN users u ON p.user_id = u.id
       LEFT JOIN categories c ON p.category_id = c.id
       LEFT JOIN sub_categories sc ON p.sub_category_id = sc.id
       LEFT JOIN sub_sub_categories ssc ON p.sub_sub_category_id = ssc.id
       WHERE p.id = $1 
         AND p.is_deleted = false`,
      [projectId]
    );

    if (!projectRows.length) {
      return res
        .status(404)
        .json({ success: false, message: "Project not found" });
    }

    const project = projectRows[0];

    return res.status(200).json({ success: true, project });
  } catch (err) {
    console.error("getProjectById error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

export const getProjectsByUserRole = async (req, res) => {
  try {
    const userId = req.token?.userId;
    const roleId = req.token?.role;

    if (!userId || !roleId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized or invalid token",
      });
    }

    const { q, status, created_at } = req.query;

    let roleLabel = "";
    let query = "";
    const params = [userId];
    let idx = 2;

    if (roleId === 2) {
      roleLabel = "client";
      query = `
        SELECT 
          p.*,
          u.username AS client_username,
          c.name AS category_name,
          sc.name AS sub_category_name,
          ssc.name AS sub_sub_category_name
        FROM projects p
        JOIN users u ON p.user_id = u.id
        LEFT JOIN categories c ON p.category_id = c.id
        LEFT JOIN sub_categories sc ON p.sub_category_id = sc.id
        LEFT JOIN sub_sub_categories ssc ON p.sub_sub_category_id = ssc.id
        WHERE p.user_id = $1
          AND p.is_deleted = false
      `;
    } else if (roleId === 3) {
      roleLabel = "freelancer";
      query = `
        SELECT 
          p.*,
          u.username AS client_username,
          c.name AS category_name,
          sc.name AS sub_category_name,
          ssc.name AS sub_sub_category_name,
          pa.status AS assignment_status,
          pa.assignment_type,
          pa.deadline
        FROM projects p
        JOIN project_assignments pa ON pa.project_id = p.id
        JOIN users u ON p.user_id = u.id
        LEFT JOIN categories c ON p.category_id = c.id
        LEFT JOIN sub_categories sc ON p.sub_category_id = sc.id
        LEFT JOIN sub_sub_categories ssc ON p.sub_sub_category_id = ssc.id
         WHERE pa.freelancer_id = $1
      AND p.is_deleted = false
      AND pa.status = 'active'
      `;
    } else {
      return res
        .status(403)
        .json({ success: false, message: "Role not allowed" });
    }

    if (q && q.trim()) {
      query += ` AND (p.title ILIKE $${idx} OR p.description ILIKE $${idx})`;
      params.push(`%${q.trim()}%`);
      idx++;
    }

    if (status && status.trim()) {
      query += ` AND p.status = $${idx}`;
      params.push(status.trim());
      idx++;
    }

    const sortDirection =
      created_at && created_at.toLowerCase() === "asc" ? "ASC" : "DESC";
    query += ` ORDER BY p.created_at ${sortDirection}`;

    const { rows } = await pool.query(query, params);

    return res.status(200).json({
      success: true,
      role: roleLabel,
      total: rows.length,
      projects: rows,
      filters: {
        q: q || null,
        status: status || "all",
        created_at: sortDirection,
      },
      note:
        rows.length === 0
          ? `No projects found for this ${roleLabel} with given filters.`
          : undefined,
    });
  } catch (error) {
    console.error("getProjectsByUserRole error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

export const getProjectFilesByProjectId = async (req, res) => {
  try {
    const { projectId } = req.params;

    if (!projectId || isNaN(projectId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid or missing project ID.",
      });
    }

    const { rows } = await pool.query(
      `
      SELECT 
        pf.id,
        pf.project_id,
        pf.sender_id,
        CONCAT(u.first_name, ' ', u.last_name) AS sender_name,
        u.role_id AS sender_role,
        pf.file_name,
        pf.file_url,
        pf.file_size,
        pf.public_id,
        pf.sent_at
      FROM project_files pf
      JOIN users u ON u.id = pf.sender_id
      WHERE pf.project_id = $1
      ORDER BY pf.sent_at DESC;
      `,
      [projectId]
    );

    if (rows.length === 0) {
      return res.status(200).json({
        success: true,
        count: 0,
        files: [],
        note: "No files found for this project.",
      });
    }

    return res.status(200).json({
      success: true,
      count: rows.length,
      files: rows,
    });
  } catch (error) {
    console.error("getProjectFilesByProjectId error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error while fetching project files.",
    });
  }
};