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
   1=admin, 2=client, 3=freelancer
   (عدّلتها لتغطي كل الأحداث اللي عندك)
=========================================================== */

const ROLE_NOTIFICATIONS = {
  1: Object.values(NOTIFICATION_TYPES),

  2: [
    NOTIFICATION_TYPES.MESSAGE_RECEIVED,

    NOTIFICATION_TYPES.OFFER_SUBMITTED,

    NOTIFICATION_TYPES.PROJECT_STATUS_CHANGED,

    NOTIFICATION_TYPES.WORK_SUBMITTED,
    NOTIFICATION_TYPES.WORK_APPROVED,

    NOTIFICATION_TYPES.PAYMENT_APPROVED,
    NOTIFICATION_TYPES.PAYMENT_REJECTED,
    NOTIFICATION_TYPES.PAYMENT_PENDING,

    NOTIFICATION_TYPES.ESCROW_CREATED,
    NOTIFICATION_TYPES.ESCROW_RELEASED,

    NOTIFICATION_TYPES.SYSTEM_ANNOUNCEMENT,

    NOTIFICATION_TYPES.APPOINTMENT_SCHEDULED,
    NOTIFICATION_TYPES.APPOINTMENT_CANCELLED,
    NOTIFICATION_TYPES.APPOINTMENT_REQUESTED,
    NOTIFICATION_TYPES.APPOINTMENT_RESCHEDULED,
    NOTIFICATION_TYPES.APPOINTMENT_COMPLETED,

    NOTIFICATION_TYPES.COURSE_ENROLLED,
  ],

  3: [
    NOTIFICATION_TYPES.PROJECT_CREATED,

    NOTIFICATION_TYPES.OFFER_APPROVED,
    NOTIFICATION_TYPES.OFFER_REJECTED,

    NOTIFICATION_TYPES.FREELANCER_ASSIGNED,
    NOTIFICATION_TYPES.FREELANCER_REMOVED,

    NOTIFICATION_TYPES.PROJECT_STATUS_CHANGED,

    NOTIFICATION_TYPES.WORK_APPROVED,
    NOTIFICATION_TYPES.WORK_REVISION_REQUESTED,

    NOTIFICATION_TYPES.ESCROW_CREATED,
    NOTIFICATION_TYPES.ESCROW_RELEASED,

    NOTIFICATION_TYPES.PAYMENT_RELEASED,
    NOTIFICATION_TYPES.PAYMENT_APPROVED,
    NOTIFICATION_TYPES.PAYMENT_REJECTED,
    NOTIFICATION_TYPES.PAYMENT_PENDING,

    NOTIFICATION_TYPES.TASK_REQUESTED,
    NOTIFICATION_TYPES.TASK_NEEDS_APPROVAL,
    NOTIFICATION_TYPES.TASK_COMPLETED,

    NOTIFICATION_TYPES.REVIEW_SUBMITTED,
    NOTIFICATION_TYPES.MESSAGE_RECEIVED,

    NOTIFICATION_TYPES.USER_VERIFIED,
    NOTIFICATION_TYPES.USER_VERIFICATION_REJECTED,

    NOTIFICATION_TYPES.SUBSCRIPTION_STATUS_CHANGED,
    NOTIFICATION_TYPES.SYSTEM_ANNOUNCEMENT,

    NOTIFICATION_TYPES.APPOINTMENT_SCHEDULED,
    NOTIFICATION_TYPES.APPOINTMENT_CANCELLED,
    NOTIFICATION_TYPES.APPOINTMENT_REQUESTED,
    NOTIFICATION_TYPES.APPOINTMENT_RESCHEDULED,
    NOTIFICATION_TYPES.APPOINTMENT_COMPLETED,

    NOTIFICATION_TYPES.COURSE_ENROLLED,
  ],
};

/* ===========================================================
   HELPERS
=========================================================== */

const toInt = (v) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
};

const safeText = (v) => (typeof v === "string" ? v.trim() : "");

const truncate = (text, max = 70) => {
  const t = safeText(text);
  if (!t) return "";
  return t.length > max ? `${t.slice(0, max)}…` : t;
};

// ✅ Hide names for non-admin users
const anonymizeMessageForRole = (message, roleId) => {
  // Admin sees full names
  if (roleId === 1) return message;

  if (!message) return message;

  return (
    message
      // "from NAME" -> "from a user"
      .replace(/\bfrom\s+[^:"]+/gi, "from a user")
      // "by NAME" -> "by a user"
      .replace(/\bby\s+[^:"]+/gi, "by a user")
      // "NAME applied" -> "A freelancer applied"
      .replace(/^[A-Za-z0-9_ ]+\s+applied/gi, "A freelancer applied")
      // "NAME accepted/rejected" -> "The freelancer accepted/rejected"
      .replace(/^[A-Za-z0-9_ ]+\s+(accepted|rejected)/gi, "The freelancer $1")
      // any quoted "NAME" -> "the user"
      .replace(/\"[A-Za-z0-9_ ]+\"/g, '"the user"')
  );
};

const emitSocket = (userId, notificationRow) => {
  try {
    if (global.io) {
      global.io.to(`user:${userId}`).emit("notification:new", {
        id: notificationRow.id,
        type: notificationRow.type,
        message: notificationRow.message,
        relatedEntityId: notificationRow.related_entity_id,
        entityType: notificationRow.entity_type,
        read_status: notificationRow.read_status,
        created_at: notificationRow.created_at,
      });
    }
  } catch (e) {
    console.error("[NotificationSocketError]", e);
  }
};

const getAdmins = async () => {
  const { rows } = await pool.query(
    `SELECT id FROM users WHERE role_id = 1 AND is_deleted = false`
  );
  return rows.map((r) => r.id);
};

const getUserName = async (userId) => {
  if (!userId) return "System";
  const { rows } = await pool.query(
    `SELECT first_name, last_name, username
     FROM users
     WHERE id = $1 AND is_deleted = false`,
    [userId]
  );
  if (!rows.length) return "Unknown User";

  const { first_name, last_name, username } = rows[0];
  const full = `${first_name || ""} ${last_name || ""}`.trim();
  return full || username || "Unknown User";
};

const getProjectBasics = async (projectId) => {
  const pid = toInt(projectId);
  if (!pid) return null;

  const { rows } = await pool.query(
    `SELECT id, title, user_id, category_id
     FROM projects
     WHERE id = $1 AND is_deleted = false`,
    [pid]
  );
  return rows[0] || null;
};

/* ===========================================================
   CORE CRUD
=========================================================== */

export const createNotification = async (
  userId,
  type,
  message,
  relatedEntityId = null,
  entityType = null
) => {
  try {
    const uid = toInt(userId);
    if (!uid) return null;

    const notifType = safeText(type);
    const rawMsg = safeText(message);

    if (!notifType || !rawMsg) return null;

    // get role
    const { rows: userRows } = await pool.query(
      `SELECT role_id FROM users WHERE id = $1 AND is_deleted = false`,
      [uid]
    );
    if (!userRows.length) return null;

    const roleId = userRows[0].role_id;

    // role restrictions
    if (!(ROLE_NOTIFICATIONS[roleId] || []).includes(notifType)) return null;

    // ✅ anonymize message for non-admins
    const notifMsg = anonymizeMessageForRole(rawMsg, roleId);

    const relId = relatedEntityId === null ? null : toInt(relatedEntityId);
    const entType = entityType ? String(entityType) : null;

    const { rows } = await pool.query(
      `INSERT INTO notifications (user_id, type, message, related_entity_id, entity_type)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [uid, notifType, notifMsg, relId, entType]
    );

    const notification = rows[0];

    emitSocket(uid, notification);
    return notification;
  } catch (err) {
    console.error("[NotificationError:createNotification]", err);
    return null;
  }
};

export const createBulkNotifications = async (
  userIds,
  type,
  message,
  relatedEntityId = null,
  entityType = null
) => {
  if (!Array.isArray(userIds) || userIds.length === 0) return [];

  const settled = await Promise.allSettled(
    userIds.map((id) =>
      createNotification(id, type, message, relatedEntityId, entityType)
    )
  );

  return settled
    .filter((r) => r.status === "fulfilled" && r.value)
    .map((r) => r.value);
};

export const getUserNotifications = async (
  userId,
  limit = 50,
  offset = 0,
  unreadOnly = false
) => {
  const uid = toInt(userId);
  if (!uid) return [];

  const parsedLimit = Math.min(toInt(limit) || 50, 100);
  const parsedOffset = Math.max(toInt(offset) || 0, 0);

  const query = `
    SELECT *
    FROM notifications
    WHERE user_id = $1
      ${unreadOnly ? "AND read_status = false" : ""}
    ORDER BY created_at DESC
    LIMIT $2 OFFSET $3
  `;

  const { rows } = await pool.query(query, [uid, parsedLimit, parsedOffset]);
  return rows;
};

export const markNotificationAsRead = async (notificationId, userId) => {
  const nid = toInt(notificationId);
  const uid = toInt(userId);
  if (!nid || !uid) return false;

  const { rowCount } = await pool.query(
    `UPDATE notifications
     SET read_status = true
     WHERE id = $1 AND user_id = $2`,
    [nid, uid]
  );

  return rowCount > 0;
};

export const markAllNotificationsAsRead = async (userId) => {
  const uid = toInt(userId);
  if (!uid) return 0;

  const { rowCount } = await pool.query(
    `UPDATE notifications
     SET read_status = true
     WHERE user_id = $1 AND read_status = false`,
    [uid] // ✅ كان ناقص عندك
  );

  return rowCount;
};

export const getNotificationCount = async (userId, unreadOnly = true) => {
  const uid = toInt(userId);
  if (!uid) return 0;

  const { rows } = await pool.query(
    `SELECT COUNT(*) AS count
     FROM notifications
     WHERE user_id = $1
       ${unreadOnly ? "AND read_status = false" : ""}`,
    [uid]
  );

  return parseInt(rows[0]?.count || "0", 10);
};

export const cleanupOldNotifications = async (daysOld = 90) => {
  const d = Math.max(toInt(daysOld) || 90, 30);

  const { rowCount } = await pool.query(
    `DELETE FROM notifications
     WHERE read_status = true
       AND created_at < NOW() - ($1 * INTERVAL '1 day')`,
    [d]
  );

  return rowCount;
};

/* ===========================================================
   NOTIFICATION CREATORS (USED BY CONTROLLERS)
=========================================================== */

export const NotificationCreators = {
  /* ===========================
     CHAT / MESSAGES
  ============================ */

  messageReceived: async (senderId, recipientId, messageId, content) => {
    const senderName = await getUserName(senderId);
    const preview = content?.trim()?.length
      ? truncate(content, 70)
      : "📎 Sent an attachment";

    const msg = `You have a new message from ${senderName}: "${preview}"`;

    await createNotification(
      recipientId,
      NOTIFICATION_TYPES.MESSAGE_RECEIVED,
      msg,
      messageId,
      "message"
    );

    // also notify admins (audit)
    await NotificationCreators.chatsAdmin(senderId, recipientId, messageId, preview);
  },

  chatsAdmin: async (senderId, receiverId, messageId, contentPreview = "") => {
    const senderName = await getUserName(senderId);
    const receiverName = receiverId ? await getUserName(receiverId) : "System";

    const adminIds = await getAdmins();

    const msg = `${senderName} sent a message to ${receiverName}: "${truncate(
      contentPreview,
      70
    )}"`;

    await createBulkNotifications(
      adminIds,
      NOTIFICATION_TYPES.CHATS_ADMIN,
      msg,
      messageId,
      "message"
    );
  },

  /* ===========================
     SYSTEM ANNOUNCEMENTS
  ============================ */

  systemAnnouncement: async (adminId, messageText, userIds = []) => {
    const adminName = await getUserName(adminId);
    const msg = `📢 ${adminName} announced: ${safeText(messageText)}`;

    let recipients = userIds;

    if (!Array.isArray(recipients) || recipients.length === 0) {
      recipients = (
        await pool.query(`SELECT id FROM users WHERE is_deleted = false`)
      ).rows.map((r) => r.id);
    }

    await createBulkNotifications(
      recipients,
      NOTIFICATION_TYPES.SYSTEM_ANNOUNCEMENT,
      msg,
      null,
      "system"
    );
  },

  /* ===========================
     REVIEWS
  ============================ */

  reviewSubmitted: async (reviewId = null, freelancerId, reviewerName = "A client") => {
    const msg = `⭐ ${reviewerName} submitted a review on your profile.`;
    await createNotification(
      freelancerId,
      NOTIFICATION_TYPES.REVIEW_SUBMITTED,
      msg,
      reviewId ? toInt(reviewId) : null,
      "review"
    );
  },

  /* ===========================
     PROJECTS (CREATE + INVITES + APPLY)
  ============================ */

  projectCreated: async (projectId, projectTitle, clientId, categoryId = null) => {
    // notify admins
    const admins = await getAdmins();
    await createBulkNotifications(
      admins,
      NOTIFICATION_TYPES.PROJECT_CREATED,
      `🆕 New project created: "${safeText(projectTitle)}"`,
      projectId,
      "project"
    );

    // notify freelancers in same category (if exists)
    const cat = toInt(categoryId);
    let freelancerIds = [];

    if (cat) {
      const { rows } = await pool.query(
        `
        SELECT DISTINCT u.id
        FROM users u
        JOIN freelancer_categories fc ON fc.freelancer_id = u.id
        WHERE u.role_id = 3
          AND u.is_deleted = false
          AND COALESCE(u.is_verified, true) = true
          AND fc.category_id = $1
        `,
        [cat]
      );
      freelancerIds = rows.map((r) => r.id);
    } else {
      const { rows } = await pool.query(
        `
        SELECT id
        FROM users
        WHERE role_id = 3
          AND is_deleted = false
          AND COALESCE(is_verified, true) = true
        `
      );
      freelancerIds = rows.map((r) => r.id);
    }

    // avoid notifying the creator if he is also freelancer by accident
    const clientInt = toInt(clientId);
    if (clientInt) freelancerIds = freelancerIds.filter((id) => id !== clientInt);

    const clientName = await getUserName(clientId);
    const msg = `🧩 New project "${safeText(projectTitle)}" posted by ${clientName}`;

    await createBulkNotifications(
      freelancerIds,
      NOTIFICATION_TYPES.PROJECT_CREATED,
      msg,
      projectId,
      "project"
    );
  },

  // client invited freelancer OR assignment changed (also used in offers accept)
  // supports both call styles:
  // (projectId, freelancerId, assigned)
  // OR (projectId, projectTitle, freelancerId, assigned)
  freelancerAssignmentChanged: async (...args) => {
    let projectId, projectTitle, freelancerId, assigned;

    if (args.length === 3) {
      [projectId, freelancerId, assigned] = args;
      projectTitle = null;
    } else {
      [projectId, projectTitle, freelancerId, assigned] = args;
    }

    const pid = toInt(projectId);
    const fid = toInt(freelancerId);
    if (!pid || !fid) return;

    let title = safeText(projectTitle);
    if (!title) {
      const p = await getProjectBasics(pid);
      title = p?.title || "a project";
    }

    const type = assigned
      ? NOTIFICATION_TYPES.FREELANCER_ASSIGNED
      : NOTIFICATION_TYPES.FREELANCER_REMOVED;

    const msg = assigned
      ? `📨 You have an update regarding "${title}". Check your assignments.`
      : `ℹ️ You were removed from "${title}".`;

    await createNotification(fid, type, msg, pid, "project");
  },

  // freelancer applied to client project (fixed/hourly apply flow)
  freelancerAppliedForProject: async (clientId, freelancerId, projectId, projectTitle) => {
    const freelancerName = await getUserName(freelancerId);
    const title = safeText(projectTitle) || "your project";
    const msg = `🧑‍💻 ${freelancerName} applied for "${title}".`;

    await createNotification(
      clientId,
      NOTIFICATION_TYPES.PROJECT_STATUS_CHANGED,
      msg,
      toInt(projectId),
      "project"
    );
  },

  // client accepted/rejected freelancer application
  freelancerApplicationStatusChanged: async (projectId, freelancerId, projectTitle, accepted) => {
    const title = safeText(projectTitle) || "the project";
    const msg = accepted
      ? `✅ Your application for "${title}" was accepted.`
      : `❌ Your application for "${title}" was rejected.`;

    // استخدم PROJECT_STATUS_CHANGED حتى تكون واضحة
    await createNotification(
      freelancerId,
      NOTIFICATION_TYPES.PROJECT_STATUS_CHANGED,
      msg,
      toInt(projectId),
      "project"
    );
  },

  freelancerAssigned: async (freelancerId, projectId, projectTitle) => {
    const title = safeText(projectTitle) || "a project";
    const msg = `🎉 You are now assigned to "${title}".`;

    await createNotification(
      freelancerId,
      NOTIFICATION_TYPES.FREELANCER_ASSIGNED,
      msg,
      toInt(projectId),
      "project"
    );
  },

  // freelancer accepted invitation (notify client)
  freelancerAcceptedAssignment: async (projectId, freelancerId) => {
    const p = await getProjectBasics(projectId);
    if (!p) return;

    const freelancerName = await getUserName(freelancerId);
    const msg = `✅ ${freelancerName} accepted your invitation for "${p.title}".`;

    await createNotification(
      p.user_id,
      NOTIFICATION_TYPES.PROJECT_STATUS_CHANGED,
      msg,
      p.id,
      "project"
    );
  },

  // freelancer rejected invitation (notify client)
  freelancerRejectedAssignment: async (projectId, freelancerId) => {
    const p = await getProjectBasics(projectId);
    if (!p) return;

    const freelancerName = await getUserName(freelancerId);
    const msg = `❌ ${freelancerName} rejected your invitation for "${p.title}".`;

    await createNotification(
      p.user_id,
      NOTIFICATION_TYPES.PROJECT_STATUS_CHANGED,
      msg,
      p.id,
      "project"
    );
  },

  /* ===========================
     OFFERS (BIDDING)
  ============================ */

  offerSubmitted: async (offerId, projectId, projectTitle, freelancerName = "A freelancer") => {
    const p = await getProjectBasics(projectId);
    if (!p) return;

    const msg = `📩 New offer on "${safeText(projectTitle) || p.title}" from ${freelancerName}.`;

    await createNotification(
      p.user_id,
      NOTIFICATION_TYPES.OFFER_SUBMITTED,
      msg,
      toInt(offerId),
      "offer"
    );
  },

  offerStatusChanged: async (offerId, projectTitle, freelancerId, accepted) => {
    const title = safeText(projectTitle) || "your project";

    const type = accepted
      ? NOTIFICATION_TYPES.OFFER_APPROVED
      : NOTIFICATION_TYPES.OFFER_REJECTED;

    const msg = accepted
      ? `✅ Your offer for "${title}" was accepted!`
      : `❌ Your offer for "${title}" was rejected.`;

    await createNotification(
      freelancerId,
      type,
      msg,
      toInt(offerId),
      "offer"
    );
  },

  /* ===========================
     ESCROW / PAYMENTS (Projects)
  ============================ */

  escrowFunded: async (projectId, projectTitle, freelancerId, amount) => {
    const title = safeText(projectTitle) || "a project";
    const amt = amount != null ? Number(amount) : null;

    const msg = amt
      ? `💰 Escrow funded for "${title}" (Amount: ${amt}).`
      : `💰 Escrow funded for "${title}".`;

    await createNotification(
      freelancerId,
      NOTIFICATION_TYPES.ESCROW_CREATED,
      msg,
      toInt(projectId),
      "escrow"
    );
  },

  escrowReleased: async (projectId, projectTitle, freelancerId, amount) => {
    const title = safeText(projectTitle) || "a project";
    const amt = amount != null ? Number(amount) : null;

    const msg = amt
      ? `✅ Escrow released for "${title}" (Amount: ${amt}).`
      : `✅ Escrow released for "${title}".`;

    await createNotification(
      freelancerId,
      NOTIFICATION_TYPES.ESCROW_RELEASED,
      msg,
      toInt(projectId),
      "escrow"
    );
  },

  /* ===========================
     WORK COMPLETION (Projects)
  ============================ */

  workCompletionReviewed: async (freelancerId, projectId, projectTitle, status) => {
    const title = safeText(projectTitle) || "your project";

    if (status === "completed") {
      await createNotification(
        freelancerId,
        NOTIFICATION_TYPES.WORK_APPROVED,
        `🎉 Your work on "${title}" was approved. Project completed!`,
        toInt(projectId),
        "project"
      );
      return;
    }

    if (status === "revision_requested") {
      await createNotification(
        freelancerId,
        NOTIFICATION_TYPES.WORK_REVISION_REQUESTED,
        `🛠️ Revision requested on "${title}". Please resubmit updates.`,
        toInt(projectId),
        "project"
      );
      return;
    }

    await createNotification(
      freelancerId,
      NOTIFICATION_TYPES.PROJECT_STATUS_CHANGED,
      `ℹ️ Update on "${title}": ${safeText(status)}`,
      toInt(projectId),
      "project"
    );
  },

  workResubmittedForReview: async (projectId, projectTitle, freelancerId) => {
    const p = await getProjectBasics(projectId);
    if (!p) return;

    const freelancerName = await getUserName(freelancerId);
    const title = safeText(projectTitle) || p.title;

    const msg = `📦 ${freelancerName} resubmitted work for "${title}" (pending review).`;

    await createNotification(
      p.user_id,
      NOTIFICATION_TYPES.WORK_SUBMITTED,
      msg,
      p.id,
      "project"
    );
  },

  /* ===========================
     TASK SYSTEM
  ============================ */

  taskStatusChange: async (userId, taskId, messageText) => {
    await createNotification(
      userId,
      NOTIFICATION_TYPES.TASK_NEEDS_APPROVAL,
      safeText(messageText),
      toInt(taskId),
      "task"
    );
  },

  taskRequested: async (freelancerId, taskId, messageText) => {
    await createNotification(
      freelancerId,
      NOTIFICATION_TYPES.TASK_REQUESTED,
      safeText(messageText),
      toInt(taskId),
      "task"
    );
  },

  paymentSubmitted: async (freelancerId, requestId) => {
    await createNotification(
      freelancerId,
      NOTIFICATION_TYPES.PAYMENT_PENDING,
      "A client has submitted a payment proof.",
      toInt(requestId),
      "task_request"
    );
  },

  paymentConfirmed: async (userId, requestId) => {
    await createNotification(
      userId,
      NOTIFICATION_TYPES.PAYMENT_APPROVED,
      "Admin confirmed the payment.",
      toInt(requestId),
      "task_request"
    );
  },
};

/* ===========================================================
   DEFAULT EXPORT (OPTIONAL)
=========================================================== */

export default {
  NOTIFICATION_TYPES,
  createNotification,
  createBulkNotifications,
  getUserNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  getNotificationCount,
  cleanupOldNotifications,
};
