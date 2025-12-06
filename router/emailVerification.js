import express from "express";
import { verifyEmailOtp } from "../controller/emailVerification.js";

const router = express.Router();

// Verify email OTP
router.post("/verify", verifyEmailOtp);

export default router;
