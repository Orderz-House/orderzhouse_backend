import pool from "../models/db.js";
import { NotificationCreators } from "../services/notificationService.js";

export const submitRating = async (req, res) => {
  
  const client_id = req.token?.userId;
  const project_id = req.body.project_id 
  const freelancer_id = req.body.freelancer_id 
  const { rating, comment } = req.body;

  if (!project_id || !freelancer_id || !rating) {
    return res.status(400).json({
      success: false,
      message: "Project ID, Freelancer ID, and Rating are required.",
    });
  }

  if (rating < 1 || rating > 5) {
    return res.status(400).json({
      success: false,
      message: "Rating must be between 1 and 5.",
    });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const projectCheck = await client.query(
      `
      SELECT p.id 
      FROM projects p
      INNER JOIN project_assignments pa 
        ON pa.project_id = p.id
      WHERE p.id = $1 
        AND p.user_id = $2 
        AND pa.freelancer_id = $3
        AND p.completion_status = 'completed'
      `,
      [project_id, client_id, freelancer_id]
    );

    if (projectCheck.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(403).json({
        success: false,
        message: "You can only rate completed projects you were a part of.",
      });
    }

    const ratingResult = await client.query(
      `
      INSERT INTO ratings (project_id, client_id, freelancer_id, rating, comment)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (project_id, client_id, freelancer_id) DO NOTHING
      RETURNING *
      `,
      [project_id, client_id, freelancer_id, rating, comment]
    );

    if (ratingResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        success: false,
        message: "You have already submitted a review for this project.",
      });
    }

    const newRating = ratingResult.rows[0];

    const updateUserRating = await client.query(
      `
      UPDATE users
      SET 
        rating_sum = COALESCE(rating_sum, 0) + $1,
        rating_count = COALESCE(rating_count, 0) + 1,
        rating = (COALESCE(rating_sum, 0) + $1) / (COALESCE(rating_count, 0) + 1)
      WHERE id = $2
      RETURNING rating
      `,
      [rating, freelancer_id]
    );

    try {
      const clientInfo = await client.query(
        "SELECT username FROM users WHERE id = $1",
        [client_id]
      );

      const clientName = clientInfo.rows.length
        ? clientInfo.rows[0].username
        : "A client";

      await NotificationCreators.reviewSubmitted(
        newRating.id,
        freelancer_id,
        clientName
      );
    } catch (e) {
      console.error("Failed to send review notification:", e);
    }

    await client.query("COMMIT");

    res.status(201).json({
      success: true,
      message: "Thank you for your feedback!",
      rating: newRating,
      newAverageRating: updateUserRating.rows[0].rating,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Error submitting rating:", err);
    if (err.code === "23505") {
      return res.status(409).json({
        success: false,
        message: "You have already submitted a review for this project.",
      });
    }
    res.status(500).json({ success: false, message: "Server error." });
  } finally {
    client.release();
  }
};

export const getRatingsForFreelancer = async (req, res) => {
  const { freelancerId } = req.params;

  try {
    const query = `
      SELECT 
        r.id,
        r.rating,
        r.comment,
        r.created_at,
        p.title AS project_title,
        json_build_object(
          'id', c.id,
          'username', c.username,
          'profile_pic_url', c.profile_pic_url
        ) AS client
      FROM ratings r
      JOIN users c ON r.client_id = c.id
      JOIN projects p ON r.project_id = p.id
      WHERE r.freelancer_id = $1
      ORDER BY r.created_at DESC;
    `;

    const { rows } = await pool.query(query, [freelancerId]);

    res.status(200).json({ success: true, reviews: rows });
  } catch (err) {
    console.error("Error fetching ratings:", err);
    res.status(500).json({ success: false, message: "Server error." });
  }
};
