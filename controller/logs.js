import pool from "../models/db.js";

import {
  getLogs,
  getEntityLogs,
  getUserLogs,
  getErrorLogs,
  getCriticalLogs,
  getLogStatistics,
  cleanupOldLogs
} from "../services/loggingService.js";

import { LogCreators, ACTION_TYPES, ENTITY_TYPES } from "../services/loggingService.js";

/**
 * @route 
 * @access 
 */
export const getMessageLogs = async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM message_logs ORDER BY logged_at DESC');
    
    res.status(200).json({
      success: true,
      message: "Message Logs Successfully",
      logs: rows
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: "Server Error",
      error: err
    });
  }
};

/**
 * Get system logs with filtering and pagination
 * @route GET /logs
 * @access Private (view_logs permission)
 */
export const getSystemLogs = async (req, res) => {
  try {
    const { 
      limit = 100, 
      offset = 0, 
      userId, 
      actionType, 
      entityType, 
      entityId, 
      level, 
      status,
      startDate,
      endDate
    } = req.query;

    const parsedLimit = Math.min(parseInt(limit) || 100, 500); 
    const parsedOffset = Math.max(parseInt(offset) || 0, 0);

    const filters = {};
    if (userId) filters.userId = parseInt(userId);
    if (actionType) filters.actionType = actionType;
    if (entityType) filters.entityType = entityType;
    if (entityId) filters.entityId = parseInt(entityId);
    if (level) filters.level = level;
    if (status) filters.status = status;
    if (startDate) filters.startDate = startDate;
    if (endDate) filters.endDate = endDate;

    const logs = await getLogs(filters, parsedLimit, parsedOffset);

    res.json({
      success: true,
      logs,
      pagination: {
        limit: parsedLimit,
        offset: parsedOffset,
        count: logs.length
      }
    });

  } catch (error) {
    console.error('Error getting system logs:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get system logs',
      error: error.message
    });
  }
};

/**
 * Get logs for a specific entity
 * @route GET /logs/entity/:entityType/:entityId
 * @access Private (view_logs permission)
 */
export const getEntityLogsRoute = async (req, res) => {
  try {
    const { entityType, entityId } = req.params;
    const { limit = 50 } = req.query;

    if (!Object.values(ENTITY_TYPES).includes(entityType)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid entity type'
      });
    }

    const parsedLimit = Math.min(parseInt(limit) || 50, 200);
    const logs = await getEntityLogs(entityType, parseInt(entityId), parsedLimit);

    res.json({
      success: true,
      logs,
      entityType,
      entityId: parseInt(entityId)
    });

  } catch (error) {
    console.error('Error getting entity logs:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get entity logs',
      error: error.message
    });
  }
};

/**
 * Get logs for a specific user
 * @route GET /logs/user/:userId
 * @access Private (view_logs permission)
 */
export const getUserLogsRoute = async (req, res) => {
  try {
    const { userId } = req.params;
    const { limit = 50 } = req.query;

    if (!userId || isNaN(parseInt(userId))) {
      return res.status(400).json({
        success: false,
        message: 'Invalid user ID'
      });
    }

    const parsedLimit = Math.min(parseInt(limit) || 50, 200);
    const logs = await getUserLogs(parseInt(userId), parsedLimit);

    res.json({
      success: true,
      logs,
      userId: parseInt(userId)
    });

  } catch (error) {
    console.error('Error getting user logs:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get user logs',
      error: error.message
    });
  }
};

/**
 * Get error logs
 * @route GET /logs/errors
 * @access Private (view_logs permission)
 */
export const getErrorLogsRoute = async (req, res) => {
  try {
    const { limit = 100 } = req.query;
    const parsedLimit = Math.min(parseInt(limit) || 100, 500);
    
    const logs = await getErrorLogs(parsedLimit);

    res.json({
      success: true,
      logs,
      count: logs.length
    });

  } catch (error) {
    console.error('Error getting error logs:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get error logs',
      error: error.message
    });
  }
};

/**
 * Get critical logs
 * @route GET /logs/critical
 * @access Private (view_logs permission)
 */
export const getCriticalLogsRoute = async (req, res) => {
  try {
    const { limit = 100 } = req.query;
    const parsedLimit = Math.min(parseInt(limit) || 100, 500);
    
    const logs = await getCriticalLogs(parsedLimit);

    res.json({
      success: true,
      logs,
      count: logs.length
    });

  } catch (error) {
    console.error('Error getting critical logs:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get critical logs',
      error: error.message
    });
  }
};

/**
 * Get log statistics
 * @route GET /logs/statistics
 * @access Private (view_logs permission)
 */
export const getLogStatisticsRoute = async (req, res) => {
  try {
    const { userId, startDate, endDate } = req.query;

    const filters = {};
    if (userId) filters.userId = parseInt(userId);
    if (startDate) filters.startDate = startDate;
    if (endDate) filters.endDate = endDate;

    const statistics = await getLogStatistics(filters);

    res.json({
      success: true,
      statistics
    });

  } catch (error) {
    console.error('Error getting log statistics:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get log statistics',
      error: error.message
    });
  }
};

/**
 * Clean up old logs (admin only)
 * @route DELETE /logs/cleanup
 * @access Private (Admin)
 */
export const cleanupLogs = async (req, res) => {
  try {
    const { daysOld = 365 } = req.query;
    const userId = req.token?.userId;

    // Check if user is admin (role_id = 1)
    const { rows: userRows } = await pool.query(
      `SELECT role_id FROM users WHERE id = $1 AND is_deleted = false`,
      [userId]
    );

    if (!userRows.length || userRows[0].role_id !== 1) {
      return res.status(403).json({
        success: false,
        message: 'Admin access required'
      });
    }

    const parsedDaysOld = Math.max(parseInt(daysOld) || 365, 90); // Minimum 90 days
    const deletedCount = await cleanupOldLogs(parsedDaysOld);

    // Log the action
    await LogCreators.projectOperation(
      userId,
      ACTION_TYPES.SYSTEM_MAINTENANCE,
      null,
      true,
      { action: 'cleanup_logs', daysOld: parsedDaysOld, deletedCount }
    );

    res.json({
      success: true,
      message: `Cleaned up ${deletedCount} old logs`,
      deletedCount,
      daysOld: parsedDaysOld
    });

  } catch (error) {
    console.error('Error cleaning up logs:', error);
    
    // Log the error
    await LogCreators.projectOperation(
      req.token?.userId,
      ACTION_TYPES.SYSTEM_MAINTENANCE,
      null,
      false,
      { action: 'cleanup_logs', error: error.message }
    );

    res.status(500).json({
      success: false,
      message: 'Failed to cleanup logs'
    });
  }
};

/**
 * Export logs to CSV (admin only)
 * @route GET /logs/export
 * @access Private (Admin)
 */
export const exportLogs = async (req, res) => {
  try {
    const userId = req.token?.userId;
    const { 
      startDate, 
      endDate, 
      entityType, 
      actionType,
      level 
    } = req.query;

    // Check if user is admin (role_id = 1)
    const { rows: userRows } = await pool.query(
      `SELECT role_id FROM users WHERE id = $1 AND is_deleted = false`,
      [userId]
    );

    if (!userRows.length || userRows[0].role_id !== 1) {
      return res.status(403).json({
        success: false,
        message: 'Admin access required'
      });
    }

    // Build query with filters
    let query = `
      SELECT 
        l.id,
        l.user_id,
        u.first_name,
        u.last_name,
        u.email,
        l.action_type,
        l.entity_type,
        l.entity_id,
        l.message,
        l.level,
        l.metadata,
        l.status,
        l.created_at
      FROM logs l
      LEFT JOIN users u ON l.user_id = u.id
      WHERE 1=1
    `;
    
    const params = [];
    let paramIndex = 1;
    
    if (startDate) {
      query += ` AND l.created_at >= $${paramIndex}`;
      params.push(startDate);
      paramIndex++;
    }
    
    if (endDate) {
      query += ` AND l.created_at <= $${paramIndex}`;
      params.push(endDate);
      paramIndex++;
    }
    
    if (entityType) {
      query += ` AND l.entity_type = $${paramIndex}`;
      params.push(entityType);
      paramIndex++;
    }
    
    if (actionType) {
      query += ` AND l.action_type = $${paramIndex}`;
      params.push(actionType);
      paramIndex++;
    }
    
    if (level) {
      query += ` AND l.level = $${paramIndex}`;
      params.push(level);
      paramIndex++;
    }
    
    query += ` ORDER BY l.created_at DESC LIMIT 10000`; // Max 10k records for export

    const { rows } = await pool.query(query, params);

    // Log the export action
    await LogCreators.projectOperation(
      userId,
      ACTION_TYPES.SYSTEM_MAINTENANCE,
      null,
      true,
      { action: 'export_logs', recordCount: rows.length }
    );

    // Set headers for CSV download
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=logs_${new Date().toISOString().split('T')[0]}.csv`);

    // Convert to CSV
    const csvHeaders = [
      'ID', 'User ID', 'First Name', 'Last Name', 'Email', 'Action Type', 
      'Entity Type', 'Entity ID', 'Message', 'Level', 'Metadata', 'Status', 'Created At'
    ];

    const csvContent = [
      csvHeaders.join(','),
      ...rows.map(row => [
        row.id,
        row.user_id || '',
        `"${(row.first_name || '').replace(/"/g, '""')}"`,
        `"${(row.last_name || '').replace(/"/g, '""')}"`,
        `"${(row.email || '').replace(/"/g, '""')}"`,
        `"${(row.action_type || '').replace(/"/g, '""')}"`,
        `"${(row.entity_type || '').replace(/"/g, '""')}"`,
        row.entity_id || '',
        `"${(row.message || '').replace(/"/g, '""')}"`,
        `"${(row.level || '').replace(/"/g, '""')}"`,
        `"${(row.metadata || '').replace(/"/g, '""')}"`,
        `"${(row.status || '').replace(/"/g, '""')}"`,
        row.created_at || ''
      ].join(','))
    ].join('\n');

    res.send(csvContent);

  } catch (error) {
    console.error('Error exporting logs:', error);
    
    // Log the error
    await LogCreators.projectOperation(
      req.token?.userId,
      ACTION_TYPES.SYSTEM_MAINTENANCE,
      null,
      false,
      { action: 'export_logs', error: error.message }
    );

    res.status(500).json({
      success: false,
      message: 'Failed to export logs',
      error: error.message
    });
  }
};

export default {
  getMessageLogs,
  getSystemLogs,
  getEntityLogsRoute,
  getUserLogsRoute,
  getErrorLogsRoute,
  getCriticalLogsRoute,
  getLogStatisticsRoute,
  cleanupLogs,
  exportLogs
};