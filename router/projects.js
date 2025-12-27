import express from "express";
import multer from "multer";

import { authentication } from "../middleware/authentication.js";
import requireVerifiedWithSubscription from "../middleware/requireVerifiedWithSubscription.js";

import {
  createProject,
  uploadProjectMedia,
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


const projectsRouter = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

/* ======================================================================
   1) CREATE + MY PROJECTS
====================================================================== */

projectsRouter.post(
  "/",
  authentication,
  uploadProjectMedia, 
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
  upload.array("files", 5),
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

projectsRouter.post(
  "/:projectId/request-changes",
  authentication,
  requestProjectChanges
);
export default projectsRouter;
