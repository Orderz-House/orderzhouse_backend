import pool from "../models/db.js";

/* ===========================================================
   NOTIFICATION TYPES
=========================================================== */

export const NOTIFICATION_TYPES = {
  PROJECT_CREATED: "project_created",
  OFFER_SUBMITTED: "offer_submitted",
  OFFER_APPROVED: "offer_approved",
  OFFER_REJECTED: "offer_rejected",
  FREELANCER_ASSIGNED: "freelancer_assigned",
  FREELANCER_REMOVED: "freelancer_removed",
  PROJECT_STATUS_CHANGED: "project_status_changed",
  WORK_SUBMITTED: "work_submitted",
  WORK_APPROVED: "work_approved",
  WORK_REVISION_REQUESTED: "work_revision_requested",
  ESCROW_CREATED: "escrow_created",
  ESCROW_RELEASED: "escrow_released",
  PAYMENT_RELEASED: "payment_released",
  PAYMENT_APPROVED: "payment_approved",
  PAYMENT_REJECTED: "payment_rejected",
  PAYMENT_PENDING: "payment_pending",

  // TASK SYSTEM
  TASK_REQUESTED: "task_requested",
  TASK_REQUEST_ACCEPTED: "task_request_accepted",
  TASK_REQUEST_REJECTED: "task_request_rejected",
  TASK_COMPLETED: "task_completed",
  TASK_NEEDS_APPROVAL: "task_needs_approval",

  USER_REGISTERED: "user_registered",
  USER_VERIFIED: "user_verified",
  USER_VERIFICATION_REJECTED: "user_verification_rejected",
  REVIEW_SUBMITTED: "review_submitted",
  MESSAGE_RECEIVED: "message_received",
  APPOINTMENT_SCHEDULED: "appointment_scheduled",
  APPOINTMENT_CANCELLED: "appointment_cancelled",
  APPOINTMENT_REQUESTED: "appointment_requested",
  APPOINTMENT_RESCHEDULED: "appointment_rescheduled",
  APPOINTMENT_COMPLETED: "appointment_completed",
  COURSE_ENROLLED: "course_enrolled",
  SUBSCRIPTION_STATUS_CHANGED: "subscription_status_changed",
  SYSTEM_ANNOUNCEMENT: "system_announcement",
  CHATS_ADMIN: "chats_admin",
};

/* ===========================================================
   ROLE NOTIFICATION PERMISSIONS
=========================================================== */

const ROLE_NOTIFICATIONS = {
  1: Object.values(NOTIFICATION_TYPES),
  2: [
    NOTIFICATION_TYPES.USER_REGISTERED,
    NOTIFICATION_TYPES.MESSAGE_RECEIVED,
    NOTIFICATION_TYPES.OFFER_SUBMITTED,
    NOTIFICATION_TYPES.WORK_SUBMITTED,
    NOTIFICATION_TYPES.TASK_REQUEST_ACCEPTED,
    NOTIFICATION_TYPES.TASK_REQUEST_REJECTED,
    NOTIFICATION_TYPES.PROJECT_STATUS_CHANGED,
    NOTIFICATION_TYPES.WORK_APPROVED,
    NOTIFICATION_TYPES.SYSTEM_ANNOUNCEMENT,
    NOTIFICATION_TYPES.PAYMENT_APPROVED,
    NOTIFICATION_TYPES.PAYMENT_REJECTED,
  ],
  3: [
    NOTIFICATION_TYPES.PROJECT_CREATED,
    NOTIFICATION_TYPES.TASK_REQUESTED,
    NOTIFICATION_TYPES.OFFER_APPROVED,
    NOTIFICATION_TYPES.OFFER_REJECTED,
    NOTIFICATION_TYPES.FREELANCER_ASSIGNED,
    NOTIFICATION_TYPES.FREELANCER_REMOVED,
    NOTIFICATION_TYPES.WORK_REVISION_REQUESTED,
    NOTIFICATION_TYPES.PAYMENT_RELEASED,
    NOTIFICATION_TYPES.MESSAGE_RECEIVED,
    NOTIFICATION_TYPES.APPOINTMENT_SCHEDULED,
    NOTIFICATION_TYPES.APPOINTMENT_CANCELLED,
    NOTIFICATION_TYPES.COURSE_ENROLLED,
    NOTIFICATION_TYPES.REVIEW_SUBMITTED,
    NOTIFICATION_TYPES.TASK_COMPLETED,
    NOTIFICATION_TYPES.SYSTEM_ANNOUNCEMENT,
    NOTIFICATION_TYPES.USER_VERIFIED,
    NOTIFICATION_TYPES.USER_VERIFICATION_REJECTED,
    NOTIFICATION_TYPES.PAYMENT_APPROVED,
    NOTIFICATION_TYPES.PAYMENT_REJECTED,
    NOTIFICATION_TYPES.APPOINTMENT_REQUESTED,
    NOTIFICATION_TYPES.APPOINTMENT_RESCHEDULED,
    NOTIFICATION_TYPES.APPOINTMENT_COMPLETED,
    NOTIFICATION_TYPES.SUBSCRIPTION_STATUS_CHANGED
  ],
};

/* ===========================================================
   HELPERS
=========================================================== */

const getAdmins = async () => {
  const { rows } = await pool.query(
    `SELECT id FROM users WHERE role_id = 1 AND is_deleted = false`
  );
  return rows.map((r) => r.id);
};

const getUserName = async (userId) => {
  if (!userId) return "System";
  const { rows } = await pool.query(
    `SELECT first_name, last_name, username FROM users WHERE id = $1 AND is_deleted = false`,
    [userId]
  );
  if (!rows.length) return "Unknown User";

  const { first_name, last_name, username } = rows[0];
  return first_name || last_name
    ? `${first_name || ""} ${last_name || ""}`.trim()
    : username || "Unknown User";
};

/* ===========================================================
   CREATE NOTIFICATIONS
=========================================================== */

export const createNotification = async (
  userId,
  type,
  message,
  relatedEntityId = null,
  entityType = null
) => {
  try {
    const { rows: userRows } = await pool.query(
      `SELECT role_id FROM users WHERE id = $1`,
      [userId]
    );
    if (!userRows.length) return null;

    const roleId = userRows[0].role_id;

    // Role restriction:
    if (!(ROLE_NOTIFICATIONS[roleId] || []).includes(type)) return null;

    const { rows } = await pool.query(
      `INSERT INTO notifications (user_id, type, message, related_entity_id, entity_type)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [userId, type, message, relatedEntityId, entityType]
    );

    const notification = rows[0];

    // Emit WebSocket
    if (global.io) {
      global.io.to(`user:${userId}`).emit("notification:new", {
        id: notification.id,
        type: notification.type,
        message: notification.message,
        relatedEntityId: notification.related_entity_id,
        entityType: notification.entity_type,
        created_at: notification.created_at,
      });
    }

    return notification;
  } catch (err) {
    console.error("[NotificationError]", err);
  }
};

export const createBulkNotifications = async (
  userIds,
  type,
  message,
  relatedEntityId = null,
  entityType = null
) => {
  if (!Array.isArray(userIds) || !userIds.length) return [];

  const promises = userIds.map((id) =>
    createNotification(id, type, message, relatedEntityId, entityType)
  );

  return (await Promise.all(promises)).filter(Boolean);
};

/* ===========================================================
   NOTIFICATION CREATORS
=========================================================== */

export const NotificationCreators = {
  /* ===========================
       MESSAGES + CHAT
  ============================ */

  messageReceived: async (senderId, recipientId, messageId, content) => {
    const senderName = await getUserName(senderId);
    const preview = content?.trim()?.length
      ? content.substring(0, 70)
      : "📎 Sent an attachment";

    const message = `You have a new message from ${senderName}: "${preview}"`;

    await createNotification(
      recipientId,
      NOTIFICATION_TYPES.MESSAGE_RECEIVED,
      message,
      messageId,
      "message"
    );

    await NotificationCreators.chatsAdmin(senderId, recipientId, messageId, preview);
  },

  chatsAdmin: async (senderId, receiverId, messageId, contentPreview) => {
    const senderName = await getUserName(senderId);
    const receiverName = receiverId ? await getUserName(receiverId) : "System";

    const adminIds = await getAdmins();

    const message = `${senderName} sent a message to ${receiverName}: "${contentPreview}"`;

    await createBulkNotifications(
      adminIds,
      NOTIFICATION_TYPES.CHATS_ADMIN,
      message,
      messageId,
      "message"
    );
  },

  /* ===========================
       SYSTEM ANNOUNCEMENTS
  ============================ */

  systemAnnouncement: async (adminId, messageText, userIds = []) => {
    const adminName = await getUserName(adminId);
    const message = `📢 ${adminName} announced: ${messageText}`;

    let recipients = userIds;
    if (!recipients.length) {
      recipients = (
        await pool.query(`SELECT id FROM users WHERE is_deleted = false`)
      ).rows.map((r) => r.id);
    }

    await createBulkNotifications(
      recipients,
      NOTIFICATION_TYPES.SYSTEM_ANNOUNCEMENT,
      message,
      null,
      "system"
    );
  },

  /* ===========================
        TASK SYSTEM ✨
  ============================ */

  taskStatusChange: async (userId, taskId, messageText) => {
    await createNotification(
      userId,
      NOTIFICATION_TYPES.TASK_NEEDS_APPROVAL,
      messageText,
      taskId,
      "task"
    );
  },

  taskRequested: async (freelancerId, taskId, messageText) => {
    await createNotification(
      freelancerId,
      NOTIFICATION_TYPES.TASK_REQUESTED,
      messageText,
      taskId,
      "task"
    );
  },

  paymentSubmitted: async (freelancerId, requestId) => {
    await createNotification(
      freelancerId,
      NOTIFICATION_TYPES.PAYMENT_PENDING,
      "A client has submitted a payment proof.",
      requestId,
      "task_request"
    );
  },

  paymentConfirmed: async (userId, requestId) => {
    await createNotification(
      userId,
      NOTIFICATION_TYPES.PAYMENT_APPROVED,
      "Admin confirmed the payment.",
      requestId,
      "task_request"
    );
  },
};

/* ===========================================================
   FETCH, READ & CLEANUP
=========================================================== */

export const getUserNotifications = async (
  userId,
  limit = 50,
  offset = 0,
  unreadOnly = false
) => {
  const query = `
    SELECT * FROM notifications
    WHERE user_id = $1 ${unreadOnly ? "AND read_status = false" : ""}
    ORDER BY created_at DESC
    LIMIT $2 OFFSET $3
  `;
  const { rows } = await pool.query(query, [userId, limit, offset]);
  return rows;
};

export const markNotificationAsRead = async (notificationId, userId) => {
  const { rowCount } = await pool.query(
    `UPDATE notifications SET read_status = true WHERE id = $1 AND user_id = $2`,
    [notificationId, userId]
  );
  return rowCount > 0;
};

export const markAllNotificationsAsRead = async (userId) => {
  const { rowCount } = await pool.query(
    `UPDATE notifications SET read_status = true WHERE user_id = $1 AND read_status = false`
  );
  return rowCount;
};

export const getNotificationCount = async (userId, unreadOnly = true) => {
  const { rows } = await pool.query(
    `SELECT COUNT(*) AS count FROM notifications WHERE user_id = $1 ${
      unreadOnly ? "AND read_status = false" : ""
    }`,
    [userId]
  );
  return parseInt(rows[0].count, 10);
};

export const cleanupOldNotifications = async (daysOld = 90) => {
  const { rowCount } = await pool.query(
    `DELETE FROM notifications
     WHERE read_status = true
     AND created_at < NOW() - INTERVAL '${parseInt(daysOld)} days'`
  );
  return rowCount;
};
