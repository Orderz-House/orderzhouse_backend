import cron from "node-cron";
import { autoExpireOldOffers } from "../controller/offers.js";

export const registerOfferCronJobs = () => {
  cron.schedule("0 0 * * *", async () => {
    console.log("🕓 Running daily offer auto-expiration job...");
    await autoExpireOldOffers();
  });

};
