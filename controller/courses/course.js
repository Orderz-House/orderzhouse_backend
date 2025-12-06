import pool from "../../models/db.js";

export const giveCourseCoupon = async (req, res) => {
  try {
    const roleId = req.token?.role; 

    if (roleId !== 1) {
      return res.status(403).json({
        success: false,
        message: "Unauthorized: Admin access only"
      });
    }

    const { freelancerId, couponCode } = req.body;

    if (!freelancerId || !couponCode) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields: freelancerId, couponCode"
      });
    }

    const freelancer = await pool.query(
      `SELECT id FROM users WHERE id = $1 AND is_deleted = FALSE`,
      [freelancerId]
    );

    if (freelancer.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Freelancer not found"
      });
    }

    const inserted = await pool.query(
      `INSERT INTO courses (freelancer_id, coupon_code)
       VALUES ($1, $2)
       RETURNING id, freelancer_id, coupon_code, created_at`,
      [freelancerId, couponCode]
    );

    return res.json({
      success: true,
      message: "Course coupon granted successfully",
      data: inserted.rows[0]
    });

  } catch (err) {
    console.error("giveCourseCoupon error:", err);
    return res.status(500).json({
      success: false,
      message: "Server error while granting course coupon"
    });
  }
};

export const getMyCourseCoupons = async (req, res) => {
  try {
    const userId = req.token?.userId;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized: No user ID found"
      });
    }

    const result = await pool.query(
  `SELECT id, freelancer_id, coupon_code, created_at
   FROM courses
   WHERE freelancer_id = $1
   ORDER BY created_at DESC`,
  [userId]
);


    return res.json({
      success: true,
      message: "Coupons retrieved successfully",
      coupons: result.rows
    });

  } catch (error) {
    console.error("getMyCourseCoupons error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error while retrieving coupons"
    });
  }
};
