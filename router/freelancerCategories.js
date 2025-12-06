import express from "express";
import { authentication } from "../middleware/authentication.js";
import requireVerifiedWithSubscription from "../middleware/requireVerifiedWithSubscription.js";
import {
  updateFreelancerCategories,
  getFreelancerCategories
} from "../controller/freelancerCategories.js";

const freelancerCategoriesRouter = express.Router();

freelancerCategoriesRouter.get(
  "/",
  authentication,
  requireVerifiedWithSubscription,
  getFreelancerCategories
);

freelancerCategoriesRouter.put(
  "/",
  authentication,
  requireVerifiedWithSubscription,
  updateFreelancerCategories
);

export default freelancerCategoriesRouter;
