import express from "express";
import { authentication } from "../middleware/authentication.js";
import requireVerifiedWithSubscription from "../middleware/requireVerifiedWithSubscription.js";
// import adminViewerOnly from "../middleware/adminViewerOnly.js";
import multer from "multer";

import {
  createProject,
  createAdminProject,
  uploadProjectMedia,
  getRelatedFreelancers,
  completeHourlyProject,
  approveWorkCompletion,  resubmitWorkCompletion,
  addProjectFiles,
  assignFreelancer,
  acceptAssignment,
  rejectAssignment,
  applyForProject,
  approveOrRejectApplication,
  getApplicationsForMyProjects,
  getProjectTimeline
} from "../controller/projectsManagment/projects.js";
// import handleJsonOrForm from "../middleware/handleJsonOrForm.js";

import {
  getProjectsByCategory,
  getProjectsBySubCategory,
  getProjectsBySubSubCategory,
  getProjectsByCategoryId,
  getProjectsBySubCategoryId,
  getProjectsBySubSubCategoryId,
  getProjectById,
  getProjectsByUserRole,
  getProjectFilesByProjectId
} from "../controller/projectsManagment/projectsFiltering.js";

import { submitWorkCompletion } from "../controller/payments.js";
import { getAllFreelancers, getAllProjectsForAdmin, reassignFreelancer } from "../controller/projectsManagment/projects.js";
const projectsRouter = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

projectsRouter.post("/", authentication, uploadProjectMedia, createProject);

 // Admin Viewer project creation with special categories
// projectsRouter.post("/admin", authentication, adminViewerOnly, handleJsonOrForm, createAdminProject);

// projectsRouter.get("/myprojects", authentication, getProjectsByUserRole);

// Allow client to delete their own project (soft delete)
projectsRouter.delete(
  "/myprojects/:projectId",
  authentication,
  async (req, res, next) => {
    // simple wrapper to delegate to controller implemented below
    try {
      // lazy import to avoid circular problems
      const { deleteProjectByOwner } = await import("../controller/projectsManagment/projects.js");
      return deleteProjectByOwner(req, res, next);
    } catch (err) {
      return next(err);
    }
  }
);


projectsRouter.get("/:projectId", authentication, getProjectById);

projectsRouter.put("/hourly/:projectId", authentication, completeHourlyProject);

projectsRouter.post("/:projectId/assign", authentication, assignFreelancer);

projectsRouter.get("/:projectId/files", authentication, getProjectFilesByProjectId);



projectsRouter.post(
  "/:projectId/submit",
  authentication,
  requireVerifiedWithSubscription,
  upload.array("files"),
  submitWorkCompletion
);

projectsRouter.post(
  "/:projectId/resubmit",
  authentication,
  requireVerifiedWithSubscription,
  upload.array("files"),
  resubmitWorkCompletion
);

projectsRouter.post(
  "/assignments/:assignmentId/accept",
  authentication,
  requireVerifiedWithSubscription,
  acceptAssignment
);

projectsRouter.post(
  "/assignments/:assignmentId/reject",
  authentication,
  requireVerifiedWithSubscription,
  rejectAssignment
);

projectsRouter.put(
  "/:projectId/approve",
  authentication,
  approveWorkCompletion
);

projectsRouter.get(
  "/categories/:categoryId/related-freelancers",
  authentication,
  getRelatedFreelancers
);

projectsRouter.post(
  "/:projectId/files",
  authentication,
  upload.array("files", 5),
  addProjectFiles
);

/* -------------------------------
   NEW ROUTES ADDED
-------------------------------- */

// Freelancer applies for active fixed/hourly project
projectsRouter.post(
  "/:projectId/apply",
  authentication,
  requireVerifiedWithSubscription,
  applyForProject
);

// Client approves or rejects freelancer application
projectsRouter.post(
  "/applications/decision",
  authentication,
  approveOrRejectApplication
);

// Client fetches all applications for their projects
projectsRouter.get(
  "/applications/my-projects",
  authentication,
  getApplicationsForMyProjects
);

// Get full project timeline
projectsRouter.get(
  "/:projectId/timeline",
  authentication,
  getProjectTimeline
);

// Get all freelancers for admin
projectsRouter.get(
  "/admin/freelancers",
  authentication,
  // adminViewerOnly,
  getAllFreelancers
);

// Get all projects for admin dashboard
projectsRouter.get(
  "/admin/projects",
  authentication,
  // adminViewerOnly,
  getAllProjectsForAdmin
);

// Reassign freelancer to admin project
projectsRouter.put(
  "/admin/projects/:projectId/reassign",
  authentication,
  // adminViewerOnly,
  reassignFreelancer
);

/* -------------------------------
   EXISTING CATEGORY FILTER ROUTES
-------------------------------- */
projectsRouter.get("/category/:category_id", authentication, getProjectsByCategory);
projectsRouter.get("/sub-category/:sub_category_id", authentication, getProjectsBySubCategory);
projectsRouter.get("/sub-sub-category/:sub_sub_category_id", authentication, getProjectsBySubSubCategory);

projectsRouter.get("/public/category/:categoryId", getProjectsByCategoryId);
projectsRouter.get("/public/subcategory/:subCategoryId", getProjectsBySubCategoryId);
projectsRouter.get("/public/subsubcategory/:subSubCategoryId", getProjectsBySubSubCategoryId);

export default projectsRouter;