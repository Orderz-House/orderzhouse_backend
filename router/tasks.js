// routes/tasks.js
import express from "express";
import {
  getAllTasksForAdmin,
  approveTaskByAdmin,
  confirmPaymentByAdmin,
  createTask,
  updateTask,
  deleteTask,
  updateTaskRequestStatus,
  submitWorkCompletion,
  resubmitWorkCompletion,
  updateTaskKanbanStatus,
  requestTask,
  submitPaymentProof,
  approveWorkCompletion,
  createReview,
  getTaskPool,
  getTaskById,
  getCategories,
  addTaskFiles,
  getFreelancerCreatedTasks,
  getTaskRequests,
  getAssignedTasks,
} from "../controller/tasks.js";
import authentication from "../middleware/authentication.js";
import { upload, uploadErrorHandler } from "../middleware/uploadMiddleware.js";

const router = express.Router();

/* ============================== ADMIN ============================== */
router.get("/admin", authentication, getAllTasksForAdmin);
router.put("/admin/:id/status", authentication, approveTaskByAdmin);
router.put("/admin/payment/:id/confirm", authentication, confirmPaymentByAdmin);

/* ============================== FREELANCER ============================== */
router.post("/freelancer", authentication, upload.array("files"), createTask);
router.put("/freelancer/:id", authentication, updateTask);
router.delete("/freelancer/:id", authentication, deleteTask);
router.put("/freelancer/requests/:id/status", authentication, updateTaskRequestStatus);
router.post("/freelancer/requests/:id/submit", authentication, upload.array("files"), submitWorkCompletion);
router.post("/freelancer/requests/:id/resubmit", authentication, upload.array("files"), resubmitWorkCompletion);
router.put("/freelancer/:id/kanban", authentication, updateTaskKanbanStatus);
router.get("/freelancer/my-tasks", authentication, getFreelancerCreatedTasks);
router.get("/freelancer/requests/:taskId", authentication, getTaskRequests);
router.get("/freelancer/assigned", authentication, getAssignedTasks);

/* ============================== CLIENT ============================== */
router.post("/client/request/:id", authentication, upload.array("files"), requestTask);
router.post("/client/payment/:id", authentication, upload.single("file"), submitPaymentProof);
router.post("/client/approve/:id", authentication, upload.array("files"), approveWorkCompletion);
router.post("/client/review/:id", authentication, createReview);

/* ============================== PUBLIC & SHARED ============================== */
router.get("/pool", getTaskPool);
router.get("/categories", getCategories);
router.get("/:id", getTaskById);
router.post("/files/:id", authentication, upload.array("files"), addTaskFiles);

router.use(uploadErrorHandler);

export default router;