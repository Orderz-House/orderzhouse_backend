import pool from "../models/db.js";

/**
 * Update categories for a freelancer
 * - Admin can update any freelancer's categories
 * - Freelancer can update only their own categories
 */
export const updateFreelancerCategories = async (req, res) => {
  const requesterId = req.token.userId;
  const requesterRole = req.token.role; 
  const { freelancerId, categories } = req.body;

  const targetFreelancerId = requesterRole === 1 ? freelancerId : requesterId;

  if (!targetFreelancerId) {
    return res.status(400).json({
      success: false,
      message: "freelancerId is required for admin"
    });
  }

  if (!Array.isArray(categories) || categories.length === 0) {
    return res.status(400).json({
      success: false,
      message: "categories must be a non-empty array of IDs"
    });
  }

  try {
    const { rows: validCategories } = await pool.query(
      `SELECT id FROM categories WHERE id = ANY($1) AND is_deleted = false`,
      [categories]
    );

    const validCategoryIds = validCategories.map(c => c.id);

    if (validCategoryIds.length !== categories.length) {
      return res.status(400).json({
        success: false,
        message: "One or more category IDs are invalid"
      });
    }

    // Delete existing categories for this freelancer
    await pool.query(
      `DELETE FROM freelancer_categories WHERE freelancer_id = $1`,
      [targetFreelancerId]
    );

    const insertPromises = validCategoryIds.map(catId =>
      pool.query(
        `INSERT INTO freelancer_categories (freelancer_id, category_id) VALUES ($1, $2)`,
        [targetFreelancerId, catId]
      )
    );

    await Promise.all(insertPromises);

    res.status(200).json({
      success: true,
      message: "Categories updated successfully",
      categories: validCategoryIds
    });
  } catch (err) {
    console.error("updateFreelancerCategories error:", err);
    res.status(500).json({ success: false, message: "Server error", error: err.message });
  }
};

/**
 * Get freelancer categories
 */
export const getFreelancerCategories = async (req, res) => {
  const requesterId = req.token.userId;
  const requesterRole = req.token.role;
  const { freelancerId } = req.query;

  const targetFreelancerId = requesterRole === 1 ? freelancerId || requesterId : requesterId;

  try {
    const { rows } = await pool.query(
      `SELECT c.id, c.name
       FROM freelancer_categories fc
       JOIN categories c ON c.id = fc.category_id
       WHERE fc.freelancer_id = $1 AND c.is_deleted = false`,
      [targetFreelancerId]
    );

    res.status(200).json({
      success: true,
      categories: rows
    });
  } catch (err) {
    console.error("getFreelancerCategories error:", err);
    res.status(500).json({ success: false, message: "Server error", error: err.message });
  }
};
