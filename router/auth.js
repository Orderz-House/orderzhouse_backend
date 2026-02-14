// router/auth.js
import express from "express";
import { authentication } from "../middleware/authentication.js";
import {
  generateTwoFactorSecret,
  verifyTwoFactorToken,
  disableTwoFactor,
  verifyTwoFactorLogin,
  changePassword,
  acceptTerms,
  loginWithGoogle,
} from "../controller/auth.js";

const authRouter = express.Router();

// Public: Google Sign-In (no auth required)
authRouter.post("/google", loginWithGoogle);

// 👇 هذا الراوت مفتوح لأنه جزء من عملية تسجيل الدخول
authRouter.post("/2fa/verify-login", verifyTwoFactorLogin);

// 👇 من هون وطالع لازم يكون معك JWT عادي (داخل السيستم)
authRouter.use(authentication);

authRouter.post("/2fa/generate", generateTwoFactorSecret);
authRouter.post("/2fa/verify", verifyTwoFactorToken);
authRouter.post("/2fa/disable", disableTwoFactor);

// Accept Terms & Conditions (requires authentication, but must be before terms check)
authRouter.post("/accept-terms", acceptTerms);

// Change password (requires authentication)
authRouter.patch("/change-password", changePassword);

export default authRouter;
