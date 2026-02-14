import pool from "../models/db.js";

/**
 * Search for projects and categories
 * @route GET /search
 * @access Public (or Auth if needed)
 */
export const search = async (req, res) => {
  try {
    const { q } = req.query;

    if (!q || q.trim().length < 2) {
      return res.json({
        success: true,
        projects: [],
        categories: [],
      });
    }

    const searchTerm = `%${q.trim().toLowerCase()}%`;

    // Search projects by title or description
    const projectsQuery = `
      SELECT 
        id, user_id, title, description, cover_pic, project_type, 
        status, budget, budget_min, budget_max, hourly_rate,
        created_at, updated_at
      FROM projects
      WHERE 
        (LOWER(title) LIKE $1 OR LOWER(description) LIKE $1)
        AND status != 'deleted'
        AND is_deleted = false
      ORDER BY created_at DESC
      LIMIT 20
    `;

    // Search categories by name or related_words
    const categoriesQuery = `
      SELECT 
        id, name, description, icon, related_words, created_at
      FROM categories
      WHERE 
        LOWER(name) LIKE $1 
        OR (related_words IS NOT NULL AND LOWER(related_words) LIKE $1)
      ORDER BY name ASC
      LIMIT 10
    `;

    const [projectsResult, categoriesResult] = await Promise.all([
      pool.query(projectsQuery, [searchTerm]),
      pool.query(categoriesQuery, [searchTerm]),
    ]);

    return res.json({
      success: true,
      projects: projectsResult.rows || [],
      categories: categoriesResult.rows || [],
    });
  } catch (error) {
    console.error("Error searching:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to search",
      projects: [],
      categories: [],
    });
  }
};
