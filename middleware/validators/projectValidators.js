import { body } from "express-validator";

/** POST /projects - create project (run after multer so req.body is available) */
export const createProjectValidator = [
  body("title")
    .trim()
    .notEmpty()
    .withMessage("Title is required")
    .isLength({ min: 10, max: 100 })
    .withMessage("Title must be between 10 and 100 characters"),
  body("description")
    .trim()
    .notEmpty()
    .withMessage("Description is required")
    .isLength({ min: 100, max: 2000 })
    .withMessage("Description must be between 100 and 2000 characters"),
  body("category_id")
    .notEmpty()
    .withMessage("Category is required"),
  body("sub_sub_category_id")
    .notEmpty()
    .withMessage("Sub-sub-category is required"),
  body("duration_type")
    .notEmpty()
    .withMessage("Duration type is required")
    .isIn(["days", "hours"])
    .withMessage("duration_type must be 'days' or 'hours'"),
  body("project_type")
    .notEmpty()
    .withMessage("Project type is required")
    .isIn(["fixed", "hourly", "bidding"])
    .withMessage("project_type must be 'fixed', 'hourly', or 'bidding'"),
  body("budget")
    .optional()
    .isFloat({ min: 0.01 })
    .withMessage("Budget must be a positive number")
    .toFloat(),
  body("hourly_rate")
    .optional()
    .isFloat({ min: 0.01 })
    .withMessage("Hourly rate must be a positive number")
    .toFloat(),
  body("budget_min")
    .optional()
    .isFloat({ min: 0.01 })
    .withMessage("Budget min must be a positive number")
    .toFloat(),
  body("budget_max")
    .optional()
    .isFloat({ min: 0.01 })
    .withMessage("Budget max must be a positive number")
    .toFloat(),
  body("duration_days").optional().isInt({ min: 1 }).toInt(),
  body("duration_hours").optional().isInt({ min: 1 }).toInt(),
];
