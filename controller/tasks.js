// controller/tasks.js
import pool from "../models/db.js";
import { NotificationCreators } from "../services/notificationService.js";
import cloudinary from "../cloudinary/setupfile.js";
import { Readable } from "stream";

/* ===============================================================
   Utility Functions
================================================================= */

const uploadFilesToCloudinary = async (files, folder) => {
  const uploadedFiles = [];
  for (const file of files) {
    const result = await new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        { resource_type: "auto", folder },
        (error, result) => (error ? reject(error) : resolve(result))
      );
      Readable.from(file.buffer).pipe(uploadStream);
    });

    uploadedFiles.push({
      url: result.secure_url,
      public_id: result.public_id,
      name: file.originalname,
      size: file.size,
    });
  }
  return uploadedFiles;
};

const insertFileRecords = async (files, taskIdOrReqId, senderId) => {
  for (const fileData of files) {
    await pool.query(
      `INSERT INTO task_files (task_id, sender_id, file_name, file_url, file_size, public_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [taskIdOrReqId, senderId, fileData.name, fileData.url, fileData.size, fileData.public_id]
    );
  }
};

/* ===============================================================
   ADMIN CONTROLLERS
================================================================= */

export const getAllTasksForAdmin = async (req, res) => {
  try {
    if (req.token?.role !== 1)
      return res.status(403).json({ success: false, message: "Access denied. Admins only." });

    const result = await pool.query(
      `SELECT t.*,
              u1.first_name || ' ' || u1.last_name AS freelancer_name,
              u2.first_name || ' ' || u2.last_name AS client_name,
              c.name AS category_name
         FROM tasks t
    LEFT JOIN users u1 ON t.freelancer_id = u1.id
    LEFT JOIN users u2 ON t.assigned_client_id = u2.id
    LEFT JOIN categories c ON t.category_id = c.id
        WHERE t.is_deleted = FALSE
     ORDER BY t.id DESC`
    );

    res.json({ success: true, tasks: result.rows });
  } catch (err) {
    console.error("getAllTasksForAdmin error:", err);
    res.status(500).json({ success: false, message: "Server error." });
  }
};

// Admin: approve or reject freelancer task
export const approveTaskByAdmin = async (req, res) => {
  try {
    if (req.token?.role !== 1)
      return res.status(403).json({ success: false, message: "Access denied. Admins only." });

    const { id } = req.params;
    const { status } = req.body;

    if (!["active", "rejected"].includes(status)) {
      return res.status(400).json({ success: false, message: "Invalid status. Use 'active' or 'rejected'." });
    }

    const result = await pool.query(
      `UPDATE tasks
          SET status = $1
        WHERE id = $2 AND status = 'pending_approval'
     RETURNING *`,
      [status, id]
    );

    if (!result.rows.length)
      return res.status(404).json({ success: false, message: "Task not found or not pending approval." });

    // 🔔 Notify freelancer
    const freelancerId = result.rows[0].freelancer_id;
    const message =
      status === "active"
        ? "✅ Your task has been approved and is now live!"
        : "❌ Your task has been rejected by admin.";
    await NotificationCreators.taskStatusChange(freelancerId, id, message);

    res.json({ success: true, message: `Task has been ${status}.`, task: result.rows[0] });
  } catch (err) {
    console.error("approveTaskByAdmin error:", err);
    res.status(500).json({ success: false, message: "Server error." });
  }
};

export const confirmPaymentByAdmin = async (req, res) => {
  try {
    if (req.token?.role !== 1)
      return res.status(403).json({ success: false, message: "Access denied. Admins only." });

    const { id } = req.params;

    const result = await pool.query(
      `UPDATE task_req
          SET status = 'in_progress',
              updated_at = NOW()
        WHERE id = $1
          AND status = 'pending_payment'
          AND payment_proof_url IS NOT NULL
     RETURNING *`,
      [id]
    );

    if (!result.rows.length)
      return res.status(404).json({
        success: false,
        message: "Request not found, not pending payment, or missing payment proof.",
      });

    // 🔔 Notify both client and freelancer
    const reqData = result.rows[0];
    await NotificationCreators.paymentConfirmed(reqData.client_id, id);
    await NotificationCreators.paymentConfirmed(reqData.freelancer_id, id);

    res.json({ success: true, message: "Payment confirmed. Work is now in progress.", request: result.rows[0] });
  } catch (err) {
    console.error("confirmPaymentByAdmin error:", err);
    res.status(500).json({ success: false, message: "Server error." });
  }
};

/* ===============================================================
   FREELANCER CONTROLLERS
================================================================= */
function generateSpecialId() {
  const numbers = "0123456789";
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

  const r = (chars, len) =>
    Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join("");

  return (
    r(numbers, 4) +
    r(letters, 2) +
    r(numbers, 2) +
    r(letters, 1) +
    r(numbers, 2) +
    r(letters, 2) +
    r(numbers, 4) +
    r(letters, 1) +
    r(numbers, 2)
  );
}

export const createTask = async (req, res) => {
  try {
    if (req.token?.role !== 3)
      return res.status(403).json({ success: false, message: "Access denied. Freelancers only." });

    const { title, description, price, category_id, duration_days = 0, duration_hours = 0 } = req.body;
    const freelancerId = req.token.userId;
    const files = req.files || [];
    let attachmentUrls = [];

    if (files.length > 0) {
      const uploadedFiles = await uploadFilesToCloudinary(files, `tasks/initial/${freelancerId}`);
      attachmentUrls = uploadedFiles.map((f) => f.url);
    }

    const result = await pool.query(
      `INSERT INTO tasks (title, description, price, freelancer_id, category_id, duration_days, duration_hours, attachments, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending_approval')
       RETURNING *`,
      [title, description, price, freelancerId, category_id, duration_days, duration_hours, attachmentUrls]
    );

    res.status(201).json({ success: true, task: result.rows[0] });
  } catch (err) {
    console.error("createTask error:", err);
    res.status(500).json({ success: false, message: "Server error creating task." });
  }
};

export const updateTask = async (req, res) => {
  try {
    const freelancerId = req.token?.userId;
    const { id } = req.params;
    const { title, description, price, category_id, duration_days, duration_hours } = req.body;

    const check = await pool.query(
      `SELECT * FROM tasks WHERE id = $1 AND freelancer_id = $2 AND is_deleted = FALSE`,
      [id, freelancerId]
    );
    if (!check.rows.length)
      return res.status(404).json({ success: false, message: "Task not found or not yours." });

    const result = await pool.query(
      `UPDATE tasks 
          SET title = $1, description = $2, price = $3, category_id = $4,
              duration_days = $5, duration_hours = $6, updated_at = NOW()
        WHERE id = $7
      RETURNING *`,
      [title, description, price, category_id, duration_days, duration_hours, id]
    );

    res.json({ success: true, message: "Task updated successfully.", task: result.rows[0] });
  } catch (err) {
    console.error("updateTask error:", err);
    res.status(500).json({ success: false, message: "Server error updating task." });
  }
};

// FREELANCER: Soft delete task
export const deleteTask = async (req, res) => {
  try {
    const freelancerId = req.token?.userId;
    const { id } = req.params;

    const result = await pool.query(
      `UPDATE tasks SET is_deleted = TRUE WHERE id = $1 AND freelancer_id = $2 RETURNING *`,
      [id, freelancerId]
    );

    if (!result.rows.length)
      return res.status(404).json({ success: false, message: "Task not found or not yours." });

    res.json({ success: true, message: "Task deleted successfully." });
  } catch (err) {
    console.error("deleteTask error:", err);
    res.status(500).json({ success: false, message: "Server error deleting task." });
  }
};

// FREELANCER: Approve or reject client request
export const updateTaskRequestStatus = async (req, res) => {
  try {
    const freelancerId = req.token?.userId;
    const { id } = req.params; // request ID
    const { status } = req.body;

    if (!["pending_payment", "rejected"].includes(status)) {
      return res.status(400).json({ success: false, message: "Invalid status change." });
    }

    const result = await pool.query(
      `UPDATE task_req
          SET status = $1, updated_at = NOW()
        WHERE id = $2 
          AND status = 'pending_approval'
          AND freelancer_id = $3
      RETURNING *`,
      [status, id, freelancerId]
    );

    if (!result.rows.length)
      return res.status(404).json({ success: false, message: "Request not found or invalid state." });

    // 🔔 Notify client
    const reqData = result.rows[0];
    const msg =
      status === "pending_payment"
        ? "✅ Your task request was approved. Please proceed with payment."
        : "❌ Your task request was rejected.";
    await NotificationCreators.taskStatusChange(reqData.client_id, id, msg);

    res.json({ success: true, message: `Request ${status}.`, request: result.rows[0] });
  } catch (err) {
    console.error("updateTaskRequestStatus error:", err);
    res.status(500).json({ success: false, message: "Server error updating request status." });
  }
};

// FREELANCER: Submit work for review
export const submitWorkCompletion = async (req, res) => {
  try {
    const freelancerId = req.token?.userId;
    const { id } = req.params; // task_req id
    const files = req.files || [];

    const reqCheck = await pool.query(
      `SELECT * FROM task_req WHERE id = $1 AND status = 'in_progress' AND freelancer_id = $2`,
      [id, freelancerId]
    );
    if (!reqCheck.rows.length)
      return res.status(404).json({ success: false, message: "Request not found or invalid state." });

    const uploadedFiles = await uploadFilesToCloudinary(files, `tasks/${id}/completed`);
    await insertFileRecords(uploadedFiles, id, freelancerId);

    const result = await pool.query(
      `UPDATE task_req SET status = 'pending_review', updated_at = NOW() WHERE id = $1 RETURNING *`,
      [id]
    );

    // 🔔 Notify client
    await NotificationCreators.taskStatusChange(
      result.rows[0].client_id,
      id,
      "📦 Work has been submitted for review."
    );

    res.json({ success: true, message: "Work submitted for review.", request: result.rows[0] });
  } catch (err) {
    console.error("submitWorkCompletion error:", err);
    res.status(500).json({ success: false, message: "Error submitting work." });
  }
};

// FREELANCER: Resubmit after rejection
export const resubmitWorkCompletion = async (req, res) => {
  try {
    const freelancerId = req.token?.userId;
    const { id } = req.params; // task_req id
    const files = req.files || [];

    const reqCheck = await pool.query(
      `SELECT * FROM task_req WHERE id = $1 AND status = 'reviewing' AND freelancer_id = $2`,
      [id, freelancerId]
    );
    if (!reqCheck.rows.length)
      return res.status(404).json({ success: false, message: "Request not found or not in reviewing state." });

    const uploadedFiles = await uploadFilesToCloudinary(files, `tasks/${id}/resubmitted`);
    await insertFileRecords(uploadedFiles, id, freelancerId);

    const result = await pool.query(
      `UPDATE task_req SET status = 'pending_review', updated_at = NOW() WHERE id = $1 RETURNING *`,
      [id]
    );

    await NotificationCreators.taskStatusChange(
      result.rows[0].client_id,
      id,
      "🔁 Freelancer resubmitted the work for your review."
    );

    res.json({ success: true, message: "Work resubmitted.", request: result.rows[0] });
  } catch (err) {
    console.error("resubmitWorkCompletion error:", err);
    res.status(500).json({ success: false, message: "Error resubmitting work." });
  }
};

// FREELANCER: Update Kanban status
export const updateTaskKanbanStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { new_status } = req.body;
    const freelancerId = req.token?.userId;

    const valid = [
      "in_progress",
      "pending_review",
      "reviewing",
      "completed",
      "terminated",
    ];
    if (!valid.includes(new_status))
      return res.status(400).json({ success: false, message: "Invalid status." });

    const result = await pool.query(
      `UPDATE task_req 
          SET status = $1, updated_at = NOW()
        WHERE id = $2 
          AND (SELECT freelancer_id FROM tasks WHERE tasks.id = task_req.task_id) = $3
      RETURNING *`,
      [new_status, id, freelancerId]
    );

    if (!result.rows.length)
      return res.status(404).json({ success: false, message: "Task request not found." });

    res.json({ success: true, message: "Status updated successfully.", request: result.rows[0] });
  } catch (err) {
    console.error("updateTaskKanbanStatus error:", err);
    res.status(500).json({ success: false, message: "Error updating Kanban status." });
  }
};

// FREELANCER: Get requests for a specific task
export const getTaskRequests = async (req, res) => {
  try {
    const { taskId } = req.params;

    const result = await pool.query(
      `SELECT tr.*, 
              u.first_name || ' ' || u.last_name AS client_name,
              u.profile_pic_url AS client_avatar
         FROM task_req tr
         JOIN users u ON tr.client_id = u.id
        WHERE tr.task_id = $1
     ORDER BY tr.id DESC`,
      [taskId]
    );

    if (!result.rows.length)
      return res
        .status(404)
        .json({ success: false, message: "No requests found for this task." });

    res.json({ success: true, requests: result.rows });
  } catch (err) {
    console.error("getTaskRequests error:", err);
    res
      .status(500)
      .json({ success: false, message: "Server error fetching task requests." });
  }
};

/* ===============================================================
   CLIENT CONTROLLERS
================================================================= */

export const requestTask = async (req, res) => {
  try {
    if (req.token?.role !== 2)
      return res.status(403).json({ success: false, message: "Access denied. Clients only." });

    const { id: taskId } = req.params; 
    const clientId = req.token.userId;
    const { message } = req.body;
    const files = req.files || [];

    const taskRes = await pool.query(
      `SELECT id, freelancer_id, title
         FROM tasks 
        WHERE id = $1 AND is_deleted = FALSE AND status = 'active'`,
      [taskId]
    );
    if (!taskRes.rows.length)
      return res.status(400).json({ success: false, message: "This task is not available for request." });

    const taskData = taskRes.rows[0];

    const existing = await pool.query(
      `SELECT id FROM task_req 
        WHERE task_id = $1 AND client_id = $2 
          AND status IN ('pending_approval','pending_payment','in_progress','pending_review','reviewing')`,
      [taskId, clientId]
    );
    if (existing.rows.length)
      return res.status(409).json({ success: false, message: "You already have an active request for this task." });

    let attachmentUrls = [];
    if (files.length > 0) {
      const uploadedFiles = await uploadFilesToCloudinary(files, `tasks/${taskId}/request`);
      attachmentUrls = uploadedFiles.map((f) => f.url);
    }

    const specialOrderId = generateSpecialId();

    const reqResult = await pool.query(
      `INSERT INTO task_req 
         (task_id, client_id, freelancer_id, message, attachments, status, special_order_id)
       VALUES ($1, $2, $3, $4, $5, 'pending_approval', $6)
       RETURNING id, special_order_id`,
      [taskId, clientId, taskData.freelancer_id, message, attachmentUrls, specialOrderId]
    );

    // Notify freelancer
    const { rows: clientRows } = await pool.query(
      `SELECT first_name || ' ' || last_name AS full_name FROM users WHERE id = $1`,
      [clientId]
    );
    const clientName = clientRows[0]?.full_name || "A client";
    const notifMessage = `📝 ${clientName} has requested your task "${taskData.title}"`;

    await NotificationCreators.taskRequested(taskData.freelancer_id, taskId, notifMessage);

    res.status(201).json({
      success: true,
      special_order_id: reqResult.rows[0].special_order_id,
      requestId: reqResult.rows[0].id,
      message: "Task requested successfully."
    });

  } catch (err) {
    console.error("requestTask error:", err);
    res.status(500).json({ success: false, message: "Server error requesting task." });
  }
};

export const submitPaymentProof = async (req, res) => {
  try {
    const clientId = req.token?.userId;
    const { id } = req.params;
    const files = req.file ? [req.file] : [];

    const reqCheck = await pool.query(
      `SELECT * FROM task_req WHERE id = $1 AND client_id = $2 AND status = 'pending_payment'`,
      [id, clientId]
    );
    if (!reqCheck.rows.length)
      return res.status(404).json({ success: false, message: "Request not found or not awaiting payment." });

    if (!files.length)
      return res.status(400).json({ success: false, message: "Upload a payment proof file." });

    const uploadedFiles = await uploadFilesToCloudinary(files, `tasks/${id}/payment`);
    const paymentProof = uploadedFiles[0].url;

    const result = await pool.query(
      `UPDATE task_req
          SET payment_proof_url = $1, updated_at = NOW()
        WHERE id = $2
      RETURNING *`,
      [paymentProof, id]
    );

    await NotificationCreators.paymentSubmitted(result.rows[0].freelancer_id, id);

    res.json({ success: true, message: "Payment proof submitted successfully.", request: result.rows[0] });
  } catch (err) {
    console.error("submitPaymentProof error:", err);
    res.status(500).json({ success: false, message: "Error submitting payment proof." });
  }
};

// CLIENT: Approve work completion
export const approveWorkCompletion = async (req, res) => {
  try {
    const clientId = req.token?.userId;
    const { id } = req.params;

    const result = await pool.query(
      `UPDATE task_req 
          SET status = 'completed', updated_at = NOW()
        WHERE id = $1 AND client_id = $2 AND status = 'pending_review'
      RETURNING *`,
      [id, clientId]
    );

    if (!result.rows.length)
      return res.status(404).json({ success: false, message: "Request not found or invalid state." });

    await NotificationCreators.taskStatusChange(
      result.rows[0].freelancer_id,
      id,
      "🎉 Your work has been approved! Task completed."
    );

    res.json({ success: true, message: "Work approved successfully.", request: result.rows[0] });
  } catch (err) {
    console.error("approveWorkCompletion error:", err);
    res.status(500).json({ success: false, message: "Error approving work." });
  }
};

// CLIENT: Create review after completion
export const createReview = async (req, res) => {
  try {
    const clientId = req.token?.userId;
    const { id } = req.params; // task_req id
    const { rating, comment } = req.body;

    const reqCheck = await pool.query(
      `SELECT * FROM task_req WHERE id = $1 AND client_id = $2 AND status = 'completed'`,
      [id, clientId]
    );
    if (!reqCheck.rows.length)
      return res.status(404).json({ success: false, message: "Request not found or not completed." });

    const result = await pool.query(
      `INSERT INTO task_reviews (task_req_id, client_id, freelancer_id, rating, comment)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [id, clientId, reqCheck.rows[0].freelancer_id, rating, comment]
    );

    res.status(201).json({ success: true, message: "Review added successfully.", review: result.rows[0] });
  } catch (err) {
    console.error("createReview error:", err);
    res.status(500).json({ success: false, message: "Error creating review." });
  }
};

/* ===============================================================
   PUBLIC & SHARED CONTROLLERS
================================================================= */

export const getTaskPool = async (req, res) => {
  try {
    const { category } = req.query;
    let query = `
      SELECT t.id, t.title, t.description, t.price, t.duration_days, t.duration_hours,
             u.first_name || ' ' || u.last_name AS freelancer_name,
             u.profile_pic_url AS freelancer_avatar,
             c.name AS category_name
        FROM tasks t
        JOIN users u ON t.freelancer_id = u.id
   LEFT JOIN categories c ON t.category_id = c.id
       WHERE t.is_deleted = FALSE
         AND t.status = 'active'
         AND t.assigned_client_id IS NULL
    `;
    const params = [];
    if (category) {
      query += ` AND t.category_id = $${params.length + 1}`;
      params.push(parseInt(category));
    }
    query += ` ORDER BY t.id DESC`;

    const result = await pool.query(query, params);
    res.json({ success: true, tasks: result.rows });
  } catch (err) {
    console.error("getTaskPool error:", err);
    res.status(500).json({ success: false, message: "Server error fetching task pool." });
  }
};

export const getTaskById = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `SELECT t.*, u.first_name || ' ' || u.last_name AS freelancer_name, 
              c.name AS category_name
         FROM tasks t
         JOIN users u ON t.freelancer_id = u.id
    LEFT JOIN categories c ON t.category_id = c.id
        WHERE t.id = $1 AND t.is_deleted = FALSE`,
      [id]
    );
    if (!result.rows.length)
      return res.status(404).json({ success: false, message: "Task not found." });
    res.json({ success: true, task: result.rows[0] });
  } catch (err) {
    console.error("getTaskById error:", err);
    res.status(500).json({ success: false, message: "Error fetching task." });
  }
};

// Get categories
export const getCategories = async (req, res) => {
  try {
    const result = await pool.query(`SELECT id, name FROM categories ORDER BY name ASC`);
    res.json({ success: true, categories: result.rows });
  } catch (err) {
    console.error("getCategories error:", err);
    res.status(500).json({ success: false, message: "Error fetching categories." });
  }
};

// Add task files (shared between freelancer/client)
export const addTaskFiles = async (req, res) => {
  try {
    const userId = req.token?.userId;
    const { id: requestId } = req.params;
    const files = req.files || [];

    if (!files.length)
      return res.status(400).json({ success: false, message: "No files uploaded." });

    const reqCheck = await pool.query(
      `SELECT tr.*, t.freelancer_id
         FROM task_req tr
         JOIN tasks t ON tr.task_id = t.id
        WHERE tr.id = $1`,
      [requestId]
    );

    if (!reqCheck.rows.length)
      return res.status(404).json({ success: false, message: "Request not found." });

    const { freelancer_id, client_id } = reqCheck.rows[0];
    if (![freelancer_id, client_id].includes(userId))
      return res.status(403).json({ success: false, message: "You are not part of this request." });

    const uploadedFiles = await uploadFilesToCloudinary(files, `tasks/${requestId}/shared`);
    await insertFileRecords(uploadedFiles, requestId, userId);

    res.json({ success: true, message: "Files added successfully.", files: uploadedFiles });
  } catch (err) {
    console.error("addTaskFiles error:", err);
    res.status(500).json({ success: false, message: "Error adding files." });
  }
};

/* ===============================================================
   LISTS FOR USERS
================================================================= */

// Freelancer: tasks created by me (with category + request count)
export const getFreelancerCreatedTasks = async (req, res) => {
  try {
    if (req.token?.role !== 3)
      return res.status(403).json({ success: false, message: "Access denied. Freelancers only." });
    const freelancerId = req.token.userId;
    const result = await pool.query(
      `SELECT t.*, c.name AS category_name,
              COUNT(r.id) AS total_requests
         FROM tasks t
    LEFT JOIN categories c ON t.category_id = c.id
    LEFT JOIN task_req r ON r.task_id = t.id
        WHERE t.freelancer_id = $1 AND t.is_deleted = FALSE
     GROUP BY t.id, c.name
     ORDER BY t.id DESC`,
      [freelancerId]
    );
    res.json({ success: true, tasks: result.rows });
  } catch (err) {
    console.error("getFreelancerCreatedTasks error:", err);
    res.status(500).json({ success: false, message: "Server error." });
  }
};

// Freelancer: assigned tasks (real client name)
export const getAssignedTasks = async (req, res) => {
  try {
    if (req.token?.role !== 3)
      return res.status(403).json({ success: false, message: "Access denied. Freelancers only." });
    const freelancerId = req.token.userId;
    const result = await pool.query(
      `SELECT tr.*, 
              t.title AS task_title,
              t.description AS task_description,
              u.first_name || ' ' || u.last_name AS client_name,
              u.profile_pic_url AS client_avatar
         FROM task_req tr
         JOIN tasks t ON tr.task_id = t.id
         JOIN users u ON tr.client_id = u.id
        WHERE t.freelancer_id = $1
          AND tr.status IN ('pending_payment','in_progress','pending_review','reviewing','completed')
     ORDER BY tr.id DESC`,
      [freelancerId]
    );
    res.json({ success: true, tasks: result.rows });
  } catch (err) {
    console.error("getAssignedTasks error:", err);
    res.status(500).json({ success: false, message: "Server error." });
  }
};