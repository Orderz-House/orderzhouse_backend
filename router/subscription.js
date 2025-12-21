import express from "express";
import { getAllSubscriptions } from "../controller/plans-subscriptions/subscriptions.js"
import adminOnly from "../middleware/adminOnly.js"; 

const SubscriptionRouter = express.Router();

SubscriptionRouter.get("/admin/all", adminOnly ,getAllSubscriptions);

export default SubscriptionRouter;
