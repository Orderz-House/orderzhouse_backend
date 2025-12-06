import express from "express";
import { giveCourseCoupon, getMyCourseCoupons } from "../controller/courses/course.js";
import { authentication } from "../middleware/authentication.js";
import  requireVerifiedWithSubscription  from "../middleware/requireVerifiedWithSubscription.js";
import adminOnly from "../middleware/adminOnly.js"; 

const CoursesRouter = express.Router();

// Admin gives freelancer a course coupon
CoursesRouter.post("/coupon", authentication, adminOnly, giveCourseCoupon);

// Freelancer views their coupons (must be verified + subscribed)
CoursesRouter.get("/myCoupon", authentication, requireVerifiedWithSubscription, getMyCourseCoupons);

export default CoursesRouter;
