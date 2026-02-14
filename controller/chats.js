import pool from "../models/db.js";
import { NotificationCreators } from "../services/notificationService.js";

/*======= Helper Functions =======*/
// This is a new helper function to get a user's name by their ID.
const getUserName = async (userId) => {
  if (!userId) return "N/A";
  try {
    const { rows } = await pool.query(`SELECT first_name, last_name FROM users WHERE id = $1`, [userId]);
    if (rows.length > 0) {
      return `${rows[0].first_name || ''} ${rows[0].last_name || ''}`.trim();
    }
    return `User #${userId}`;
  } catch {
    return `User #${userId}`;
  }
};

const getAdminIds = async () => {
  const { rows } = await pool.query(`SELECT id FROM users WHERE role_id = 1 AND is_deleted = false`);
  return rows.map(r => r.id);
};

const getSystemSenderId = async () => {
  const { rows } = await pool.query(`SELECT id FROM users WHERE role_id = 1 AND is_deleted = false ORDER BY id ASC LIMIT 1`);
  return rows[0]?.id || null;
};

const isAdmin = async (userId) => {
  if (!userId) return false;
  const { rows } = await pool.query(`SELECT role_id FROM users WHERE id = $1 AND is_deleted = false`, [userId]);
  return rows[0]?.role_id === 1;
};

const getProjectParticipants = async (projectId) => {
  const { rows } = await pool.query(`SELECT p.user_id, pa.freelancer_id FROM projects p LEFT JOIN project_assignments pa ON pa.project_id = p.id WHERE p.id = $1 AND p.is_deleted = false`, [projectId]);
  return Array.from(new Set(rows.flatMap(r => [r.user_id, r.freelancer_id]))).filter(Boolean);
};

const getTaskParticipants = async (taskId) => {
  const { rows } = await pool.query(`SELECT freelancer_id, assigned_client_id FROM tasks WHERE id = $1`, [taskId]);
  if (!rows.length) return [];
  return [rows[0].freelancer_id, rows[0].assigned_client_id].filter(Boolean);
};

const isChatAllowed = async (projectId, taskId) => {
  const allowed = ["in_progress", "pending_review", "reviewing"];

  try {
    if (projectId) {
      const { rows } = await pool.query(
        `SELECT status, completion_status FROM projects WHERE id = $1 AND is_deleted = false`,
        [projectId]
      );
      return rows.length > 0 && (allowed.includes(rows[0].status) || allowed.includes(rows[0].completion_status));
    }
    
    if (taskId) {
      const { rows } = await pool.query(
        `SELECT status FROM tasks WHERE id = $1`,
        [taskId]
      );
      return rows.length > 0 && allowed.includes(rows[0].status);
    }
    
    return false;
  } catch (err) {
    console.error("❌ Error in isChatAllowed:", err.message);
    return false;
  }
};

const forbiddenPatterns = [
    /\b\d{5,}\b/g, /\+\d{1,3}\s?\d{5,}/g, /\b\S+@\S+\.\S+\b/g,
    /\b(telegram|whatsapp|snapchat|instagram|facebook|tiktok|discord|skype|linkedin)\b/gi,
    /\b(تلجرام|واتساب|سناب|انستقرام|فيس|تيك\s?توك|ديسكورد|سكايب|لينكد)\b/gi,
    /(https?:\/\/[^\s]+  )|(www\.[^\s]+)/gi,
    /\b(\.com|\.net|\.org|\.io|\.co)\b/gi,
];

/*======= Controller Functions =======*/

export const getUserChats = async (req, res) => {
  const userId = req.token?.userId;
  if (!userId) return res.status(401).json({ success: false, message: "Authentication required" });
  try {
    const projectsQuery = `SELECT p.id, p.title AS name, 'project' AS chat_type FROM projects p LEFT JOIN project_assignments pa ON p.id = pa.project_id WHERE (p.user_id = $1 OR pa.freelancer_id = $1) AND p.is_deleted = false GROUP BY p.id, p.title;`;
    const tasksQuery = `SELECT t.id, t.title AS name, 'task' AS chat_type FROM tasks t WHERE (t.assigned_client_id = $1 OR t.freelancer_id = $1) AND t.is_deleted = false GROUP BY t.id, t.title;`;
    const [projectChats, taskChats] = await Promise.all([pool.query(projectsQuery, [userId]), pool.query(tasksQuery, [userId])]);
    return res.status(200).json({ success: true, chats: [...projectChats.rows, ...taskChats.rows] });
  } catch (err) {
    console.error("❌ Error in getUserChats:", err.message);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

export const getMessagesByProjectId = async (req, res) => {
  const { projectId } = req.params;
  const requesterId = req.token?.userId;
  try {
    if (!(await isAdmin(requesterId))) {
      const participants = await getProjectParticipants(projectId);
      if (!participants.includes(requesterId)) return res.status(403).json({ success: false, message: "Access denied" });
    }
    const { rows } = await pool.query(`SELECT m.*, json_build_object('id', u.id, 'first_name', u.first_name, 'last_name', u.last_name, 'avatar', u.profile_pic_url) AS sender FROM messages m LEFT JOIN users u ON u.id = m.sender_id WHERE m.project_id = $1 ORDER BY m.time_sent ASC`, [projectId]);
    return res.status(200).json({ success: true, messages: rows || [] });
  } catch (err) {
    console.error("❌ Error in getMessagesByProjectId:", err.message);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

export const getMessagesByTaskId = async (req, res) => {
  const { taskId } = req.params;
  const requesterId = req.token?.userId;
  try {
    if (!(await isAdmin(requesterId))) {
      const participants = await getTaskParticipants(taskId);
      if (!participants.includes(requesterId)) return res.status(403).json({ success: false, message: "Access denied" });
    }
    const { rows } = await pool.query(`SELECT m.*, json_build_object('id', u.id, 'first_name', u.first_name, 'last_name', u.last_name, 'avatar', u.profile_pic_url) AS sender FROM messages m LEFT JOIN users u ON u.id = m.sender_id WHERE m.task_id = $1 ORDER BY m.time_sent ASC`, [taskId]);
    return res.status(200).json({ success: true, messages: rows || [] });
  } catch (err) {
    console.error("❌ Error in getMessagesByTaskId:", err.message);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

export const createMessage = async (req, res) => {
  const sender_id = req.token?.userId;
  const { project_id = null, task_id = null, content, image_url = null } = req.body;

  if (!sender_id || !content) return res.status(400).json({ success: false, message: "Sender and content required" });
  if (!!project_id === !!task_id) return res.status(400).json({ success: false, message: "Provide either project_id or task_id" });

  try {
    if (!(await isChatAllowed(project_id, task_id))) {
      return res.status(403).json({ success: false, message: "Chat is not allowed for this project/task status" });
    }

    const cleanedForCheck = content.replace(/@\[[^\]]+\]\(\d+\)/g, "");
    if (forbiddenPatterns.some((pat) => pat.test(cleanedForCheck))) {
      const systemSenderId = await getSystemSenderId() || sender_id;
      const systemMessage = "⚠️ This chat has been locked due to a violation of Community Standards.";
      
      if (project_id) await pool.query(`UPDATE projects SET status = 'terminated', updated_at = NOW() WHERE id = $1`, [project_id]);
      else await pool.query(`UPDATE tasks SET status = 'terminated', updated_at = NOW() WHERE id = $1`, [task_id]);

      const { rows: sysRows } = await pool.query(`INSERT INTO messages (sender_id, ${project_id ? 'project_id' : 'task_id'}, content, is_system) VALUES ($1, $2, $3, TRUE) RETURNING *`, [systemSenderId, project_id || task_id, systemMessage]);
      
      const participants = project_id ? await getProjectParticipants(project_id) : await getTaskParticipants(task_id);
      
      // ================== ENHANCED ADMIN NOTIFICATION ==================
      const adminIds = await getAdminIds();
      if (adminIds.length > 0) {
        const [clientId, freelancerId] = participants;
        const clientName = await getUserName(clientId);
        const freelancerName = await getUserName(freelancerId);
        const violatorName = await getUserName(sender_id);

        const violationMessage = `Violation in ${project_id ? `Project #${project_id}` : `Task #${task_id}`}.
          - Participants: ${clientName} (Client), ${freelancerName} (Freelancer).
          - Violated by: ${violatorName}.
          - Message: "${content}"`;

        // Your notification service might need to be adjusted to handle a different payload.
        // Assuming it can take a 'content' field directly.
        await Promise.all(adminIds.map(adminId => 
          NotificationCreators.systemMessage({ // Using systemMessage or a new 'chatViolation' creator
            receiverId: adminId,
            text: violationMessage,
            projectId: project_id,
            taskId: task_id,
          })
        ));
      }
      // ================================================================

      if (global.io) global.io.to(project_id ? `project:${project_id}` : `task:${task_id}`).emit("chat:system_message", { message: systemMessage });
      
      return res.status(403).json({ success: false, message: "Chat locked due to violation" });
    }

    const participants = project_id ? await getProjectParticipants(project_id) : await getTaskParticipants(task_id);
    const receiver_id = participants.find(id => id && id !== sender_id) || null;

    const { rows } = await pool.query(`INSERT INTO messages (sender_id, receiver_id, ${project_id ? 'project_id' : 'task_id'}, content, image_url) VALUES ($1, $2, $3, $4, $5) RETURNING *`, [sender_id, receiver_id, project_id || task_id, content, image_url]);
    const newMessage = rows[0];

    const { rows: [fullMessage] } = await pool.query(`SELECT m.*, json_build_object('id', u.id, 'first_name', u.first_name, 'last_name', u.last_name, 'avatar', u.profile_pic_url) AS sender FROM messages m LEFT JOIN users u ON u.id = m.sender_id WHERE m.id = $1`, [newMessage.id]);

    if (global.io) {
        global.io.to(project_id ? `project:${project_id}` : `task:${task_id}`).emit("chat:new_message", { message: fullMessage });
    }

    if (receiver_id) {
      await NotificationCreators.messageReceived(
        sender_id,
        receiver_id,
        newMessage.id,
        content
      );
    }

    return res.status(201).json({ success: true, message: "Message sent", sentMessage: fullMessage });
  } catch (err) {
    console.error("❌ Error in createMessage:", err.message);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

export const getAllChatsForAdmin = async (req, res) => {
  const requesterId = req.token?.userId;
  try {
    if (!(await isAdmin(requesterId))) return res.status(403).json({ success: false, message: "Access denied (admin only)" });

    const sql = `
      SELECT 
        m.id, m.project_id, m.task_id, m.content, m.time_sent,
        COALESCE(p.title, t.title) AS related_title,
        CASE WHEN m.project_id IS NOT NULL THEN 'project' ELSE 'task' END AS chat_type,
        json_build_object('id', u.id, 'first_name', u.first_name, 'last_name', u.last_name) AS sender
      FROM messages m
      LEFT JOIN users u ON u.id = m.sender_id
      LEFT JOIN projects p ON p.id = m.project_id
      LEFT JOIN tasks t ON t.id = m.task_id
      WHERE m.project_id IS NOT NULL OR m.task_id IS NOT NULL
      ORDER BY m.time_sent DESC
      LIMIT 500
    `;
    const { rows } = await pool.query(sql);
    return res.status(200).json({ success: true, count: rows.length, messages: rows });
  } catch (err) {
    console.error("❌ Error in getAllChatsForAdmin:", err.message);
    return res.status(500).json({ success: false, message: "Server error", error: err.message });
  }
};

/** GET /chat/project/:projectId/unread — unread count for current user (client + freelancer) */
export const getUnreadCountByProjectId = async (req, res) => {
  const { projectId } = req.params;
  const userId = req.token?.userId;
  if (!userId) return res.status(401).json({ success: false, message: "Authentication required" });
  try {
    if (!(await isAdmin(userId))) {
      const participants = await getProjectParticipants(projectId);
      if (!participants.includes(userId)) return res.status(403).json({ success: false, message: "Access denied" });
    }
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS count FROM messages m
       WHERE m.project_id = $1 AND m.time_sent > COALESCE(
         (SELECT pcr.last_read_at FROM project_chat_read pcr WHERE pcr.user_id = $2 AND pcr.project_id = $1),
         '1970-01-01'::timestamptz
       )`,
      [projectId, userId]
    );
    const count = rows[0]?.count ?? 0;
    return res.status(200).json({ success: true, count, hasUnread: count > 0 });
  } catch (err) {
    if (err.code === "42P01") return res.status(200).json({ success: true, count: 0, hasUnread: false });
    console.error("❌ Error in getUnreadCountByProjectId:", err.message);
    return res.status(500).json({ success: false, message: "Server error", count: 0 });
  }
};

/** POST /chat/project/:projectId/read — mark project chat as read for current user */
export const markProjectChatAsRead = async (req, res) => {
  const { projectId } = req.params;
  const userId = req.token?.userId;
  if (!userId) return res.status(401).json({ success: false, message: "Authentication required" });
  try {
    if (!(await isAdmin(userId))) {
      const participants = await getProjectParticipants(projectId);
      if (!participants.includes(userId)) return res.status(403).json({ success: false, message: "Access denied" });
    }
    await pool.query(
      `INSERT INTO project_chat_read (user_id, project_id, last_read_at) VALUES ($1, $2, NOW())
       ON CONFLICT (user_id, project_id) DO UPDATE SET last_read_at = NOW()`,
      [userId, projectId]
    );
    return res.status(200).json({ success: true, message: "Marked as read" });
  } catch (err) {
    if (err.code === "42P01") return res.status(200).json({ success: true, message: "Marked as read" });
    console.error("❌ Error in markProjectChatAsRead:", err.message);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};