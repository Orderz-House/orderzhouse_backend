/**
 * Tender Vault Rotation System - Cron Jobs
 * Daily rotation and expiration checks
 */

import cron from "node-cron";
import {
  performDailyRotation,
  checkAndExpireActiveTenders,
} from "../services/tenderVaultRotation.js";

/**
 * Register daily rotation job
 * Runs once per day at 00:00 (midnight)
 */
export const registerTenderVaultRotationJobs = () => {
  // Daily rotation: Select and activate 30-70 tenders
  cron.schedule("0 0 * * *", async () => {
    console.log("🔄 [CRON] Starting daily tender vault rotation...");
    try {
      const result = await performDailyRotation();
      console.log(`✅ [CRON] Daily rotation completed:`, result);
    } catch (error) {
      console.error("❌ [CRON] Daily rotation failed:", error);
    }
  });

  // Expiration check: Runs every hour to check for expired active tenders
  cron.schedule("0 * * * *", async () => {
    console.log("⏰ [CRON] Checking for expired active tenders...");
    try {
      const result = await checkAndExpireActiveTenders();
      console.log(`✅ [CRON] Expiration check completed:`, result);
    } catch (error) {
      console.error("❌ [CRON] Expiration check failed:", error);
    }
  });

  console.log("✅ Tender Vault Rotation cron jobs registered");
};
