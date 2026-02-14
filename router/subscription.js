import express from "express";
import { getAllSubscriptions } from "../controller/plans-subscriptions/subscriptions.js"
import { getSubscriptionStatus } from "../controller/plans-subscriptions/getSubscriptionStatus.js";
import { authentication } from "../middleware/authentication.js";
import adminOnly from "../middleware/adminOnly.js"; 

const SubscriptionRouter = express.Router();

SubscriptionRouter.get("/admin/all", adminOnly ,getAllSubscriptions);
SubscriptionRouter.get("/status", authentication, getSubscriptionStatus);

export default SubscriptionRouter;
