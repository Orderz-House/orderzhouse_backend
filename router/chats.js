import express from "express";
import {
  getMessagesByProjectId,
  getMessagesByTaskId,
  createMessage,
  getAllChatsForAdmin,
  getUserChats,
} from "../controller/chats.js";
import { authentication } from "../middleware/authentication.js";

const chatsRouter = express.Router();

// userchat
chatsRouter.get("/user-chats", authentication, getUserChats);

// Project chat
chatsRouter.get("/project/:projectId/messages", authentication, getMessagesByProjectId);

// Task chat
chatsRouter.get("/task/:taskId/messages", authentication, getMessagesByTaskId);

// Create message (project OR task)
chatsRouter.post("/messages", authentication, createMessage);

// Admin — all chats
chatsRouter.get("/admin/all-chats", authentication, getAllChatsForAdmin);

export default chatsRouter;
