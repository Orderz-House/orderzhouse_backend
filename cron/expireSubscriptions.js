import pool from "../models/db.js";
import cron from "node-cron";
import { NotificationCreators } from "../services/notificationService.js";


cron.schedule("0 0 * * *", async () => {
  console.log("Running daily subscription expiry check...");

  try {
    const result = await pool.query(`
      UPDATE subscriptions
      SET status = 'expired'
      WHERE end_date < CURRENT_DATE
        AND status != 'expired'
      RETURNING id, freelancer_id, plan_id;
    `);

    if (result.rows.length > 0) {
      console.log(` ${result.rows.length} subscriptions marked as expired.`);

      for (const row of result.rows) {
        try {
          const planRes = await pool.query(
            "SELECT name FROM plans WHERE id = $1",
            [row.plan_id]
          );
          const planName = planRes.rows.length
            ? planRes.rows[0].name
            : "your plan";

          await NotificationCreators.subscriptionStatusChanged(
            row.id,
            row.freelancer_id,
            planName,
            "expired"
          );
        } catch (notifErr) {
          console.error(
            `⚠️ Notification failed for subscription ${row.id}:`,
            notifErr.message
          );
        }
      }
    } else {
      console.log("No subscriptions expired today.");
    }
  } catch (err) {
    console.error("Error expiring subscriptions:", err.message);
  }
});
