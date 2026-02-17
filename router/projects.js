import express from "express";

import { authentication } from "../middleware/authentication.js";
import requireVerifiedWithSubscription from "../middleware/requireVerifiedWithSubscription.js";
import { upload, uploadErrorHandler } from "../middleware/uploadMiddleware.js";

import {
  createProject,
  uploadProjectMedia,
  getSkillSuggestions,
  assignFreelancer,
  applyForProject,
  approveOrRejectApplication,
  acceptAssignment,
  rejectAssignment,
  getApplicationsForMyProjects,
  approveWorkCompletion,
  resubmitWorkCompletion,
  completeHourlyProject,
  addProjectFiles,
  deleteProjectByOwner,
  getProjectTimeline,
  // admin helpers
  getAllFreelancers,
  getAllProjectsForAdmin,
  reassignFreelancer,
  submitProjectDelivery,
  getProjectDeliveries,
  adminApproveProject,
  requestProjectChanges,
  getProjectChangeRequests,
  markProjectChangeRequestsAsRead,
  // offline payment
  createOfflinePayment,
  adminApproveOfflinePayment,
  adminRejectOfflinePayment,
  getPendingApprovalProjects,
  getProjectSuccess,
} from "../controller/projectsManagment/projects.js";

import {
  getProjectsByCategory,
  getProjectsBySubCategory,
  getProjectsBySubSubCategory,
  getProjectsByCategoryId,
  getProjectsBySubCategoryId,
  getProjectsBySubSubCategoryId,
  getProjectById,
  getProjectsByUserRole,
  getProjectFilesByProjectId,
  getPublicCategories,
} from "../controller/projectsManagment/projectsFiltering.js";

import {getAssignmentsForProject} from "../controller/projectsManagment/assignments.js";
import validateRequest from "../middleware/validateRequest.js";
import { createProjectValidator } from "../middleware/validators/projectValidators.js";

const projectsRouter = express.Router();

/* ======================================================================
   1) CREATE + MY PROJECTS
====================================================================== */

projectsRouter.post(
  "/",
  authentication,
  uploadProjectMedia,
  createProjectValidator,
  validateRequest,
  createProject
);

// مشروع عن طريق admin viewer (لو فعلته)
// projectsRouter.post(
//   "/admin",
//   authentication,
//   adminViewerOnly,
//   handleJsonOrForm,
//   createAdminProject
// );

projectsRouter.get("/myprojects", authentication, getProjectsByUserRole);

/* Skills suggestions for Preferred Skills (from previous projects, no auth) */
projectsRouter.get("/skills-suggestions", getSkillSuggestions);

/* --------------------------------
   DELETE (SOFT DELETE) PROJECT BY OWNER
--------------------------------- */


projectsRouter.delete(
  "/myprojects/:projectId",
  authentication,
  async (req, res, next) => {
    try {
      return deleteProjectByOwner(req, res, next);
    } catch (err) {
      return next(err);
    }
  }
);

/* ======================================================================
   2) ASSIGNMENT / APPLY
====================================================================== */

projectsRouter.post(
  "/:projectId/assign",
  authentication,
  assignFreelancer
);

projectsRouter.post(
  "/:projectId/apply",
  authentication,
  requireVerifiedWithSubscription,
  applyForProject
);

projectsRouter.post(
  "/applications/decision",
  authentication,
  approveOrRejectApplication
);

projectsRouter.get(
  "/applications/my-projects",
  authentication,
  getApplicationsForMyProjects
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


projectsRouter.post(
  "/:projectId/resubmit",
  authentication,
  requireVerifiedWithSubscription,
  upload.array("files"),
  resubmitWorkCompletion
);

projectsRouter.put(
  "/:projectId/approve",
  authentication,
  approveWorkCompletion
);

/* ======================================================================
   4) HOURLY PROJECT
====================================================================== */

projectsRouter.put(
  "/hourly/:projectId",
  authentication,
  completeHourlyProject
);

/* ======================================================================
   5) FILES (chat / attachments)
====================================================================== */

projectsRouter.post(
  "/:projectId/files",
  authentication,
  upload.array("attachments", 10),
  uploadErrorHandler,
  addProjectFiles
);

projectsRouter.get(
  "/:projectId/files",
  authentication,
  getProjectFilesByProjectId
);

/* ======================================================================
   6) TIMELINE + RELATED FREELANCERS + BASIC INFO
====================================================================== */

projectsRouter.get(
  "/:projectId/timeline",
  authentication,
  getProjectTimeline
);

// Admin: list all freelancers
projectsRouter.get(
  "/admin/freelancers",
  authentication,
  // adminViewerOnly,
  getAllFreelancers
);

// Admin: list all projects
projectsRouter.get(
  "/admin/projects",
  authentication,
  // adminViewerOnly,
  getAllProjectsForAdmin
);

// Admin: list pending approval projects
projectsRouter.get(
  "/admin/projects/pending",
  authentication,
  getPendingApprovalProjects
);

// Admin: reassign freelancer to admin project
projectsRouter.put(
  "/admin/projects/:projectId/reassign",
  authentication,
  // adminViewerOnly,
  reassignFreelancer
);

/* --------------------------------
   CATEGORY FILTER ROUTES (AUTH)
--------------------------------- */

projectsRouter.get(
  "/category/:category_id",
  authentication,
  getProjectsByCategory
);

projectsRouter.get(
  "/sub-category/:sub_category_id",
  authentication,
  getProjectsBySubCategory
);

projectsRouter.get(
  "/sub-sub-category/:sub_sub_category_id",
  authentication,
  getProjectsBySubSubCategory
);

/* ======================================================================
   8) PUBLIC FILTER ROUTES (NO AUTH)
====================================================================== */

projectsRouter.get(
  "/public/categories",
  getPublicCategories
);

projectsRouter.get(
  "/public/category/:categoryId",
  getProjectsByCategoryId
);

projectsRouter.get(
  "/public/subcategory/:subCategoryId",
  getProjectsBySubCategoryId
);

projectsRouter.get(
  "/public/subsubcategory/:subSubCategoryId",
  getProjectsBySubSubCategoryId
);

projectsRouter.get(
  "/project/:projectId/applications",
  authentication,
  getAssignmentsForProject
);


/* ======================================================================
   DELIVERY (freelancer submit) + RECEIVE (client view)
====================================================================== */

projectsRouter.post(
  "/:projectId/deliver",
  authentication,
  requireVerifiedWithSubscription,
  uploadProjectMedia,
  submitProjectDelivery
);
projectsRouter.get(
  "/:projectId/deliveries",
  authentication,
  getProjectDeliveries
);

projectsRouter.post(
  "/admin/projects/:projectId/decision",
  authentication,
  // adminViewerOnly,
  adminApproveProject
);

projectsRouter.get(
  "/:projectId/change-requests",
  authentication,
  getProjectChangeRequests
);

projectsRouter.put(
  "/:projectId/change-requests/mark-read",
  authentication,
  markProjectChangeRequestsAsRead
);

projectsRouter.post(
  "/:projectId/request-changes",
  authentication,
  requestProjectChanges
);

/* ======================================================================
   OFFLINE PAYMENT ENDPOINTS
====================================================================== */
projectsRouter.post(
  "/:projectId/offline-payment",
  authentication,
  createOfflinePayment
);

projectsRouter.post(
  "/admin/projects/:projectId/approve-offline-payment",
  authentication,
  adminApproveOfflinePayment
);

projectsRouter.post(
  "/admin/projects/:projectId/reject-offline-payment",
  authentication,
  adminRejectOfflinePayment
);

// Alternative endpoints for approve/reject (matching requirements)
projectsRouter.post(
  "/admin/projects/:id/approve",
  authentication,
  adminApproveOfflinePayment
);

projectsRouter.post(
  "/admin/projects/:id/reject",
  authentication,
  adminRejectOfflinePayment
);

// GET project for success page
projectsRouter.get("/success/:id", authentication, getProjectSuccess);

/* GET single project by ID (must be after all other /:projectId and literal routes) */
projectsRouter.get("/:projectId", authentication, getProjectById);

projectsRouter.use(uploadErrorHandler);

export default projectsRouter;
