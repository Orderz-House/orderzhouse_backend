import pool from "../models/db.js";

const authorization = (permission) => {
  return async (req, res, next) => {
    try {
      const role = req.token.role;
      const query = `
        SELECT 1
        FROM role_permission 
        INNER JOIN permissions 
          ON role_permission.permission_id = permissions.id
        WHERE role_permission.role_id = $1 
          AND permissions.permission = $2
        LIMIT 1
      `;
      // console.log("POOL IS:", pool);
      console.log("Decoded JWT:", req.token);
      console.log("Checking permission for role:", req.token.role);

      const result = await pool.query(query, [role, permission]);

      if (result.rows.length) {
        return next();
      }

      return res.status(403).json({ message: "unauthorized" });
    } catch (err) {
      console.error("Authorization error:", err);
      return res.status(500).json({ message: "server error" });
    }
  };
};

export default authorization;
