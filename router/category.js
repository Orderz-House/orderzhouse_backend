import express from "express";
import { authentication } from "../middleware/authentication.js";
import adminOnly from "../middleware/adminOnly.js";
import {
  // ===== MAIN CATEGORIES =====
  getCategories,
  getCategoryById,
  createCategory,
  updateCategory,
  deleteCategory,

  // ===== SUB-CATEGORIES =====
  getSubCategories,
  createSubCategory,
  updateSubCategory,
  deleteSubCategory,

  // ===== SUB-SUB-CATEGORIES =====
  getSubSubCategoriesBySubId,
  createSubSubCategory,
  updateSubSubCategory,
  deleteSubSubCategory,

  //  NEWLY ADDED CONTROLLER
  getSubSubCategoriesByCategoryId,
} from "../controller/category.js";

const categoryRouter = express.Router();

/* =====================================================
   PUBLIC ROUTES
===================================================== */

categoryRouter.get("/", getCategories);
categoryRouter.get("/:categoryId/sub-categories", getSubCategories);
categoryRouter.get(
  "/sub-category/:subCategoryId/sub-sub-categories",
  getSubSubCategoriesBySubId
);

//  GET ALL SUB-SUB-CATEGORIES BY CATEGORY
categoryRouter.get(
  "/:categoryId/sub-sub-categories",
  getSubSubCategoriesByCategoryId
);

categoryRouter.get("/:id", getCategoryById);

/* =====================================================
   ADMIN-ONLY ROUTES (Protected)
===================================================== */

// --------------------
// MAIN CATEGORIES
// --------------------
categoryRouter.post("/", authentication, adminOnly, createCategory);
categoryRouter.put("/:id", authentication, adminOnly, updateCategory);
categoryRouter.delete("/:id", authentication, adminOnly, deleteCategory);

// --------------------
// SUB-CATEGORIES
// --------------------
categoryRouter.post(
  "/:categoryId/sub-categories",
  authentication,
  adminOnly,
  createSubCategory
);
categoryRouter.put(
  "/:categoryId/sub-categories/:id",
  authentication,
  adminOnly,
  updateSubCategory
);
categoryRouter.delete(
  "/:categoryId/sub-categories/:id",
  authentication,
  adminOnly,
  deleteSubCategory
);

// --------------------
// SUB-SUB-CATEGORIES
// --------------------
categoryRouter.post(
  "/sub-category/:subCategoryId/sub-sub-categories",
  authentication,
  adminOnly,
  createSubSubCategory
);
categoryRouter.put(
  "/sub-category/:subCategoryId/sub-sub-categories/:id",
  authentication,
  adminOnly,
  updateSubSubCategory
);
categoryRouter.delete(
  "/sub-category/:subCategoryId/sub-sub-categories/:id",
  authentication,
  adminOnly,
  deleteSubSubCategory
);

export default categoryRouter;
