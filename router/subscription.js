import express from "express";
import { 
  getFreelancerSubscription,
  subscribeToPlan,
  cancelSubscription
} from "../controller/plans-subscriptions/subscriptions.js";

import  authentication  from "../middleware/authentication.js";
import authorization from "../middleware/authorization.js"; 
import requireVerifiedWithSubscription from "../middleware/requireVerifiedWithSubscription.js";

const SubscriptionRouter = express.Router();

/**
 * -----------------------------------------------------
 * FREELANCER SUBSCRIPTION ROUTES
 * -----------------------------------------------------
 */

// Get current freelancer's subscription
SubscriptionRouter.get(
  "/me",
  authentication,
  requireVerifiedWithSubscription,
  getFreelancerSubscription
);

// Subscribe to a plan
SubscriptionRouter.post(
  "/subscribe",
  authentication,
  authorization("subscribe_to_plan"),  
  subscribeToPlan
);

// Cancel subscription
SubscriptionRouter.patch(
  "/cancel",
  authentication,
    requireVerifiedWithSubscription,
  authorization("cancel_subscription"), 
  cancelSubscription
);

export default SubscriptionRouter;
