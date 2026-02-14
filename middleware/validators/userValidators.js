import { body } from "express-validator";

/** POST /users/register */
export const registerValidator = [
  body("email")
    .isEmail()
    .withMessage("Invalid email format")
    .normalizeEmail(),
  body("password")
    .isLength({ min: 8 })
    .withMessage("Password must be at least 8 characters"),
  body("role_id")
    .custom((val) => {
      const n = Number(val);
      return !Number.isNaN(n) && Number.isInteger(n) && [2, 3, 5].includes(n);
    })
    .withMessage("role_id must be 2 (Customer), 3 (Freelancer), or 5 (Partner)")
    .toInt(),
  body("first_name").trim().notEmpty().withMessage("First name is required"),
  body("last_name").trim().notEmpty().withMessage("Last name is required"),
  body("username").trim().notEmpty().withMessage("Username is required"),
  body("phone_number").notEmpty().withMessage("Phone number is required"),
  body("country").notEmpty().withMessage("Country is required"),
];

/** POST /users/login */
export const loginValidator = [
  body("email")
    .isEmail()
    .withMessage("Invalid email format")
    .normalizeEmail(),
  body("password")
    .notEmpty()
    .withMessage("Password is required"),
];

/** POST /users/verify-email */
export const verifyEmailValidator = [
  body("email").isEmail().withMessage("Invalid email format").normalizeEmail(),
  body("otp").notEmpty().withMessage("OTP is required"),
];

/** POST /users/verify-otp */
export const verifyOtpValidator = [
  body("email").isEmail().withMessage("Invalid email format").normalizeEmail(),
  body("otp").notEmpty().withMessage("OTP is required"),
];

/** POST /users/verify-password (authenticated) */
export const verifyPasswordValidator = [
  body("password").notEmpty().withMessage("Password is required"),
];

/** PUT /users/update-password (authenticated) */
export const updatePasswordValidator = [
  body("currentPassword").notEmpty().withMessage("Current password is required"),
  body("newPassword")
    .isLength({ min: 8 })
    .withMessage("New password must be at least 8 characters"),
];

/** PUT /users/deactivate (authenticated) */
export const deactivateValidator = [
  body("reason").optional().trim(),
];

/** POST /users/rate (authenticated) */
export const rateFreelancerValidator = [
  body("userId").notEmpty().withMessage("userId is required"),
  body("rating")
    .isFloat({ min: 0, max: 5 })
    .withMessage("Rating must be between 0 and 5")
    .toFloat(),
  body("projectId").optional(),
];

/** POST /users/forgot-password */
export const forgotPasswordValidator = [
  body("email")
    .isEmail()
    .withMessage("Invalid email format")
    .normalizeEmail(),
];

/** POST /users/reset-password */
export const resetPasswordValidator = [
  body("token").notEmpty().trim().withMessage("Reset token is required"),
  body("password")
    .isLength({ min: 8 })
    .withMessage("Password must be at least 8 characters"),
  body("confirmPassword")
    .notEmpty()
    .withMessage("Confirm password is required")
    .custom((value, { req }) => value === req.body.password)
    .withMessage("Passwords do not match"),
];
