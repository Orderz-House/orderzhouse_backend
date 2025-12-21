import express from "express";
import { authentication } from "../middleware/authentication.js";
import authorization from "../middleware/authorization.js";
import {
  getNotifications,
  markAsRead,
  markAllAsRead,
  getCount,
  createTestNotification,
  cleanupNotifications,
  deleteNotification,
} from "../controller/notifications.js";

const notificationsRouter = express.Router();

// Apply authentication to all routes
notificationsRouter.use(authentication);

// Get notifications for the authenticated user
notificationsRouter.get("/", getNotifications);

// Get notification count
notificationsRouter.get("/count", getCount);

// Mark all notifications as read
notificationsRouter.put("/read-all", markAllAsRead);

// 🧹 Clean up old notifications (admin only)
notificationsRouter.delete("/cleanup", authorization(["admin"]), cleanupNotifications);

// ✅ Test notification (admin only)
notificationsRouter.post("/test", authorization(["admin"]), createTestNotification);

// Mark a specific notification as read
notificationsRouter.put("/:id/read", markAsRead);

// Delete a specific notification
notificationsRouter.delete("/:id", deleteNotification);

export default notificationsRouter;