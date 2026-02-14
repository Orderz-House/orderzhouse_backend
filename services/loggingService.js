import pool from "../models/db.js";

/**
 * Logging Service - Handles all system logging
 * Tracks operations, errors, critical actions, and payments
 */

// Log levels enum
export const LOG_LEVELS = {
  INFO: 'info',
  WARNING: 'warning',
  ERROR: 'error',
  CRITICAL: 'critical',
  SUCCESS: 'success'
};

// Action types enum
export const ACTION_TYPES = {
  // User actions
  USER_LOGIN: 'user_login',
  USER_LOGOUT: 'user_logout',
  USER_REGISTER: 'user_register',
  USER_UPDATE: 'user_update',
  USER_DELETE: 'user_delete',
  USER_VERIFY: 'user_verify',
  PASSWORD_CHANGE: 'password_change',
  PASSWORD_RESET: 'password_reset',
  
  // Project actions
  PROJECT_CREATE: 'project_create',
  PROJECT_UPDATE: 'project_update',
  PROJECT_DELETE: 'project_delete',
  PROJECT_STATUS_CHANGE: 'project_status_change',
  
  // Offer actions
  OFFER_SUBMIT: 'offer_submit',
  OFFER_APPROVE: 'offer_approve',
  OFFER_REJECT: 'offer_reject',
  OFFER_UPDATE: 'offer_update',
  
  // Assignment actions
  ASSIGNMENT_CREATE: 'assignment_create',
  ASSIGNMENT_UPDATE: 'assignment_update',
  ASSIGNMENT_DELETE: 'assignment_delete',
  ASSIGNMENT_STATUS_CHANGE: 'assignment_status_change',
  
  // Payment actions
  PAYMENT_CREATE: 'payment_create',
  PAYMENT_RELEASE: 'payment_release',
  PAYMENT_FAIL: 'payment_fail',
  ESCROW_CREATE: 'escrow_create',
  ESCROW_RELEASE: 'escrow_release',
  
  // Wallet operations
  WALLET_CREDIT: 'wallet_credit',
  WALLET_DEBIT: 'wallet_debit',
  WALLET_TRANSFER: 'wallet_transfer',
  
  // System actions
  SYSTEM_ERROR: 'system_error',
  SYSTEM_WARNING: 'system_warning',
  SYSTEM_MAINTENANCE: 'system_maintenance',
  
  // Course actions
  COURSE_ENROLL: 'course_enroll',
  COURSE_COMPLETE: 'course_complete',
  
  // Appointment actions
  APPOINTMENT_SCHEDULE: 'appointment_schedule',
  APPOINTMENT_CANCEL: 'appointment_cancel',
  APPOINTMENT_UPDATE: 'appointment_update',
  
  // Review actions
  REVIEW_SUBMIT: 'review_submit',
  REVIEW_UPDATE: 'review_update',
  REVIEW_DELETE: 'review_delete'
};

// Entity types enum
export const ENTITY_TYPES = {
  USER: 'user',
  PROJECT: 'project',
  OFFER: 'offer',
  ASSIGNMENT: 'assignment',
  PAYMENT: 'payment',
  ESCROW: 'escrow',
  WALLET: 'wallet',
  COURSE: 'course',
  APPOINTMENT: 'appointment',
  REVIEW: 'review',
  SYSTEM: 'system'
};

/**
 * Create a log entry
 * @param {number} userId - User ID who performed the action (null for system actions)
 * @param {string} actionType - Action type from ACTION_TYPES
 * @param {string} entityType - Entity type from ENTITY_TYPES
 * @param {number} entityId - Related entity ID
 * @param {string} message - Log message
 * @param {string} level - Log level from LOG_LEVELS
 * @param {Object} metadata - Additional metadata (optional)
 * @param {string} status - Action status (success/fail)
 * @returns {Promise<Object>} Created log entry
 */
export const createLog = async (userId, actionType, entityType, entityId, message, level = LOG_LEVELS.INFO, metadata = null, status = 'success') => {
  try {
    const query = `
      INSERT INTO logs (user_id, action_type, entity_type, entity_id, message, level, metadata, status, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)
      RETURNING *
    `;
    
    const { rows } = await pool.query(query, [
      userId,
      actionType,
      entityType,
      entityId,
      message,
      level,
      metadata ? JSON.stringify(metadata) : null,
      status
    ]);
    
    return rows[0];
  } catch (error) {
    console.error('Error creating log entry:', error);
    // Don't throw here to avoid breaking the main flow
    return null;
  }
};

/**
 * Create an error log
 * @param {number} userId - User ID (optional)
 * @param {string} actionType - Action type
 * @param {string} entityType - Entity type
 * @param {number} entityId - Entity ID
 * @param {string} message - Error message
 * @param {Error} error - Error object
 * @param {Object} metadata - Additional metadata
 * @returns {Promise<Object>} Created log entry
 */
export const createErrorLog = async (userId, actionType, entityType, entityId, message, error, metadata = null) => {
  const errorDetails = {
    message: error.message,
    stack: error.stack,
    name: error.name,
    ...metadata
  };
  
  return await createLog(
    userId,
    actionType,
    entityType,
    entityId,
    message,
    LOG_LEVELS.ERROR,
    errorDetails,
    'fail'
  );
};

/**
 * Create a critical log (for important system events)
 * @param {number} userId - User ID (optional)
 * @param {string} actionType - Action type
 * @param {string} entityType - Entity type
 * @param {number} entityId - Entity ID
 * @param {string} message - Critical message
 * @param {Object} metadata - Additional metadata
 * @returns {Promise<Object>} Created log entry
 */
export const createCriticalLog = async (userId, actionType, entityType, entityId, message, metadata = null) => {
  return await createLog(
    userId,
    actionType,
    entityType,
    entityId,
    message,
    LOG_LEVELS.CRITICAL,
    metadata,
    'success'
  );
};

/**
 * Get logs with filtering and pagination
 * @param {Object} filters - Filter options
 * @param {number} limit - Number of logs to return
 * @param {number} offset - Offset for pagination
 * @returns {Promise<Array>} Array of log entries
 */
export const getLogs = async (filters = {}, limit = 100, offset = 0) => {
  try {
    let query = `
      SELECT l.*, u.first_name, u.last_name, u.email
      FROM logs l
      LEFT JOIN users u ON l.user_id = u.id
      WHERE 1=1
    `;
    
    const params = [];
    let paramIndex = 1;
    
    // Apply filters
    if (filters.userId) {
      query += ` AND l.user_id = $${paramIndex}`;
      params.push(filters.userId);
      paramIndex++;
    }
    
    if (filters.actionType) {
      query += ` AND l.action_type = $${paramIndex}`;
      params.push(filters.actionType);
      paramIndex++;
    }
    
    if (filters.entityType) {
      query += ` AND l.entity_type = $${paramIndex}`;
      params.push(filters.entityType);
      paramIndex++;
    }
    
    if (filters.entityId) {
      query += ` AND l.entity_id = $${paramIndex}`;
      params.push(filters.entityId);
      paramIndex++;
    }
    
    if (filters.level) {
      query += ` AND l.level = $${paramIndex}`;
      params.push(filters.level);
      paramIndex++;
    }
    
    if (filters.status) {
      query += ` AND l.status = $${paramIndex}`;
      params.push(filters.status);
      paramIndex++;
    }
    
    if (filters.startDate) {
      query += ` AND l.created_at >= $${paramIndex}`;
      params.push(filters.startDate);
      paramIndex++;
    }
    
    if (filters.endDate) {
      query += ` AND l.created_at <= $${paramIndex}`;
      params.push(filters.endDate);
      paramIndex++;
    }
    
    query += ` ORDER BY l.created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limit, offset);
    
    const { rows } = await pool.query(query, params);
    return rows;
  } catch (error) {
    console.error('Error getting logs:', error);
    throw error;
  }
};

/**
 * Get logs for a specific entity
 * @param {string} entityType - Entity type
 * @param {number} entityId - Entity ID
 * @param {number} limit - Number of logs to return
 * @returns {Promise<Array>} Array of log entries
 */
export const getEntityLogs = async (entityType, entityId, limit = 50) => {
  return await getLogs({ entityType, entityId }, limit, 0);
};

/**
 * Get logs for a specific user
 * @param {number} userId - User ID
 * @param {number} limit - Number of logs to return
 * @returns {Promise<Array>} Array of log entries
 */
export const getUserLogs = async (userId, limit = 50) => {
  return await getLogs({ userId }, limit, 0);
};

/**
 * Get error logs
 * @param {number} limit - Number of logs to return
 * @returns {Promise<Array>} Array of error log entries
 */
export const getErrorLogs = async (limit = 100) => {
  return await getLogs({ level: LOG_LEVELS.ERROR }, limit, 0);
};

/**
 * Get critical logs
 * @param {number} limit - Number of logs to return
 * @returns {Promise<Array>} Array of critical log entries
 */
export const getCriticalLogs = async (limit = 100) => {
  return await getLogs({ level: LOG_LEVELS.CRITICAL }, limit, 0);
};

/**
 * Get log statistics
 * @param {Object} filters - Filter options
 * @returns {Promise<Object>} Log statistics
 */
export const getLogStatistics = async (filters = {}) => {
  try {
    let query = `
      SELECT 
        COUNT(*) as total_logs,
        COUNT(CASE WHEN level = 'error' THEN 1 END) as error_count,
        COUNT(CASE WHEN level = 'critical' THEN 1 END) as critical_count,
        COUNT(CASE WHEN status = 'fail' THEN 1 END) as fail_count,
        COUNT(CASE WHEN status = 'success' THEN 1 END) as success_count
      FROM logs
      WHERE 1=1
    `;
    
    const params = [];
    let paramIndex = 1;
    
    // Apply filters
    if (filters.userId) {
      query += ` AND user_id = $${paramIndex}`;
      params.push(filters.userId);
      paramIndex++;
    }
    
    if (filters.startDate) {
      query += ` AND created_at >= $${paramIndex}`;
      params.push(filters.startDate);
      paramIndex++;
    }
    
    if (filters.endDate) {
      query += ` AND created_at <= $${paramIndex}`;
      params.push(filters.endDate);
      paramIndex++;
    }
    
    const { rows } = await pool.query(query, params);
    return rows[0];
  } catch (error) {
    console.error('Error getting log statistics:', error);
    throw error;
  }
};

/**
 * Clean up old logs (maintenance utility)
 * @param {number} daysOld - Delete logs older than this many days
 * @returns {Promise<number>} Number of logs deleted
 */
export const cleanupOldLogs = async (daysOld = 365) => {
  try {
    const query = `
      DELETE FROM logs 
      WHERE created_at < CURRENT_TIMESTAMP - INTERVAL '${daysOld} days'
      AND level NOT IN ('critical', 'error')
    `;
    
    const { rowCount } = await pool.query(query);
    return rowCount;
  } catch (error) {
    console.error('Error cleaning up old logs:', error);
    throw error;
  }
};

// Specific log creators for common scenarios
export const LogCreators = {
  /**
   * Log user authentication
   */
  userAuth: async (userId, action, success, metadata = null) => {
    const level = success ? LOG_LEVELS.SUCCESS : LOG_LEVELS.ERROR;
    const status = success ? 'success' : 'fail';
    
    return await createLog(
      userId,
      action,
      ENTITY_TYPES.USER,
      userId,
      `User ${action} ${success ? 'successful' : 'failed'}`,
      level,
      metadata,
      status
    );
  },

  /**
   * Log project operations
   */
  projectOperation: async (userId, action, projectId, success, metadata = null) => {
    const level = success ? LOG_LEVELS.SUCCESS : LOG_LEVELS.ERROR;
    const status = success ? 'success' : 'fail';
    
    return await createLog(
      userId,
      action,
      ENTITY_TYPES.PROJECT,
      projectId,
      `Project ${action} ${success ? 'successful' : 'failed'}`,
      level,
      metadata,
      status
    );
  },

  /**
   * Log payment operations
   */
  paymentOperation: async (userId, action, paymentId, amount, success, metadata = null) => {
    const level = success ? LOG_LEVELS.SUCCESS : LOG_LEVELS.CRITICAL;
    const status = success ? 'success' : 'fail';
    
    const message = `Payment ${action} ${success ? 'successful' : 'failed'} - Amount: $${amount}`;
    
    return await createLog(
      userId,
      action,
      ENTITY_TYPES.PAYMENT,
      paymentId,
      message,
      level,
      metadata,
      status
    );
  },

  /**
   * Log wallet operations
   */
  walletOperation: async (userId, action, amount, balance, success, metadata = null) => {
    const level = success ? LOG_LEVELS.SUCCESS : LOG_LEVELS.CRITICAL;
    const status = success ? 'success' : 'fail';
    
    const message = `Wallet ${action} ${success ? 'successful' : 'failed'} - Amount: $${amount}, Balance: $${balance}`;
    
    return await createLog(
      userId,
      action,
      ENTITY_TYPES.WALLET,
      userId,
      message,
      level,
      metadata,
      status
    );
  },

  /**
   * Log system errors
   */
  systemError: async (action, entityType, entityId, error, metadata = null) => {
    return await createErrorLog(
      null, // No user ID for system errors
      action,
      entityType,
      entityId,
      `System error: ${error.message}`,
      error,
      metadata
    );
  }
};

export default {
  createLog,
  createErrorLog,
  createCriticalLog,
  getLogs,
  getEntityLogs,
  getUserLogs,
  getErrorLogs,
  getCriticalLogs,
  getLogStatistics,
  cleanupOldLogs,
  LOG_LEVELS,
  ACTION_TYPES,
  ENTITY_TYPES,
  LogCreators
};