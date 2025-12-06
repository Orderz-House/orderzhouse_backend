import pool from "../models/db.js";

/* =====================================================
   CATEGORY CONTROLLERS (MAIN)
===================================================== */

// Get all main categories
export const getCategories = async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, description, image_url, related_words
       FROM categories
       WHERE is_deleted = false AND level = 0
       ORDER BY id ASC`
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error("getCategories error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// Get category by ID
export const getCategoryById = async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { rows } = await pool.query(
      `SELECT id, name, description, image_url, related_words
       FROM categories WHERE id = $1 AND is_deleted = false`,
      [id]
    );
    if (!rows.length)
      return res
        .status(404)
        .json({ success: false, message: "Not found" });
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error("getCategoryById error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// Create category
export const createCategory = async (req, res) => {
  try {
    const { name, description, image_url, related_words } = req.body;
    if (!name?.trim())
      return res
        .status(400)
        .json({ success: false, message: "Name required" });

    const { rows } = await pool.query(
      `INSERT INTO categories (name, description, image_url, related_words, level)
       VALUES ($1, $2, $3, $4, 0)
       RETURNING *`,
      [name.trim(), description || null, image_url || null, related_words || []]
    );
    res
      .status(201)
      .json({ success: true, message: "Category created", data: rows[0] });
  } catch (error) {
    console.error("createCategory error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// Update category
export const updateCategory = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, image_url } = req.body;

    const { rows } = await pool.query(
      `UPDATE categories
       SET name = COALESCE($1, name),
           description = COALESCE($2, description),
           image_url = COALESCE($3, image_url),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $4
       RETURNING *`,
      [name, description, image_url, id]
    );

    if (!rows.length)
      return res
        .status(404)
        .json({ success: false, message: "Category not found" });
    res.json({
      success: true,
      message: "Updated successfully",
      data: rows[0],
    });
  } catch (error) {
    console.error("updateCategory error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// Soft delete category
export const deleteCategory = async (req, res) => {
  try {
    const { id } = req.params;
    const { rows } = await pool.query(
      `UPDATE categories SET is_deleted = true, updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING *`,
      [id]
    );
    if (!rows.length)
      return res
        .status(404)
        .json({ success: false, message: "Not found" });
    res.json({ success: true, message: "Deleted", data: rows[0] });
  } catch (error) {
    console.error("deleteCategory error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/* =====================================================
   SUB-CATEGORIES
===================================================== */

export const getSubCategories = async (req, res) => {
  try {
    const { categoryId } = req.params;
    const { rows } = await pool.query(
      `SELECT 
         sc.id, 
         sc.name, 
         sc.description,
         sc.category_id,
         COALESCE(
           (SELECT COUNT(*)::int 
            FROM sub_sub_categories ssc 
            WHERE ssc.sub_category_id = sc.id), 0
         ) AS subsub_count
       FROM sub_categories sc
       WHERE sc.category_id = $1
       ORDER BY sc.id ASC`,
      [categoryId]
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};


export const createSubCategory = async (req, res) => {
  try {
    const { categoryId } = req.params;
    const { name, description } = req.body;
    if (!name?.trim())
      return res
        .status(400)
        .json({ success: false, message: "Name required" });

    const { rows } = await pool.query(
      `INSERT INTO sub_categories (category_id, name, description)
       VALUES ($1, $2, $3) RETURNING *`,
      [categoryId, name.trim(), description || null]
    );
    res
      .status(201)
      .json({ success: true, message: "Created", data: rows[0] });
  } catch (error) {
    console.error("createSubCategory error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

export const updateSubCategory = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description } = req.body;

    const { rows } = await pool.query(
      `UPDATE sub_categories
       SET name = COALESCE($1, name),
           description = COALESCE($2, description),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $3 RETURNING *`,
      [name, description, id]
    );

    if (!rows.length)
      return res.status(404).json({ success: false, message: "Not found" });
    res.json({ success: true, message: "Updated", data: rows[0] });
  } catch (error) {
    console.error("updateSubCategory error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

export const deleteSubCategory = async (req, res) => {
  try {
    const { id } = req.params;
    const { rows } = await pool.query(
      `DELETE FROM sub_categories WHERE id = $1 RETURNING *`,
      [id]
    );
    if (!rows.length)
      return res.status(404).json({ success: false, message: "Not found" });
    res.json({ success: true, message: "Deleted", data: rows[0] });
  } catch (error) {
    console.error("deleteSubCategory error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/* =====================================================
   SUB-SUB-CATEGORIES
===================================================== */

export const getSubSubCategoriesBySubId = async (req, res) => {
  try {
    const { subCategoryId } = req.params;
    const { rows } = await pool.query(
      `SELECT ssc.*,
              (SELECT COUNT(*) 
               FROM projects p 
               WHERE p.sub_sub_category_id = ssc.id) AS projects_count
       FROM sub_sub_categories ssc
       WHERE ssc.sub_category_id = $1
       ORDER BY ssc.id ASC`,
      [subCategoryId]
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error("getSubSubCategoriesBySubId error:", error);
    res
      .status(500)
      .json({ success: false, message: "Server error" });
  }
};

export const createSubSubCategory = async (req, res) => {
  try {
    const { subCategoryId } = req.params;
    const { name, description } = req.body;
    if (!name?.trim())
      return res
        .status(400)
        .json({ success: false, message: "Name required" });

    const { rows } = await pool.query(
      `INSERT INTO sub_sub_categories (sub_category_id, name, description)
       VALUES ($1, $2, $3) RETURNING *`,
      [subCategoryId, name.trim(), description || null]
    );
    res
      .status(201)
      .json({ success: true, message: "Created", data: rows[0] });
  } catch (error) {
    console.error("createSubSubCategory error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

export const updateSubSubCategory = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description } = req.body;

    const { rows } = await pool.query(
      `UPDATE sub_sub_categories
       SET name = COALESCE($1, name),
           description = COALESCE($2, description),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $3 RETURNING *`,
      [name, description, id]
    );

    if (!rows.length)
      return res.status(404).json({ success: false, message: "Not found" });
    res.json({ success: true, message: "Updated", data: rows[0] });
  } catch (error) {
    console.error("updateSubSubCategory error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

export const deleteSubSubCategory = async (req, res) => {
  try {
    const { id } = req.params;
    const { rows } = await pool.query(
      `DELETE FROM sub_sub_categories WHERE id = $1 RETURNING *`,
      [id]
    );
    if (!rows.length)
      return res.status(404).json({ success: false, message: "Not found" });
    res.json({ success: true, message: "Deleted", data: rows[0] });
  } catch (error) {
    console.error("deleteSubSubCategory error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

export const getSubSubCategoriesByCategoryId = async (req, res) => {
  try {
    const { categoryId } = req.params;
    const { rows } = await pool.query(
      `SELECT ssc.*,
              sc.id AS sub_category_id,
              sc.name AS sub_category_name,
              c.id AS category_id,
              c.name AS category_name
       FROM sub_sub_categories ssc
       JOIN sub_categories sc ON ssc.sub_category_id = sc.id
       JOIN categories c ON sc.category_id = c.id
       WHERE c.id = $1
       ORDER BY ssc.id ASC`,
      [categoryId]
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error("getSubSubCategoriesByCategoryId error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};
