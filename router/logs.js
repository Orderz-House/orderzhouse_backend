import express from "express";
import { authentication } from "../middleware/authentication.js";
import authorization from "../middleware/authorization.js";
import {
  getMessageLogs,
  getSystemLogs,
  getEntityLogsRoute,
  getUserLogsRoute,
  getErrorLogsRoute,
  getCriticalLogsRoute,
  getLogStatisticsRoute,
  cleanupLogs,
  exportLogs
} from "../controller/logs.js";

const logsRouter = express.Router();

// Apply authentication middleware to all routes
logsRouter.use(authentication);

// Get message logs (existing functionality)
logsRouter.get("/messages", getMessageLogs);

// Get system logs with filtering and pagination
logsRouter.get("/", getSystemLogs);

// Get logs for a specific entity
logsRouter.get("/entity/:entityType/:entityId",  getEntityLogsRoute);

// Get logs for a specific user
logsRouter.get("/user/:userId", getUserLogsRoute);

// Get error logs
logsRouter.get("/errors", getErrorLogsRoute);

// Get critical logs
logsRouter.get("/critical", getCriticalLogsRoute);

// Get log statistics
logsRouter.get("/statistics", getLogStatisticsRoute);

// Export logs to CSV (admin only)
logsRouter.get("/export", exportLogs);

// Clean up old logs (admin only)
logsRouter.delete("/cleanup", cleanupLogs);

export default logsRouter;