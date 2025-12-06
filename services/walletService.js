// import pool from "../models/db.js";

// /**
//  * Wallet Service - Handles all wallet operations safely
//  * Includes validation, error handling, and logging
//  */

// /**
//  * Get user's current wallet balance
//  * @param {number} userId - User ID
//  * @returns {Promise<number>} Current balance
//  */

// /**
//  * Validate wallet operation parameters
//  * @param {number} userId - User ID
//  * @param {number} amount - Amount to operate on
//  * @param {string} operation - Operation type (credit/debit/transfer)
//  * @returns {Promise<Object>} Validation result
//  */
// export const validateWalletOperation = async (userId, amount, operation) => {
//   try {
//     // Validate amount
//     if (!amount || isNaN(amount) || amount <= 0) {
//       return {
//         valid: false,
//         error: 'Invalid amount. Must be a positive number.'
//       };
//     }

//     // Validate user exists
//     const { rows: userRows } = await pool.query(
//       `SELECT id, wallet FROM users WHERE id = $1 AND is_deleted = false`,
//       [userId]
//     );
    
//     if (userRows.length === 0) {
//       return {
//         valid: false,
//         error: 'User not found'
//       };
//     }

//     const currentBalance = parseFloat(userRows[0].wallet) || 0;

//     // For debit operations, check if user has sufficient balance
//     if (operation === 'debit' && currentBalance < amount) {
//       return {
//         valid: false,
//         error: `Insufficient balance. Current balance: $${currentBalance}, Required: $${amount}`
//       };
//     }

//     return {
//       valid: true,
//       currentBalance,
//       newBalance: operation === 'credit' ? currentBalance + amount : currentBalance - amount
//     };
//   } catch (error) {
//     console.error('Error validating wallet operation:', error);
//     return {
//       valid: false,
//       error: 'Validation error occurred'
//     };
//   }
// };

// /**
//  * Credit money to user's wallet
//  * @param {number} userId - User ID
//  * @param {number} amount - Amount to credit
//  * @param {string} note - Description of the transaction
//  */
// export const creditWallet = async (userId, amount, note) => {
//   if (!userId || !amount || amount <= 0) {
//     throw new Error("Invalid parameters for creditWallet");
//   }

//   await pool.query(
//     `UPDATE users SET wallet = COALESCE(wallet, 0) + $1 WHERE id = $2`,
//     [amount, userId]
//   );

//   await pool.query(
//     `INSERT INTO wallet_transactions (user_id, amount, type, note, created_at)
//      VALUES ($1, $2, 'credit', $3, NOW())`,
//     [userId, amount, note]
//   );
// };

// /**
//  * Deduct funds from a user's wallet
//  * @param {number} userId - The user ID
//  * @param {number} amount - Amount to debit
//  * @param {string} note - Description of the transaction
//  */
// export const debitWallet = async (userId, amount, note) => {
//   if (!userId || !amount || amount <= 0) {
//     throw new Error("Invalid parameters for debitWallet");
//   }
// };

// /**
//  * Transfer money between two users
//  * @param {number} fromUserId - Source user ID
//  * @param {number} toUserId - Destination user ID
//  * @param {number} amount - Amount to transfer
//  * @param {string} reason - Reason for transfer
//  * @param {Object} metadata - Additional metadata
//  * @returns {Promise<Object>} Operation result
//  */
// export const transferWallet = async (fromUserId, toUserId, amount, reason = 'Transfer', metadata = null) => {
//   const client = await pool.connect();
  
//   try {
//     await client.query('BEGIN');

//     // Validate both users exist
//     const { rows: users } = await client.query(
//       `SELECT id, wallet FROM users WHERE id IN ($1, $2) AND is_deleted = false ORDER BY id`,
//       [fromUserId, toUserId]
//     );
    
//     if (users.length !== 2) {
//       await client.query('ROLLBACK');
//       return {
//         success: false,
//         error: 'One or both users not found'
//       };
//     }

//     const fromUser = users.find(u => u.id === fromUserId);
//     const toUser = users.find(u => u.id === toUserId);
    
//     if (!fromUser || !toUser) {
//       await client.query('ROLLBACK');
//       return {
//         success: false,
//         error: 'User lookup failed'
//       };
//     }

//     const fromUserBalance = parseFloat(fromUser.wallet) || 0;
    
//     // Check if source user has sufficient balance
//     if (fromUserBalance < amount) {
//       await client.query('ROLLBACK');
//       return {
//         success: false,
//         error: `Insufficient balance. Current balance: $${fromUserBalance}, Required: $${amount}`
//       };
//     }

//     // Perform the transfer
//     await client.query(
//       `UPDATE users SET wallet = wallet - $1 WHERE id = $2`,
//       [amount, fromUserId]
//     );

//     await client.query(
//       `UPDATE users SET wallet = COALESCE(wallet, 0) + $1 WHERE id = $2`,
//       [amount, toUserId]
//     );

//     // Get updated balances
//     const { rows: updatedBalances } = await client.query(
//       `SELECT id, wallet FROM users WHERE id IN ($1, $2) ORDER BY id`,
//       [fromUserId, toUserId]
//     );

//     const fromUserNewBalance = parseFloat(updatedBalances.find(u => u.id === fromUserId).wallet);
//     const toUserNewBalance = parseFloat(updatedBalances.find(u => u.id === toUserId).wallet);

//     // Log both operations
//     await LogCreators.walletOperation(
//       fromUserId,
//       ACTION_TYPES.WALLET_TRANSFER,
//       amount,
//       fromUserNewBalance,
//       true,
//       { reason, toUserId, ...metadata }
//     );

//     await LogCreators.walletOperation(
//       toUserId,
//       ACTION_TYPES.WALLET_TRANSFER,
//       amount,
//       toUserNewBalance,
//       true,
//       { reason, fromUserId, ...metadata }
//     );

//     await client.query('COMMIT');

//     return {
//       success: true,
//       fromUser: {
//         id: fromUserId,
//         previousBalance: fromUserBalance,
//         newBalance: fromUserNewBalance
//       },
//       toUser: {
//         id: toUserId,
//         previousBalance: parseFloat(toUser.wallet) || 0,
//         newBalance: toUserNewBalance
//       },
//       amount,
//       reason
//     };

//   } catch (error) {
//     await client.query('ROLLBACK');
//     console.error('Error transferring wallet:', error);
    
//     // Log the error for both users
//     await LogCreators.walletOperation(
//       fromUserId,
//       ACTION_TYPES.WALLET_TRANSFER,
//       amount,
//       0,
//       false,
//       { reason, toUserId, error: error.message, ...metadata }
//     );

//     await LogCreators.walletOperation(
//       toUserId,
//       ACTION_TYPES.WALLET_TRANSFER,
//       amount,
//       0,
//       false,
//       { reason, fromUserId, error: error.message, ...metadata }
//     );

//     return {
//       success: false,
//       error: 'Failed to transfer wallet'
//     };
//   } finally {
//     client.release();
//   }
// };

// /**
//  * Get wallet balance for a user
//  * @param {number} userId - The user ID
//  * @returns {number} Wallet balance
//  */
// export const getWalletBalance = async (userId) => {
//   const { rows } = await pool.query(
//     `SELECT COALESCE(wallet, 0) AS wallet FROM users WHERE id = $1`,
//     [userId]
//   );
//   return rows.length ? parseFloat(rows[0].wallet) : 0;
// };

// /**
//  * Get wallet transaction history for a user
//  * @param {number} userId - The user ID
//  * @returns {Array} Transaction list
//  */
// export const validateEscrowCreation = async (clientId, amount) => {
//   try {
//     const balance = await getWalletBalance(clientId);
    
//     if (balance < amount) {
//       return {
//         valid: false,
//         error: `Insufficient balance for escrow. Current balance: $${balance}, Required: $${amount}`
//       };
//     }

//     return {
//       valid: true,
//       currentBalance: balance,
//       newBalance: balance - amount
//     };
//   } catch (error) {
//     console.error('Error validating escrow creation:', error);
//     return {
//       valid: false,
//       error: 'Validation error occurred'
//     };
//   }
// };

// export default {
//   getWalletBalance,
//   validateWalletOperation,
//   creditWallet,
//   debitWallet,
//   transferWallet,
//   getWalletHistory,
//   validateEscrowCreation
// };