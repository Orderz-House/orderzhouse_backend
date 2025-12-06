import express from "express";
import {
  getPendingVerifications,
  approveVerification,
  rejectVerification,
} from "../controller/verification.js";
import adminOnly from "../middleware/adminOnly.js";
import { authentication } from "../middleware/authentication.js";

const VerificationRouter = express.Router();

VerificationRouter.get(
  "/verifications",
  authentication,
  adminOnly,
  getPendingVerifications
);

VerificationRouter.put(
  "/verifications/:id/approve",
  authentication,
  adminOnly,
  approveVerification
);

VerificationRouter.put(
  "/verifications/:id/reject",
  authentication,
  adminOnly,
  rejectVerification
);

export default VerificationRouter;
