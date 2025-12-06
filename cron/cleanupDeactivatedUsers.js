// cron/cleanupDeactivatedUsers.js
import "dotenv/config";
import pool from "../models/db.js";
import { LogCreators, ACTION_TYPES } from "../services/loggingService.js";

const GRACE_DAYS = 30; // مدة السماح قبل الحذف النهائي

export const cleanupDeactivatedUsers = async () => {
  console.log("🧹 Running cleanupDeactivatedUsers cron...");

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const { rows } = await client.query(
      `
      SELECT id
      FROM users
      WHERE 
        is_deleted = TRUE
        AND reason_for_disruption = 'Deactivated by user'
        AND deactivated_at IS NOT NULL
        AND deactivated_at < NOW() - INTERVAL '${GRACE_DAYS} days'
      `
    );

    console.log(`👉 Found ${rows.length} users to permanently delete`);

    for (const row of rows) {
      const userId = row.id;

      // احذف المستخدم نهائياً
      await client.query("DELETE FROM users WHERE id = $1", [userId]);

      // حاول تكتب لوج (لو فيه جدول لوج)
      try {
        await LogCreators.userAuth(
          userId,
          ACTION_TYPES.ACCOUNT_PERMANENTLY_DELETED,
          true,
          { reason: "cron_cleanup_after_30_days" }
        );
      } catch (logErr) {
        console.error(
          "Failed to write log for permanent deletion userId=",
          userId,
          logErr
        );
      }

      console.log(`✅ Permanently deleted user ${userId}`);
    }

    await client.query("COMMIT");
    console.log("🎉 cleanupDeactivatedUsers finished");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ cleanupDeactivatedUsers error:", err);
  } finally {
    client.release();
  }
};

// للتشغيل اليدوي: node cron/cleanupDeactivatedUsers.js
if (import.meta.url === `file://${process.argv[1]}`) {
  cleanupDeactivatedUsers()
    .then(() => {
      console.log("✅ Script done");
      process.exit(0);
    })
    .catch((err) => {
      console.error("❌ Script failed:", err);
      process.exit(1);
    });
}
