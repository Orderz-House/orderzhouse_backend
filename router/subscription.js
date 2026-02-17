import express from "express";
import { getAllSubscriptions } from "../controller/plans-subscriptions/subscriptions.js"
import { getSubscriptionStatus } from "../controller/plans-subscriptions/getSubscriptionStatus.js";
import { 
  assignSubscriptionToFreelancer, 
  getAdminSubscriptions,
  getFreelancersWithSubscriptions,
  activateSubscription,
  cancelSubscription
} from "../controller/plans-subscriptions/adminSubscriptions.js";
import { authentication } from "../middleware/authentication.js";
import adminOnly from "../middleware/adminOnly.js"; 

const SubscriptionRouter = express.Router();

SubscriptionRouter.get("/admin/all", adminOnly ,getAllSubscriptions);
SubscriptionRouter.get("/admin/subscriptions", authentication, getAdminSubscriptions);
SubscriptionRouter.get("/admin/subscriptions/freelancers", authentication, getFreelancersWithSubscriptions);
SubscriptionRouter.post("/admin/subscriptions/assign", authentication, assignSubscriptionToFreelancer);
SubscriptionRouter.post("/admin/subscriptions/:id/activate", authentication, activateSubscription);
SubscriptionRouter.post("/admin/subscriptions/:id/cancel", authentication, cancelSubscription);
SubscriptionRouter.get("/status", authentication, getSubscriptionStatus);

export default SubscriptionRouter;
