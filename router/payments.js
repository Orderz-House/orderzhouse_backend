import express from "express";
import {
  // CLIENT
  getClientPayments,

  // FREELANCER
  getFreelancerWallet,
  getFreelancerWalletTransactions,

  // ADMIN
  adminGetAllPayments,
  createEscrow,
  releaseEscrow,
  refundEscrow,

  // UNIFIED
  getPaymentHistory,
} from "../controller/payments.js";

import authentication from "../middleware/authentication.js";
import adminOnly from "../middleware/adminOnly.js";

const PaymentsRouter = express.Router();

/* =====================================================
   UNIFIED (All roles)
===================================================== */

// Unified payment history (all transactions)
PaymentsRouter.get(
  "/history",
  authentication,
  getPaymentHistory
);

/* =====================================================
   CLIENT (role_id = 2)
===================================================== */

// Client payment history (projects + plans)
PaymentsRouter.get(
  "/client/history",
  authentication,
  getClientPayments
);

/* =====================================================
   FREELANCER (role_id = 3)
===================================================== */

// Freelancer wallet balance
PaymentsRouter.get(
  "/freelancer/wallet",
  authentication,
  getFreelancerWallet
);

// Freelancer wallet transactions
PaymentsRouter.get(
  "/freelancer/wallet/transactions",
  authentication,
  getFreelancerWalletTransactions
);

/* =====================================================
   ADMIN (role_id = 1)
===================================================== */

// All payments in system
PaymentsRouter.get(
  "/admin/payments",
  authentication,
  adminOnly,
  adminGetAllPayments
);

// Create escrow (after project assignment)
PaymentsRouter.post(
  "/admin/escrow",
  authentication,
  adminOnly,
  createEscrow
);

// Release escrow → pay freelancer
PaymentsRouter.post(
  "/admin/escrow/:escrow_id/release",
  authentication,
  adminOnly,
  releaseEscrow
);

// Refund escrow
PaymentsRouter.post(
  "/admin/escrow/:escrow_id/refund",
  authentication,
  adminOnly,
  refundEscrow
);

export default PaymentsRouter;
