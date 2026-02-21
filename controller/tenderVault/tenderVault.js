import pool from "../../models/db.js";

/**
 * Get all tender vault projects with filters
 * GET /tender-vault?status=stored&q=...&page=1&limit=20
 */
export const getTenderVaultProjects = async (req, res) => {
  try {
    const userId = req.token.userId;
    const { status, q, page = 1, limit = 20 } = req.query;

    let query = `
      SELECT 
        tv.id,
        tv.title,
        tv.description,
        tv.category_id,
        tv.budget_min,
        tv.budget_max,
        tv.currency,
        tv.duration_value,
        tv.duration_unit,
        tv.country,
        tv.attachments,
        tv.metadata,
        tv.status,
        tv.created_at,
        tv.updated_at,
        c.name AS category_name,
        sc.name AS sub_category_name,
        ssc.name AS sub_sub_category_name
      FROM tender_vault_projects tv
      LEFT JOIN categories c ON c.id = tv.category_id
      LEFT JOIN sub_categories sc ON sc.id = (tv.metadata->>'sub_category_id')::int
      LEFT JOIN sub_sub_categories ssc ON ssc.id = (tv.metadata->>'sub_sub_category_id')::int
      WHERE tv.created_by = $1 AND tv.is_deleted = false
    `;
    const params = [userId];
    let paramIndex = 2;

    if (status && ['stored', 'published', 'archived'].includes(status)) {
      query += ` AND tv.status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }

    if (q && q.trim()) {
      query += ` AND (tv.title ILIKE $${paramIndex} OR tv.description ILIKE $${paramIndex})`;
      params.push(`%${q.trim()}%`);
      paramIndex++;
    }

    query += ` ORDER BY tv.created_at DESC`;

    // Pagination
    const offset = (Number(page) - 1) * Number(limit);
    query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(Number(limit), offset);

    const { rows } = await pool.query(query, params);

    // Get total count
    let countQuery = `
      SELECT COUNT(*) as total
      FROM tender_vault_projects tv
      WHERE tv.created_by = $1 AND tv.is_deleted = false
    `;
    const countParams = [userId];
    let countParamIndex = 2;

    if (status && ['stored', 'published', 'archived'].includes(status)) {
      countQuery += ` AND tv.status = $${countParamIndex}`;
      countParams.push(status);
      countParamIndex++;
    }

    if (q && q.trim()) {
      countQuery += ` AND (tv.title ILIKE $${countParamIndex} OR tv.description ILIKE $${countParamIndex})`;
      countParams.push(`%${q.trim()}%`);
    }

    const { rows: countRows } = await pool.query(countQuery, countParams);
    const total = Number(countRows[0]?.total || 0);

    return res.json({
      success: true,
      tenders: rows,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        totalPages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (err) {
    // Handle missing table or column gracefully (PostgreSQL error codes 42P01, 42703)
    if (err.code === '42P01' || err.code === '42703' || 
        (err.message?.includes('does not exist') && err.message?.includes('tender_vault_projects')) ||
        (err.message?.includes('column') && err.message?.includes('does not exist'))) {
      console.warn("⚠️  tender_vault_projects table or column missing. Returning empty list. Please run migrations.");
      // Return success with empty list (no error toast in UI)
      return res.json({
        success: true,
        tenders: [],
        warning: "tender_vault_projects table missing, run migrations",
        pagination: {
          page: Number(req.query.page || 1),
          limit: Number(req.query.limit || 20),
          total: 0,
          totalPages: 0,
        },
      });
    }

    console.error("getTenderVaultProjects error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch tender vault projects",
    });
  }
};

/**
 * Get single tender vault project
 * GET /tender-vault/:id
 */
export const getTenderVaultProject = async (req, res) => {
  try {
    const userId = req.token.userId;
    const { id } = req.params;

    const { rows } = await pool.query(
      `SELECT 
        tv.id,
        tv.created_by,
        tv.status,
        tv.title,
        tv.description,
        tv.category_id,
        -- Extract subcategory IDs from metadata JSONB
        (tv.metadata->>'sub_category_id')::int AS sub_category_id,
        (tv.metadata->>'sub_sub_category_id')::int AS sub_sub_category_id,
        tv.budget_min,
        tv.budget_max,
        tv.currency,
        tv.duration_value,
        tv.duration_unit,
        tv.country,
        tv.attachments,
        tv.metadata,
        tv.created_at,
        tv.updated_at,
        -- Rotation system fields
        tv.usage_count,
        tv.max_usage,
        tv.temporary_archived_until,
        tv.last_displayed_at,
        -- Category names (join using extracted IDs)
        c.name AS category_name,
        sc.name AS sub_category_name,
        ssc.name AS sub_sub_category_name,
        -- Creator info
        u.first_name AS creator_first_name,
        u.last_name AS creator_last_name,
        u.email AS creator_email,
        u.username AS creator_username,
        COALESCE(
          NULLIF(TRIM(u.first_name || ' ' || u.last_name), ''),
          u.username,
          'Unknown'
        ) AS creator_name,
        -- Active cycle info from tender_vault_cycles (display window fields)
        tcy.cycle_number,
        tcy.client_public_id,
        tcy.status AS cycle_status,
        tcy.display_start_time,
        tcy.display_end_time
      FROM tender_vault_projects tv
      LEFT JOIN categories c ON c.id = tv.category_id
      LEFT JOIN sub_categories sc ON sc.id = (tv.metadata->>'sub_category_id')::int
      LEFT JOIN sub_sub_categories ssc ON ssc.id = (tv.metadata->>'sub_sub_category_id')::int
      LEFT JOIN users u ON u.id = tv.created_by
      LEFT JOIN LATERAL (
        SELECT cycle_number, client_public_id, display_start_time, display_end_time, status
        FROM tender_vault_cycles
        WHERE tender_id = tv.id AND status = 'active'
        ORDER BY cycle_number DESC
        LIMIT 1
      ) tcy ON true
      WHERE tv.id = $1 AND tv.created_by = $2 AND tv.is_deleted = false`,
      [id, userId]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Tender vault project not found",
      });
    }

    // Parse JSONB fields if they're strings
    const tender = rows[0];
    if (typeof tender.attachments === 'string') {
      try {
        tender.attachments = JSON.parse(tender.attachments);
      } catch (e) {
        tender.attachments = [];
      }
    }
    if (typeof tender.metadata === 'string') {
      try {
        tender.metadata = JSON.parse(tender.metadata);
      } catch (e) {
        tender.metadata = {};
      }
    }
    if (!Array.isArray(tender.attachments)) {
      tender.attachments = [];
    }
    if (!tender.metadata || typeof tender.metadata !== 'object') {
      tender.metadata = {};
    }

    return res.json({
      success: true,
      tender,
    });
  } catch (err) {
    console.error("getTenderVaultProject error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch tender vault project",
    });
  }
};

/**
 * Create tender vault project
 * POST /tender-vault
 */
export const createTenderVaultProject = async (req, res) => {
  try {
    const userId = req.token.userId;
    
    // Map request body fields from camelCase to snake_case
    const {
      title,
      description,
      categoryId,
      category_id,
      budgetMin,
      budget_min,
      budgetMax,
      budget_max,
      currency = 'JD',
      durationValue,
      duration_value,
      durationUnit,
      duration_unit,
      country,
      attachments,
      metadata,
    } = req.body;

    // Normalize to snake_case
    const category_id_final = category_id || categoryId;
    const budget_min_final = budget_min || budgetMin;
    const budget_max_final = budget_max || budgetMax;
    const duration_value_final = duration_value || durationValue;
    const duration_unit_final = duration_unit || durationUnit;

    // Validation (same as normal bidding projects)
    if (!title || !title.trim()) {
      return res.status(400).json({
        success: false,
        message: "Title is required",
      });
    }

    if (title.trim().length < 10 || title.trim().length > 100) {
      return res.status(400).json({
        success: false,
        message: "Title must be between 10 and 100 characters",
      });
    }

    if (!description || description.trim().length < 100 || description.trim().length > 2000) {
      return res.status(400).json({
        success: false,
        message: "Description must be between 100 and 2000 characters",
      });
    }

    if (!category_id_final) {
      return res.status(400).json({
        success: false,
        message: "Category is required",
      });
    }

    // Validate bidding project fields
    if (!budget_min_final || budget_min_final <= 0) {
      return res.status(400).json({
        success: false,
        message: "Min budget must be greater than 0",
      });
    }
    if (!budget_max_final || budget_max_final <= 0) {
      return res.status(400).json({
        success: false,
        message: "Max budget must be greater than 0",
      });
    }
    if (Number(budget_max_final) < Number(budget_min_final)) {
      return res.status(400).json({
        success: false,
        message: "Max budget must be greater than min budget",
      });
    }

    // Prepare JSONB fields
    const attachmentsJson = Array.isArray(attachments) 
      ? attachments 
      : (typeof attachments === 'string' ? JSON.parse(attachments) : []);
    const metadataJson = typeof metadata === 'object' && metadata !== null
      ? metadata
      : (typeof metadata === 'string' ? JSON.parse(metadata) : {});

    // Insert using EXACT column names from table schema
    const { rows } = await pool.query(
      `INSERT INTO tender_vault_projects (
        created_by, status, title, description, category_id, budget_min, budget_max, 
        currency, duration_value, duration_unit, country, attachments, metadata
      ) VALUES ($1, 'stored', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *`,
      [
        userId,
        title.trim(),
        description.trim(),
        category_id_final,
        Number(budget_min_final),
        Number(budget_max_final),
        currency,
        duration_value_final ? Number(duration_value_final) : null,
        duration_unit_final || null,
        country || null,
        JSON.stringify(attachmentsJson),
        JSON.stringify(metadataJson),
      ]
    );

    return res.status(201).json({
      success: true,
      tender: rows[0],
      message: "Tender vault project created successfully",
    });
  } catch (err) {
    console.error("createTenderVaultProject error:", err);
    
    // Check for missing table or column errors
    if (err.code === '42P01' || err.code === '42703') {
      return res.status(500).json({
        success: false,
        message: "Tender Vault DB schema mismatch. Run migrations.",
        error: err.code === '42P01' ? 'Table does not exist' : 'Column does not exist',
        code: err.code,
      });
    }
    
    return res.status(500).json({
      success: false,
      message: err.message || "Failed to create tender vault project",
    });
  }
};

/**
 * Update tender vault project
 * PUT /tender-vault/:id
 */
export const updateTenderVaultProject = async (req, res) => {
  try {
    const userId = req.token.userId;
    const { id } = req.params;
    const {
      title,
      description,
      category_id,
      budget_min,
      budget_max,
      deadline,
      attachments,
    } = req.body;

    // Check if project exists and belongs to user
    const { rows: existing } = await pool.query(
      `SELECT id FROM tender_vault_projects WHERE id = $1 AND created_by = $2 AND is_deleted = false`,
      [id, userId]
    );

    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Tender vault project not found",
      });
    }

    const updates = [];
    const params = [];
    let paramIndex = 1;

    if (title !== undefined) {
      updates.push(`title = $${paramIndex}`);
      params.push(title.trim());
      paramIndex++;
    }
    if (description !== undefined) {
      updates.push(`description = $${paramIndex}`);
      params.push(description?.trim() || null);
      paramIndex++;
    }
    if (req.body.category_id !== undefined) {
      updates.push(`category_id = $${paramIndex}`);
      params.push(req.body.category_id || null);
      paramIndex++;
    }
    // Note: sub_category_id, sub_sub_category_id, project_type not in schema - skip
    if (budget_min !== undefined) {
      updates.push(`budget_min = $${paramIndex}`);
      params.push(budget_min || null);
      paramIndex++;
    }
    if (budget_max !== undefined) {
      updates.push(`budget_max = $${paramIndex}`);
      params.push(budget_max || null);
      paramIndex++;
    }
    if (req.body.currency !== undefined) {
      updates.push(`currency = $${paramIndex}`);
      params.push(req.body.currency);
      paramIndex++;
    }
    // Map duration fields to new schema
    if (req.body.durationValue !== undefined || req.body.duration_value !== undefined) {
      updates.push(`duration_value = $${paramIndex}`);
      params.push(Number(req.body.durationValue || req.body.duration_value) || null);
      paramIndex++;
    }
    if (req.body.durationUnit !== undefined || req.body.duration_unit !== undefined) {
      updates.push(`duration_unit = $${paramIndex}`);
      params.push(req.body.durationUnit || req.body.duration_unit || null);
      paramIndex++;
    }
    if (req.body.country !== undefined) {
      updates.push(`country = $${paramIndex}`);
      params.push(req.body.country || null);
      paramIndex++;
    }
    if (req.body.attachments !== undefined) {
      updates.push(`attachments = $${paramIndex}`);
      const attachmentsJson = Array.isArray(req.body.attachments) 
        ? req.body.attachments 
        : (typeof req.body.attachments === 'string' ? JSON.parse(req.body.attachments) : []);
      params.push(JSON.stringify(attachmentsJson));
      paramIndex++;
    }
    if (req.body.metadata !== undefined) {
      updates.push(`metadata = $${paramIndex}`);
      const metadataJson = typeof req.body.metadata === 'object' && req.body.metadata !== null
        ? req.body.metadata
        : (typeof req.body.metadata === 'string' ? JSON.parse(req.body.metadata) : {});
      params.push(JSON.stringify(metadataJson));
      paramIndex++;
    }

    if (updates.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No fields to update",
      });
    }

    // updated_at is handled by trigger
    params.push(id, userId);

    const { rows } = await pool.query(
      `UPDATE tender_vault_projects 
       SET ${updates.join(', ')}
       WHERE id = $${paramIndex} AND created_by = $${paramIndex + 1} AND is_deleted = false
       RETURNING *`,
      params
    );

    return res.json({
      success: true,
      tender: rows[0],
      message: "Tender vault project updated successfully",
    });
  } catch (err) {
    console.error("updateTenderVaultProject error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to update tender vault project",
    });
  }
};

/**
 * Update tender vault project status
 * PATCH /tender-vault/:id/status
 */
export const updateTenderVaultProjectStatus = async (req, res) => {
  try {
    const userId = req.token.userId;
    const { id } = req.params;
    const { status } = req.body;

    if (!['stored', 'published', 'archived'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid status. Must be 'stored', 'published', or 'archived'",
      });
    }

    // Check if project exists and belongs to user
    const { rows: existing } = await pool.query(
      `SELECT id FROM tender_vault_projects WHERE id = $1 AND created_by = $2 AND is_deleted = false`,
      [id, userId]
    );

    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Tender vault project not found",
      });
    }

    // Update status (metadata can store published_at/archived_at if needed)
    let updateQuery = `UPDATE tender_vault_projects 
       SET status = $1`;
    const updateParams = [status];
    
    // updated_at is handled by trigger
    updateQuery += ` WHERE id = $2 AND created_by = $3 AND is_deleted = false RETURNING *`;
    updateParams.push(id, userId);

    const { rows } = await pool.query(updateQuery, updateParams);

    return res.json({
      success: true,
      tender: rows[0],
      message: `Tender vault project status updated to ${status}`,
    });
  } catch (err) {
    console.error("updateTenderVaultProjectStatus error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to update tender vault project status",
    });
  }
};

/**
 * Delete tender vault project
 * DELETE /tender-vault/:id
 */
export const deleteTenderVaultProject = async (req, res) => {
  try {
    const userId = req.token.userId;
    const { id } = req.params;

    // Soft delete
    const { rows } = await pool.query(
      `UPDATE tender_vault_projects 
       SET is_deleted = true
       WHERE id = $1 AND created_by = $2 AND is_deleted = false
       RETURNING id`,
      [id, userId]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Tender vault project not found",
      });
    }

    return res.json({
      success: true,
      message: "Tender vault project deleted successfully",
    });
  } catch (err) {
    console.error("deleteTenderVaultProject error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to delete tender vault project",
    });
  }
};
