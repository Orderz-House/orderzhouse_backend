import jwt from "jsonwebtoken";
import pool from "../models/db.js";

const authentication = (req, res, next) => {
  try {
    if (!req.headers.authorization) {
      return res.status(403).json({ message: "forbidden" });
    }

    const token = req.headers.authorization.split(" ").pop();

    jwt.verify(token, process.env.JWT_SECRET, async (err, result) => {
      if (err) {
        return res.status(403).json({
          success: false,
          message: "The token is invalid or expired",
        });
      }

      // Check if user is deleted (from token or DB)
      if (result.is_deleted === true) {
        return res.status(401).json({
          success: false,
          message: "Account has been deleted",
        });
      }

      // Double-check in DB to ensure user still exists and is not deleted
      try {
        const userCheck = await pool.query(
          "SELECT id, terms_accepted_at, terms_version FROM users WHERE id = $1 AND is_deleted = FALSE",
          [result.userId]
        );
        if (userCheck.rows.length === 0) {
          return res.status(401).json({
            success: false,
            message: "Account has been deleted",
          });
        }

        // Check terms acceptance (exclude accept-terms and profile-completion flows)
        const path = req.originalUrl || req.url || "";
        const skipTermsCheck = path.includes("/auth/accept-terms") ||
          path.includes("/users/complete-profile") ||
          path.includes("/users/getUserdata");
        if (!skipTermsCheck) {
          const { CURRENT_TERMS_VERSION } = await import("../config/terms.js");
          const user = userCheck.rows[0];
          const mustAcceptTerms = !user.terms_accepted_at || user.terms_version !== CURRENT_TERMS_VERSION;
          
          if (mustAcceptTerms) {
            return res.status(403).json({
              success: false,
              code: "TERMS_NOT_ACCEPTED",
              message: "Terms & Conditions must be accepted before accessing this resource",
            });
          }
        }
      } catch (dbErr) {
        console.error("Auth middleware DB check error:", dbErr);
        // Continue if DB check fails (don't block request, but log error)
      }

      req.token = result;
      next();
    });
  } catch (error) {
    return res.status(403).json({ message: "forbidden" });
  }
};

const authSocket = async (socket, next) => {
  try {
    const token = socket.handshake.auth.token;

    if (!token) {
      return next(new Error("Authentication error: Token required"));
    }

    jwt.verify(token, process.env.JWT_SECRET, async (err, decoded) => {
      if (err) {
        return next(new Error("Authentication error: Invalid token"));
      }

      // attach user to socket
      socket.user = decoded;
      console.log("🔐 Socket authenticated:", decoded);
      next();
    });
  } catch (err) {
    console.error("authSocket error:", err);
    next(new Error("Authentication error"));
  }
};

export { authentication, authSocket };
export default authentication;
