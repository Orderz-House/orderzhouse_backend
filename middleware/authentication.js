import jwt from "jsonwebtoken";
import pool from "../models/db.js";

const authentication = (req, res, next) => {
  try {
    if (!req.headers.authorization) {
      return res.status(403).json({ message: "forbidden" });
    }

    const token = req.headers.authorization.split(" ").pop();

    jwt.verify(token, process.env.JWT_SECRET, (err, result) => {
      if (err) {
        return res.status(403).json({
          success: false,
          message: "The token is invalid or expired",
        });
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
