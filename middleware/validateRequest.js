import { validationResult } from "express-validator";

/**
 * Middleware: run after express-validator chains.
 * If validation failed, responds with 400 and consistent JSON shape.
 */
export default function validateRequest(req, res, next) {
  const result = validationResult(req);
  if (!result.isEmpty()) {
    const mappedErrors = result.mapped();
    return res.status(400).json({
      message: "Validation error",
      errors: mappedErrors,
    });
  }
  next();
}
