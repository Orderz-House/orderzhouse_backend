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

/**
 * Helper: Fetch published tender vault projects and map to project shape
 * Returns empty array if table doesn't exist (graceful degradation)
 */
async function fetchPublishedTenders(filters) {
  const { categoryId, subCategoryId, subSubCategoryId, search } = filters;
  
  try {
    // Show both 'published' (manual) and 'active' (rotated) tenders in marketplace
    let tenderWhereConditions = `tv.status IN ('published', 'active') AND tv.is_deleted = false`;
    const tenderParams = [];
    let paramIndex = 1;

    if (categoryId) {
      tenderWhereConditions += ` AND tv.category_id = $${paramIndex}`;
      tenderParams.push(categoryId);
      paramIndex++;
    }

    if (subCategoryId) {
      tenderWhereConditions += ` AND (tv.metadata->>'sub_category_id')::int = $${paramIndex}`;
      tenderParams.push(subCategoryId);
      paramIndex++;
    }

    if (subSubCategoryId) {
      tenderWhereConditions += ` AND (tv.metadata->>'sub_sub_category_id')::int = $${paramIndex}`;
      tenderParams.push(subSubCategoryId);
      paramIndex++;
    }

    if (search && search.trim()) {
      tenderWhereConditions += ` AND (tv.title ILIKE $${paramIndex} OR tv.description ILIKE $${paramIndex})`;
      tenderParams.push(`%${search.trim()}%`);
      paramIndex++;
    }

    // Map tender_vault_projects to match projects table response shape
    // Extract subcategory IDs from metadata JSONB
    const tenderQuery = `
      SELECT 
        tv.id,
        tv.title,
        tv.description,
        tv.category_id,
        -- Extract subcategory IDs from metadata
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
        -- Map to project shape
        tv.created_by AS user_id,
        'bidding' AS project_type,
        'bidding' AS status,
        'not_started' AS completion_status,
        false AS is_deleted,
        NULL AS budget,
        NULL AS hourly_rate,
        NULL AS preferred_skills,
        NULL AS cover_pic,
        -- Map duration_value/unit to duration_days/hours for frontend compatibility
        CASE 
          WHEN tv.duration_unit = 'days' THEN tv.duration_value
          WHEN tv.duration_unit = 'hours' THEN NULL
          ELSE NULL
        END AS duration_days,
        CASE 
          WHEN tv.duration_unit = 'hours' THEN tv.duration_value
          WHEN tv.duration_unit = 'days' THEN NULL
          ELSE NULL
        END AS duration_hours,
        COALESCE(tv.duration_unit, 'days') AS duration_type,
        -- User info
        u.username AS client_username,
        u.first_name,
        u.last_name,
        u.profile_pic_url,
        -- Category info (join using extracted IDs)
        c.name AS category_name,
        sc.name AS sub_category_name,
        ssc.name AS sub_sub_category_name,
        -- Internal flag (not exposed to frontend, but useful for backend)
        true AS _is_tender_vault
      FROM tender_vault_projects tv
      JOIN users u ON u.id = tv.created_by
      LEFT JOIN categories c ON c.id = tv.category_id
      LEFT JOIN sub_categories sc ON sc.id = (tv.metadata->>'sub_category_id')::int
      LEFT JOIN sub_sub_categories ssc ON ssc.id = (tv.metadata->>'sub_sub_category_id')::int
      WHERE ${tenderWhereConditions}
    `;

    const { rows } = await pool.query(tenderQuery, tenderParams);
    return rows;
  } catch (err) {
    // If table doesn't exist (42P01) or column missing (42703), return empty array
    if (err.code === '42P01' || err.code === '42703') {
      console.warn("⚠️  tender_vault_projects table/column missing. Skipping tenders. Run migrations.");
      return [];
    }
    console.error("Error fetching published tenders:", err);
    return [];
  }
}

/* ===================================================
    AUTHENTICATED ROUTES (Require Token)
   =================================================== */

/**
 * Get projects by main category
 */
export const getProjectsByCategory = async (req, res) => {
  const { category_id } = req.params;
  const userId = req.token?.userId;
  const { search, sortBy } = req.query;

  try {
    // Build query using conditions array pattern
    const conditions = [];
    const params = [];
    let paramIndex = 1;
    
    // Always exclude deleted projects
    conditions.push(`p.is_deleted = false`);
    
    // Always apply status filter
    conditions.push(`(
      (p.project_type IN ('fixed', 'hourly') AND p.status = 'active')
      OR (p.status = 'bidding')
    )`);
    
    // Only apply category filter if NOT "all"
    if (category_id && category_id !== "all") {
      conditions.push(`p.category_id = $${paramIndex}`);
      params.push(Number(category_id));
      paramIndex++;
    }

    // Add search filter if provided
    if (search && search.trim()) {
      conditions.push(`(p.title ILIKE $${paramIndex} OR p.description ILIKE $${paramIndex})`);
      params.push(`%${search.trim()}%`);
      paramIndex++;
    }
    
    // Build WHERE clause - always has conditions (at least is_deleted and status)
    const whereClause = conditions.join(" AND ");

    // Build ORDER BY clause based on sortBy
    let orderBy = 'p.created_at DESC'; // Default: newest first
    if (sortBy) {
      switch (sortBy.toLowerCase()) {
        case 'newest':
          orderBy = 'p.created_at DESC';
          break;
        case 'price_low_to_high':
          orderBy = `CASE 
            WHEN p.project_type = 'fixed' AND p.budget IS NOT NULL THEN p.budget
            WHEN p.project_type = 'hourly' AND p.hourly_rate IS NOT NULL THEN p.hourly_rate
            WHEN p.project_type = 'bidding' AND p.budget_min IS NOT NULL THEN p.budget_min
            ELSE 999999
          END ASC`;
          break;
        case 'price_high_to_low':
          orderBy = `CASE 
            WHEN p.project_type = 'fixed' AND p.budget IS NOT NULL THEN p.budget
            WHEN p.project_type = 'hourly' AND p.hourly_rate IS NOT NULL THEN p.hourly_rate
            WHEN p.project_type = 'bidding' AND p.budget_max IS NOT NULL THEN p.budget_max
            ELSE 0
          END DESC`;
          break;
        default:
          orderBy = 'p.created_at DESC';
      }
    }

    // Build final query with proper WHERE clause
    const query = `
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
      WHERE ${whereClause}
      ORDER BY ${orderBy}
    `;

    const { rows: projectRows } = await pool.query(query, params);

    // Fetch published tenders for the same category (or all if "all" selected)
    const tenderRows = await fetchPublishedTenders({
      categoryId: (category_id && category_id !== "all") ? category_id : null,
      search,
    });

    // Combine and sort
    const allRows = [...projectRows, ...tenderRows];
    
    // Manual sorting (since UNION ALL doesn't preserve ORDER BY across different sources)
    if (sortBy) {
      allRows.sort((a, b) => {
        switch (sortBy.toLowerCase()) {
          case 'newest':
            return new Date(b.created_at) - new Date(a.created_at);
          case 'price_low_to_high':
            const aPrice = a.budget_min || a.budget || a.hourly_rate || 999999;
            const bPrice = b.budget_min || b.budget || b.hourly_rate || 999999;
            return aPrice - bPrice;
          case 'price_high_to_low':
            const aPriceHigh = a.budget_max || a.budget || a.hourly_rate || 0;
            const bPriceHigh = b.budget_max || b.budget || b.hourly_rate || 0;
            return bPriceHigh - aPriceHigh;
          default:
            return new Date(b.created_at) - new Date(a.created_at);
        }
      });
    } else {
      allRows.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    }

    return res.status(200).json({
      success: true,
      projects: allRows,
      userId,
      note:
        allRows.length === 0
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
  const { search, sortBy } = req.query;

  try {
    let whereConditions = `p.sub_category_id = $1 ${buildStatusCondition()}`;
    const params = [sub_category_id];
    let paramIndex = 2;

    if (search && search.trim()) {
      whereConditions += ` AND (p.title ILIKE $${paramIndex} OR p.description ILIKE $${paramIndex})`;
      params.push(`%${search.trim()}%`);
      paramIndex++;
    }

    let orderBy = 'p.created_at DESC';
    if (sortBy) {
      switch (sortBy.toLowerCase()) {
        case 'newest':
          orderBy = 'p.created_at DESC';
          break;
        case 'price_low_to_high':
          orderBy = `CASE 
            WHEN p.project_type = 'fixed' AND p.budget IS NOT NULL THEN p.budget
            WHEN p.project_type = 'hourly' AND p.hourly_rate IS NOT NULL THEN p.hourly_rate
            WHEN p.project_type = 'bidding' AND p.budget_min IS NOT NULL THEN p.budget_min
            ELSE 999999
          END ASC`;
          break;
        case 'price_high_to_low':
          orderBy = `CASE 
            WHEN p.project_type = 'fixed' AND p.budget IS NOT NULL THEN p.budget
            WHEN p.project_type = 'hourly' AND p.hourly_rate IS NOT NULL THEN p.hourly_rate
            WHEN p.project_type = 'bidding' AND p.budget_max IS NOT NULL THEN p.budget_max
            ELSE 0
          END DESC`;
          break;
        default:
          orderBy = 'p.created_at DESC';
      }
    }

    const { rows: projectRows } = await pool.query(
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
      WHERE ${whereConditions}
      ORDER BY ${orderBy}
      `,
      params
    );

    // Fetch published tenders for the same sub-category
    const tenderRows = await fetchPublishedTenders({
      subCategoryId: sub_category_id,
      search,
    });

    // Combine and sort
    const allRows = [...projectRows, ...tenderRows];
    
    if (sortBy) {
      allRows.sort((a, b) => {
        switch (sortBy.toLowerCase()) {
          case 'newest':
            return new Date(b.created_at) - new Date(a.created_at);
          case 'price_low_to_high':
            const aPrice = a.budget_min || a.budget || a.hourly_rate || 999999;
            const bPrice = b.budget_min || b.budget || b.hourly_rate || 999999;
            return aPrice - bPrice;
          case 'price_high_to_low':
            const aPriceHigh = a.budget_max || a.budget || a.hourly_rate || 0;
            const bPriceHigh = b.budget_max || b.budget || b.hourly_rate || 0;
            return bPriceHigh - aPriceHigh;
          default:
            return new Date(b.created_at) - new Date(a.created_at);
        }
      });
    } else {
      allRows.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    }

    return res.status(200).json({
      success: true,
      projects: allRows,
      userId,
      note:
        allRows.length === 0
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
  const { search, sortBy } = req.query;

  try {
    let whereConditions = `p.sub_sub_category_id = $1 ${buildStatusCondition()}`;
    const params = [sub_sub_category_id];
    let paramIndex = 2;

    if (search && search.trim()) {
      whereConditions += ` AND (p.title ILIKE $${paramIndex} OR p.description ILIKE $${paramIndex})`;
      params.push(`%${search.trim()}%`);
      paramIndex++;
    }

    let orderBy = 'p.created_at DESC';
    if (sortBy) {
      switch (sortBy.toLowerCase()) {
        case 'newest':
          orderBy = 'p.created_at DESC';
          break;
        case 'price_low_to_high':
          orderBy = `CASE 
            WHEN p.project_type = 'fixed' AND p.budget IS NOT NULL THEN p.budget
            WHEN p.project_type = 'hourly' AND p.hourly_rate IS NOT NULL THEN p.hourly_rate
            WHEN p.project_type = 'bidding' AND p.budget_min IS NOT NULL THEN p.budget_min
            ELSE 999999
          END ASC`;
          break;
        case 'price_high_to_low':
          orderBy = `CASE 
            WHEN p.project_type = 'fixed' AND p.budget IS NOT NULL THEN p.budget
            WHEN p.project_type = 'hourly' AND p.hourly_rate IS NOT NULL THEN p.hourly_rate
            WHEN p.project_type = 'bidding' AND p.budget_max IS NOT NULL THEN p.budget_max
            ELSE 0
          END DESC`;
          break;
        default:
          orderBy = 'p.created_at DESC';
      }
    }

    const { rows: projectRows } = await pool.query(
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
      WHERE ${whereConditions}
      ORDER BY ${orderBy}
      `,
      params
    );

    // Fetch published tenders for the same sub-sub-category
    const tenderRows = await fetchPublishedTenders({
      subSubCategoryId: sub_sub_category_id,
      search,
    });

    // Combine and sort
    const allRows = [...projectRows, ...tenderRows];
    
    if (sortBy) {
      allRows.sort((a, b) => {
        switch (sortBy.toLowerCase()) {
          case 'newest':
            return new Date(b.created_at) - new Date(a.created_at);
          case 'price_low_to_high':
            const aPrice = a.budget_min || a.budget || a.hourly_rate || 999999;
            const bPrice = b.budget_min || b.budget || b.hourly_rate || 999999;
            return aPrice - bPrice;
          case 'price_high_to_low':
            const aPriceHigh = a.budget_max || a.budget || a.hourly_rate || 0;
            const bPriceHigh = b.budget_max || b.budget || b.hourly_rate || 0;
            return bPriceHigh - aPriceHigh;
          default:
            return new Date(b.created_at) - new Date(a.created_at);
        }
      });
    } else {
      allRows.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    }

    return res.status(200).json({
      success: true,
      projects: allRows,
      userId,
      note:
        allRows.length === 0
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
    const { search, sortBy } = req.query;

    // STEP 2: Handle "all" category - skip category filter
    const isAllCategory = !categoryId || categoryId === "all" || categoryId === "undefined" || categoryId === "null";
    
    // Only validate if NOT "all"
    if (!isAllCategory && isNaN(categoryId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid category ID" });
    }

    // STEP 2: Use conditions array pattern (CORRECT WAY)
    const conditions = [];
    const params = [];
    let paramIndex = 1;
    
    // Add base status conditions
    conditions.push(`p.is_deleted = false`);
    
    // Apply correct status filter for all project types (fixed, hourly, bidding)
    conditions.push(`(
      (p.project_type IN ('fixed', 'hourly') AND p.status = 'active')
      OR (p.status = 'bidding')
    )`);
    
    // Only add category filter if NOT "all"
    if (!isAllCategory) {
      conditions.push(`p.category_id = $${paramIndex}`);
      params.push(categoryId);
      paramIndex++;
    }

    // Add search filter if provided
    if (search && search.trim()) {
      conditions.push(`(p.title ILIKE $${paramIndex} OR p.description ILIKE $${paramIndex})`);
      params.push(`%${search.trim()}%`);
      paramIndex++;
    }
    
    // Build WHERE clause - always has conditions (at least is_deleted and status)
    const whereClause = conditions.join(" AND ");

    // Build ORDER BY clause based on sortBy
    let orderBy = 'p.created_at DESC'; // Default: newest first
    if (sortBy) {
      switch (sortBy.toLowerCase()) {
        case 'newest':
          orderBy = 'p.created_at DESC';
          break;
        case 'price_low_to_high':
          // Sort by budget (fixed) or hourly_rate (hourly), or budget_min (bidding)
          orderBy = `CASE 
            WHEN p.project_type = 'fixed' AND p.budget IS NOT NULL THEN p.budget
            WHEN p.project_type = 'hourly' AND p.hourly_rate IS NOT NULL THEN p.hourly_rate
            WHEN p.project_type = 'bidding' AND p.budget_min IS NOT NULL THEN p.budget_min
            ELSE 999999
          END ASC`;
          break;
        case 'price_high_to_low':
          // Sort by budget (fixed) or hourly_rate (hourly), or budget_max (bidding)
          orderBy = `CASE 
            WHEN p.project_type = 'fixed' AND p.budget IS NOT NULL THEN p.budget
            WHEN p.project_type = 'hourly' AND p.hourly_rate IS NOT NULL THEN p.hourly_rate
            WHEN p.project_type = 'bidding' AND p.budget_max IS NOT NULL THEN p.budget_max
            ELSE 0
          END DESC`;
          break;
        default:
          orderBy = 'p.created_at DESC';
      }
    }

    // Build final query with proper WHERE clause
    const query = `
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
      WHERE ${whereClause}
      ORDER BY ${orderBy}
    `;

    const { rows: projectRows } = await pool.query(query, params);

    // Fetch published tenders for the same category (or all if "all" selected)
    const tenderRows = await fetchPublishedTenders({
      categoryId: isAllCategory ? null : categoryId,
      search,
    });

    // Combine and sort
    const allRows = [...projectRows, ...tenderRows];
    if (sortBy) {
      allRows.sort((a, b) => {
        switch (sortBy.toLowerCase()) {
          case 'newest':
            return new Date(b.created_at) - new Date(a.created_at);
          case 'price_low_to_high':
            const aPrice = a.budget_min || a.budget || a.hourly_rate || 999999;
            const bPrice = b.budget_min || b.budget || b.hourly_rate || 999999;
            return aPrice - bPrice;
          case 'price_high_to_low':
            const aPriceHigh = a.budget_max || a.budget || a.hourly_rate || 0;
            const bPriceHigh = b.budget_max || b.budget || b.hourly_rate || 0;
            return bPriceHigh - aPriceHigh;
          default:
            return new Date(b.created_at) - new Date(a.created_at);
        }
      });
    } else {
      allRows.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    }

    // Log to confirm backend is returning data
    console.log(`✅ [getProjectsByCategoryId] Returned projects: ${allRows.length} (${projectRows.length} normal + ${tenderRows.length} tenders) for categoryId: ${categoryId}`);

    return res.json({ success: true, projects: allRows });
  } catch (error) {
    console.error("getProjectsByCategoryId error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

export const getProjectsBySubCategoryId = async (req, res) => {
  try {
    const { subCategoryId } = req.params;
    const { search, sortBy } = req.query;

    if (!subCategoryId || isNaN(subCategoryId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid subcategory ID" });
    }

    // Build WHERE conditions
    let whereConditions = `
      p.sub_category_id = $1 
      AND p.is_deleted = false
      AND p.status = 'bidding'
    `;
    const params = [subCategoryId];
    let paramIndex = 2;

    // Add search filter if provided
    if (search && search.trim()) {
      whereConditions += ` AND (p.title ILIKE $${paramIndex} OR p.description ILIKE $${paramIndex})`;
      params.push(`%${search.trim()}%`);
      paramIndex++;
    }

    // Build ORDER BY clause based on sortBy
    let orderBy = 'p.created_at DESC'; // Default: newest first
    if (sortBy) {
      switch (sortBy.toLowerCase()) {
        case 'newest':
          orderBy = 'p.created_at DESC';
          break;
        case 'price_low_to_high':
          orderBy = `CASE 
            WHEN p.project_type = 'fixed' AND p.budget IS NOT NULL THEN p.budget
            WHEN p.project_type = 'hourly' AND p.hourly_rate IS NOT NULL THEN p.hourly_rate
            WHEN p.project_type = 'bidding' AND p.budget_min IS NOT NULL THEN p.budget_min
            ELSE 999999
          END ASC`;
          break;
        case 'price_high_to_low':
          orderBy = `CASE 
            WHEN p.project_type = 'fixed' AND p.budget IS NOT NULL THEN p.budget
            WHEN p.project_type = 'hourly' AND p.hourly_rate IS NOT NULL THEN p.hourly_rate
            WHEN p.project_type = 'bidding' AND p.budget_max IS NOT NULL THEN p.budget_max
            ELSE 0
          END DESC`;
          break;
        default:
          orderBy = 'p.created_at DESC';
      }
    }

    const query = `
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
      WHERE ${whereConditions}
      ORDER BY ${orderBy}
    `;

    console.log('🔍 [getProjectsBySubCategoryId] Query params:', { subCategoryId, search, sortBy });

    const { rows: projectRows } = await pool.query(query, params);

    // Fetch published tenders for the same sub-category
    const tenderRows = await fetchPublishedTenders({
      subCategoryId,
      search,
    });

    // Combine and sort
    const allRows = [...projectRows, ...tenderRows];
    if (sortBy) {
      allRows.sort((a, b) => {
        switch (sortBy.toLowerCase()) {
          case 'newest':
            return new Date(b.created_at) - new Date(a.created_at);
          case 'price_low_to_high':
            const aPrice = a.budget_min || a.budget || a.hourly_rate || 999999;
            const bPrice = b.budget_min || b.budget || b.hourly_rate || 999999;
            return aPrice - bPrice;
          case 'price_high_to_low':
            const aPriceHigh = a.budget_max || a.budget || a.hourly_rate || 0;
            const bPriceHigh = b.budget_max || b.budget || b.hourly_rate || 0;
            return bPriceHigh - aPriceHigh;
          default:
            return new Date(b.created_at) - new Date(a.created_at);
        }
      });
    } else {
      allRows.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    }

    return res.json({ success: true, projects: allRows });
  } catch (error) {
    console.error("getProjectsBySubCategoryId error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

export const getProjectsBySubSubCategoryId = async (req, res) => {
  try {
    const { subSubCategoryId } = req.params;
    const { search, sortBy } = req.query;

    if (!subSubCategoryId || isNaN(subSubCategoryId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid sub-subcategory ID" });
    }

    // Build WHERE conditions
    let whereConditions = `
      p.sub_sub_category_id = $1 
      AND p.is_deleted = false
      AND p.status = 'bidding'
    `;
    const params = [subSubCategoryId];
    let paramIndex = 2;

    // Add search filter if provided
    if (search && search.trim()) {
      whereConditions += ` AND (p.title ILIKE $${paramIndex} OR p.description ILIKE $${paramIndex})`;
      params.push(`%${search.trim()}%`);
      paramIndex++;
    }

    // Build ORDER BY clause based on sortBy
    let orderBy = 'p.created_at DESC'; // Default: newest first
    if (sortBy) {
      switch (sortBy.toLowerCase()) {
        case 'newest':
          orderBy = 'p.created_at DESC';
          break;
        case 'price_low_to_high':
          orderBy = `CASE 
            WHEN p.project_type = 'fixed' AND p.budget IS NOT NULL THEN p.budget
            WHEN p.project_type = 'hourly' AND p.hourly_rate IS NOT NULL THEN p.hourly_rate
            WHEN p.project_type = 'bidding' AND p.budget_min IS NOT NULL THEN p.budget_min
            ELSE 999999
          END ASC`;
          break;
        case 'price_high_to_low':
          orderBy = `CASE 
            WHEN p.project_type = 'fixed' AND p.budget IS NOT NULL THEN p.budget
            WHEN p.project_type = 'hourly' AND p.hourly_rate IS NOT NULL THEN p.hourly_rate
            WHEN p.project_type = 'bidding' AND p.budget_max IS NOT NULL THEN p.budget_max
            ELSE 0
          END DESC`;
          break;
        default:
          orderBy = 'p.created_at DESC';
      }
    }

    // Query for normal projects
    const query = `
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
      WHERE ${whereConditions}
      ORDER BY ${orderBy}
    `;

    console.log('🔍 [getProjectsBySubSubCategoryId] Query params:', { subSubCategoryId, search, sortBy });

    const { rows: projectRows } = await pool.query(query, params);

    // Fetch published tenders for the same sub-sub-category
    const tenderRows = await fetchPublishedTenders({
      subSubCategoryId,
      search,
    });

    // Combine and sort
    const allRows = [...projectRows, ...tenderRows];
    
    // Manual sorting
    if (sortBy) {
      allRows.sort((a, b) => {
        switch (sortBy.toLowerCase()) {
          case 'newest':
            return new Date(b.created_at) - new Date(a.created_at);
          case 'price_low_to_high':
            const aPrice = a.budget_min || a.budget || a.hourly_rate || 999999;
            const bPrice = b.budget_min || b.budget || b.hourly_rate || 999999;
            return aPrice - bPrice;
          case 'price_high_to_low':
            const aPriceHigh = a.budget_max || a.budget || a.hourly_rate || 0;
            const bPriceHigh = b.budget_max || b.budget || b.hourly_rate || 0;
            return bPriceHigh - aPriceHigh;
          default:
            return new Date(b.created_at) - new Date(a.created_at);
        }
      });
    } else {
      allRows.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    }

    return res.json({ success: true, projects: allRows });
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

    // First, try to find in normal projects table
    const { rows: projectRows } = await pool.query(
      `SELECT 
         p.*,
         p.user_id AS client_id,
         c.name AS category_name,
         sc.name AS sub_category_name,
         ssc.name AS sub_sub_category_name,
         false AS is_tender_vault
       FROM projects p
       LEFT JOIN categories c ON p.category_id = c.id
       LEFT JOIN sub_categories sc ON p.sub_category_id = sc.id
       LEFT JOIN sub_sub_categories ssc ON p.sub_sub_category_id = ssc.id
       WHERE p.id = $1 
         AND p.is_deleted = false`,
      [projectId]
    );

    if (projectRows.length > 0) {
      const project = projectRows[0];
      // Debug: Log client_id to verify it's in response
      console.log("[getProjectById] Project client_id:", project.client_id, "user_id:", project.user_id);
      return res.status(200).json({ success: true, project });
    }

    // If not found, check tender_vault_projects (only if published)
    let tenderRows = [];
    try {
      const { rows } = await pool.query(
        `SELECT 
           tv.id,
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
           -- Map to project shape
           tv.created_by AS user_id,
           'bidding' AS project_type,
           'bidding' AS status,
           'not_started' AS completion_status,
           false AS is_deleted,
           NULL AS budget,
           NULL AS hourly_rate,
           NULL AS preferred_skills,
           NULL AS cover_pic,
           -- Map duration_value/unit to duration_days/hours for frontend compatibility
           CASE 
             WHEN tv.duration_unit = 'days' THEN tv.duration_value
             WHEN tv.duration_unit = 'hours' THEN NULL
             ELSE NULL
           END AS duration_days,
           CASE 
             WHEN tv.duration_unit = 'hours' THEN tv.duration_value
             WHEN tv.duration_unit = 'days' THEN NULL
             ELSE NULL
           END AS duration_hours,
           COALESCE(tv.duration_unit, 'days') AS duration_type,
           -- User info
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
           -- Category info (join using extracted IDs)
           c.name AS category_name,
           sc.name AS sub_category_name,
           ssc.name AS sub_sub_category_name,
           -- Internal flag
           true AS _is_tender_vault
         FROM tender_vault_projects tv
         LEFT JOIN users u ON tv.created_by = u.id
         LEFT JOIN categories c ON tv.category_id = c.id
         LEFT JOIN sub_categories sc ON sc.id = (tv.metadata->>'sub_category_id')::int
         LEFT JOIN sub_sub_categories ssc ON ssc.id = (tv.metadata->>'sub_sub_category_id')::int
        WHERE tv.id = $1 
          AND tv.status IN ('published', 'active')
          AND tv.is_deleted = false`,
        [projectId]
      );
      tenderRows = rows;
    } catch (err) {
      // If table doesn't exist (42P01) or column missing (42703), just return 404
      if (err.code === '42P01' || err.code === '42703') {
        return res
          .status(404)
          .json({ success: false, message: "Project not found" });
      }
      throw err;
    }

    if (tenderRows.length > 0) {
      return res.status(200).json({ success: true, project: tenderRows[0] });
    }

    return res
      .status(404)
      .json({ success: false, message: "Project not found" });
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
          pa.deadline,
          
(
  SELECT pcr.message
  FROM project_change_requests pcr
  WHERE pcr.project_id = p.id
    AND pcr.freelancer_id = pa.freelancer_id
    AND pcr.is_resolved = false
  ORDER BY pcr.created_at DESC
  LIMIT 1
) AS change_request_message
,
(
  SELECT pcr.created_at
  FROM project_change_requests pcr
  WHERE pcr.project_id = p.id
    AND pcr.freelancer_id = pa.freelancer_id
    AND pcr.is_resolved = false
  ORDER BY pcr.created_at DESC
  LIMIT 1
) AS change_request_at

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