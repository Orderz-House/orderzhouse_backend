import express from "express";
import {
  uploadFileToProject,
  downloadFileFromProject,
  deleteFileFromProject,
  deleteAllFilesFromProject,
} from "../controller/projectFilesUser.js";
import { authentication } from "../middleware/authentication.js";

const uploadRouter = express.Router();

uploadRouter.post("/upload/:project_id", authentication, uploadFileToProject);

uploadRouter.get("/download/:file_id", authentication, downloadFileFromProject);

uploadRouter.delete("/delete/:file_id", authentication, deleteFileFromProject);

uploadRouter.delete("/delete-all/:project_id", authentication, async (req, res) => {
  try {
    await deleteAllFilesFromProject(req.params.project_id);
    res.status(200).json({ success: true, message: "All files deleted successfully" });
  } catch (error) {
    console.error("Delete all error:", error);
    res.status(500).json({ error: error.message });
  }
});

export default uploadRouter;
