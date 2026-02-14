import express from "express";
import {
  register,
  login,
  verifyOTP,
  refreshToken,
  logout,
  editUserSelf,
  rateFreelancer,
  verifyPassword,
  updatePassword,
  forgotPassword,
  resetPassword,
  deactivateAccount,
  verifyEmailOtp,
  resendEmailOtp,
  uploadProfilePic,
  sendOtpController,
  getUserdata,
  getDeactivatedUsers,
  requestSignupOtp,
  verifyAndRegister,
  completeProfile,
} from "../controller/user.js";

import authentication from "../middleware/authentication.js";
import validateRequest from "../middleware/validateRequest.js";
import { upload, uploadErrorHandler } from "../middleware/uploadMiddleware.js";
import {
  registerValidator,
  loginValidator,
  verifyEmailValidator,
  verifyOtpValidator,
  verifyPasswordValidator,
  updatePasswordValidator,
  forgotPasswordValidator,
  resetPasswordValidator,
  deactivateValidator,
  rateFreelancerValidator,
} from "../middleware/validators/userValidators.js";

const usersRouter = express.Router();

// =============== PUBLIC ROUTES ===============
usersRouter.post("/register", registerValidator, validateRequest, register);
usersRouter.post("/verify-email", verifyEmailValidator, validateRequest, verifyEmailOtp);
usersRouter.post("/resend-email-otp", resendEmailOtp);
usersRouter.post("/login", loginValidator, validateRequest, login);
usersRouter.post("/verify-otp", verifyOtpValidator, validateRequest, verifyOTP);
usersRouter.post("/send-otp", sendOtpController);
usersRouter.post("/request-signup-otp", requestSignupOtp);
usersRouter.post("/verify-and-register", verifyAndRegister);
usersRouter.post("/forgot-password", forgotPasswordValidator, validateRequest, forgotPassword);
usersRouter.post("/reset-password", resetPasswordValidator, validateRequest, resetPassword);
usersRouter.post("/refresh", refreshToken);
usersRouter.post("/logout", logout);


// =============== AUTHENTICATED ROUTES ===============
usersRouter.get("/getUserdata", authentication, getUserdata);
usersRouter.patch("/complete-profile", authentication, completeProfile);
usersRouter.post("/uploadProfilePic",authentication,upload.single("file"),uploadProfilePic);

// =============== USER PROFILE ===============
usersRouter.put("/edit", authentication, upload.array("files"), editUserSelf);

// =============== RATING ===============
usersRouter.post("/rate", authentication, rateFreelancerValidator, validateRequest, rateFreelancer);

// =============== PASSWORD & ACCOUNT ===============
usersRouter.post("/verify-password", authentication, verifyPasswordValidator, validateRequest, verifyPassword);
usersRouter.put("/update-password", authentication, updatePasswordValidator, validateRequest, updatePassword);
usersRouter.patch("/change-password", authentication, updatePasswordValidator, validateRequest, updatePassword);
usersRouter.put("/deactivate", authentication, deactivateValidator, validateRequest, deactivateAccount);
usersRouter.get("/deactivated-users", authentication, getDeactivatedUsers); //Administer route to get deactivated users

usersRouter.use(uploadErrorHandler);

export default usersRouter;
