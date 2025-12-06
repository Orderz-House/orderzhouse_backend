/**
 * Payments Router
 */
import express from "express";
import { authentication } from "../middleware/authentication.js";

import {
  recordOfflinePayment,
  approveOfflinePayment,
  releasePayment,
  autoReleasePaymentsCron,
} from "../controller/payments.js";
import { getMyFinancialOverview } from "../controller/financial/financialOverview.js";

const paymentsRouter = express.Router();

/**
 * -------------------------------
 * PROJECT PAYMENTS
 * -------------------------------
 */

// CLIENT: Record offline payment
paymentsRouter.post(
  "/offline/record/:projectId",
  authentication,
  recordOfflinePayment
);

// ADMIN: Approve/reject offline payment
paymentsRouter.post(
  "/offline/approve",
  authentication,
  approveOfflinePayment
);

// CLIENT: Release payment to freelancer
paymentsRouter.post(
  "/projects/:projectId/release-payment/:freelancerId",
  authentication,
  releasePayment
);

/**
 * -------------------------------
 * FINANCIAL OVERVIEW
 * -------------------------------
 */
paymentsRouter.get("/overview", authentication, getMyFinancialOverview);

export default paymentsRouter;
