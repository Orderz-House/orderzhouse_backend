import express from "express";
import {
  getPlans,
  createPlan,
  editPlan,
  deletePlan,
  getPlanSubscribers,
  getPlanSubscriptionCounts,
  adminUpdateSubscription,
  getAllSubscriptions,
  adminCancelSubscription
} from "../controller/plans-subscriptions/plans.js";

import { authentication } from "../middleware/authentication.js";
import adminOnly from "../middleware/adminOnly.js";
import requireVerifiedWithSubscription from "../middleware/requireVerifiedWithSubscription.js";

const plansRouter = express.Router();


plansRouter.get("/", getPlans);


plansRouter.get(
  "/subscriptions/counts",
  authentication,
  adminOnly,
  getPlanSubscriptionCounts
);

plansRouter.get(
  "/subscriptions/all",
  authentication,
  adminOnly,
  getAllSubscriptions
);

plansRouter.get(
  "/:id/subscribers",
  authentication,
  adminOnly,
  getPlanSubscribers
);

plansRouter.post("/create", authentication, adminOnly, createPlan);
plansRouter.put("/edit/:id", authentication, adminOnly, editPlan);
plansRouter.delete("/delete/:id", authentication, adminOnly, deletePlan);

plansRouter.patch(
  "/admin/subscription",
  authentication,
  adminOnly,
  adminUpdateSubscription
);

plansRouter.patch(
  "/:planId/subscribers/:id",
  authentication,
  adminOnly,
  adminCancelSubscription
);






export default plansRouter;
