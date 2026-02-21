import express from "express";
import authentication from "../middleware/authentication.js";
import adminOnly from "../middleware/adminOnly.js";
import { getAnalyticsAdmin, getAnalyticsKpis } from "../controller/analytics.js";

const router = express.Router();

router.get("/kpis", authentication, adminOnly, getAnalyticsKpis);
router.get("/admin", authentication, adminOnly, getAnalyticsAdmin);

export default router;
