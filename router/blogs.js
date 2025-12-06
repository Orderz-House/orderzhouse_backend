// routes/blogs.js
import express from "express";
import multer from "multer";
import { authentication } from "../middleware/authentication.js";
import authorization from "../middleware/authorization.js";
import {
  getBlogs,
  getBlogById,
  createBlog,
  updateBlog,
  deleteBlog,
  approveBlog,
  rejectBlog,
  likeBlog,
  saveBlog
} from "../controller/blogs.js";

const Blogsrouter = express.Router();

const storage = multer.memoryStorage();
const upload = multer({ 
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 }, 
  fileFilter: (req, file, cb) => {
    if (file.fieldname === 'cover') {
      if (file.mimetype.startsWith('image/')) {
        cb(null, true);
      } else {
        cb(new Error('Cover must be an image'), false);
      }
    } else if (file.fieldname === 'attachments') {
      const allowedTypes = [
        'image/', 
        'application/pdf', 
        'text/', 
        'application/msword',
        'application/vnd.openxmlformats-officedocument'
      ];
      const isValid = allowedTypes.some(type => file.mimetype.startsWith(type));
      cb(null, isValid);
    } else {
      cb(null, true);
    }
  }
}).fields([
  { name: 'cover', maxCount: 1 },
  { name: 'attachments', maxCount: 5 }
]);

Blogsrouter.get("/", getBlogs);
Blogsrouter.get("/:id", getBlogById);

Blogsrouter.post("/", authentication, upload, createBlog);
Blogsrouter.put("/:id", authentication, upload, updateBlog);
Blogsrouter.delete("/:id", authentication, deleteBlog);
Blogsrouter.put("/:id/approve", authentication, authorization("admin"), approveBlog);
Blogsrouter.put("/:id/reject", authentication, authorization("admin"), rejectBlog);
Blogsrouter.post("/:id/like", authentication, likeBlog);
Blogsrouter.post("/:id/save", authentication, saveBlog);

export default Blogsrouter;