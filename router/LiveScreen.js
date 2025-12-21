import express from "express";
import pool from "../models/db.js";

const router = express.Router();

// GET: Dashboard statistics
router.get("/stats", async (req, res) => {
  try {
    const totalProjects = await pool.query(
      "SELECT COUNT(*) FROM projects"
    );

    const processing = await pool.query(
      "SELECT COUNT(*) FROM projects WHERE status = 'in_progress'"
    );

    const clients = await pool.query(
      "SELECT COUNT(*) FROM users WHERE role_id = 2"
    );

    const freelancers = await pool.query(
      "SELECT COUNT(*) FROM users WHERE role_id = 3"
    );

    res.json({
      totalProjects: Number(totalProjects.rows[0].count),
      processing: Number(processing.rows[0].count),
      clients: Number(clients.rows[0].count),
      freelancers: Number(freelancers.rows[0].count),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error retrieving stats" });
  }
});

export default router;
