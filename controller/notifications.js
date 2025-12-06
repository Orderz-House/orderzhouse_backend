import pool from "../models/db.js";
import {
  getUserNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  getNotificationCount,
  createNotification,
  cleanupOldNotifications,
  NOTIFICATION_TYPES,
} from "../services/notificationService.js";
import { LogCreators, ACTION_TYPES } from "../services/loggingService.js";

/** GET /notifications */
export const getNotifications = async (req, res) => {
  try {
    const userId = req.token?.userId;
    const { limit = 50, offset = 0, unreadOnly = false } = req.query;

    const parsedLimit = Math.min(parseInt(limit) || 50, 100);
    const parsedOffset = Math.max(parseInt(offset) || 0, 0);
    const parsedUnreadOnly = unreadOnly === "true";

    const notifications = await getUserNotifications(
      userId,
      parsedLimit,
      parsedOffset,
      parsedUnreadOnly
    );

    await LogCreators.projectOperation(
      userId,
      ACTION_TYPES.USER_READ,
      null,
      true,
      { action: "get_notifications", count: notifications.length }
    );

    res.json({
      success: true,
      notifications,
      pagination: {
        limit: parsedLimit,
        offset: parsedOffset,
        count: notifications.length,
      },
    });
  } catch (error) {
    console.error("Error getting notifications:", error);

    await LogCreators.projectOperation(
      req.token?.userId,
      ACTION_TYPES.USER_READ,
      null,
      false,
      { action: "get_notifications", error: error.message }
    );

    res.status(500).json({
      success: false,
      message: "Failed to get notifications",
    });
  }
};

/** PUT /notifications/:id/read */
export const markAsRead = async (req, res) => {
  try {
    const userId = req.token?.userId;
    const { id } = req.params;

    if (!id || isNaN(parseInt(id))) {
      return res.status(400).json({
        success: false,
        message: "Invalid notification ID",
      });
    }

    const success = await markNotificationAsRead(parseInt(id), userId);
    if (!success) {
      return res.status(404).json({
        success: false,
        message: "Notification not found or access denied",
      });
    }

    await LogCreators.projectOperation(
      userId,
      ACTION_TYPES.USER_UPDATE,
      null,
      true,
      { action: "mark_notification_read", notificationId: id }
    );

    res.json({ success: true, message: "Notification marked as read" });
  } catch (error) {
    console.error("Error marking notification as read:", error);
    res.status(500).json({ success: false, message: "Failed to mark notification as read" });
  }
};

/** PUT /notifications/read-all */
export const markAllAsRead = async (req, res) => {
  try {
    const userId = req.token?.userId;
    const updatedCount = await markAllNotificationsAsRead(userId);

    await LogCreators.projectOperation(
      userId,
      ACTION_TYPES.USER_UPDATE,
      null,
      true,
      { action: "mark_all_notifications_read", count: updatedCount }
    );

    res.json({
      success: true,
      message: `Marked ${updatedCount} notifications as read`,
    });
  } catch (error) {
    console.error("Error marking all notifications as read:", error);
    res.status(500).json({ success: false, message: "Failed to mark notifications as read" });
  }
};

/** GET /notifications/count */
export const getCount = async (req, res) => {
  try {
    const userId = req.token?.userId;
    const { unreadOnly = false } = req.query;
    const parsedUnreadOnly = unreadOnly === "true";

    const count = await getNotificationCount(userId, parsedUnreadOnly);

    res.json({ success: true, count, unreadOnly: parsedUnreadOnly });
  } catch (error) {
    console.error("Error getting notification count:", error);
    res.status(500).json({ success: false, message: "Failed to get notification count" });
  }
};

/** POST /notifications/test */
export const createTestNotification = async (req, res) => {
  try {
    const userId = req.token?.userId;
    const { message = "Test notification" } = req.body;

    const notification = await createNotification(
      userId,
      NOTIFICATION_TYPES.SYSTEM_ANNOUNCEMENT,
      message,
      null,
      "test"
    );

    res.json({
      success: true,
      message: "Test notification created",
      notification,
    });
  } catch (error) {
    console.error("Error creating test notification:", error);
    res.status(500).json({ success: false, message: "Failed to create test notification" });
  }
};

/** DELETE /notifications/cleanup */
export const cleanupNotifications = async (req, res) => {
  try {
    const userId = req.token?.userId;
    const { daysOld = 90 } = req.query;

    const { rows } = await pool.query(
      `SELECT role_id FROM users WHERE id = $1 AND is_deleted = false`,
      [userId]
    );
    if (!rows.length || rows[0].role_id !== 1) {
      return res.status(403).json({
        success: false,
        message: "Admin access required",
      });
    }

    const parsedDaysOld = Math.max(parseInt(daysOld) || 90, 30);
    const rowCount = await cleanupOldNotifications(parsedDaysOld);

    res.json({
      success: true,
      message: `Cleaned up ${rowCount} old notifications`,
      deletedCount: rowCount,
      daysOld: parsedDaysOld,
    });
  } catch (error) {
    console.error("Error cleaning up notifications:", error);
    res.status(500).json({ success: false, message: "Failed to cleanup notifications" });
  }
};

/** DELETE /notifications/:id */
export const deleteNotification = async (req, res) => {
  try {
    const userId = req.token?.userId;
    const { id } = req.params;

    if (!id || isNaN(parseInt(id))) {
      return res.status(400).json({
        success: false,
        message: "Invalid notification ID",
      });
    }

    const { rows } = await pool.query(
      `DELETE FROM notifications WHERE id = $1 AND user_id = $2 RETURNING id`,
      [parseInt(id), userId]
    );

    if (!rows.length) {
      return res.status(404).json({
        success: false,
        message: "Notification not found or access denied",
      });
    }

    res.json({ success: true, message: "Notification deleted successfully" });
  } catch (error) {
    console.error("Error deleting notification:", error);
    res.status(500).json({ success: false, message: "Failed to delete notification" });
  }
};

export default {
  getNotifications,
  markAsRead,
  markAllAsRead,
  getCount,
  createTestNotification,
  cleanupNotifications,
  deleteNotification,
};