import express from "express";
import {
  getUsersByRole,
  getUserById,
  createUser,
  updateUser,
  deleteUser,
  verifyFreelancer,
} from "../controller/adminUser.js";
import { authentication } from "../middleware/authentication.js"; 
import adminOnly from "../middleware/adminOnly.js"; 

const AdminUser = express.Router();

// ----------------------
// Admin-only routes
// ----------------------
AdminUser.post("/", authentication, adminOnly, createUser); 
AdminUser.get("/role/:roleId", authentication, adminOnly, getUsersByRole);
AdminUser.get("/:id", adminOnly, getUserById);
AdminUser.put("/:id", authentication, adminOnly, updateUser);
AdminUser.delete("/:id", authentication, adminOnly, deleteUser);
AdminUser.patch("/verify/:id", authentication, adminOnly, verifyFreelancer);

export default AdminUser;
