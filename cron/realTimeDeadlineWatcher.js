import pool from "../models/db.js";
import { NotificationCreators } from "../services/notificationService.js";

export const startDeadlineWatcher = () => {
  console.log("[CRON] Deadline watcher started ✅");

  setInterval(async () => {
    try {
      const { rows: overdue } = await pool.query(`
        SELECT pa.id AS assignment_id, pa.project_id, pa.freelancer_id,
               p.title, p.user_id AS client_id, pa.deadline
        FROM project_assignments pa
        JOIN projects p ON pa.project_id = p.id
        WHERE pa.status = 'active' AND pa.deadline < NOW() AND p.is_deleted = false
      `);

      if (overdue.length > 0) {
        for (const item of overdue) {
          await pool.query(`
            UPDATE project_assignments SET status = 'overdue' WHERE id = $1
          `, [item.assignment_id]);

          await pool.query(`
            UPDATE projects SET completion_status = 'overdue' WHERE id = $1
          `, [item.project_id]);

          await NotificationCreators.projectOverdue(
            item.client_id,
            item.freelancer_id,
            item.project_id,
            item.title
          );

          if (global.io) {
            global.io.emit("projectOverdue", {
              projectId: item.project_id,
              title: item.title,
              clientId: item.client_id,
              freelancerId: item.freelancer_id,
              deadline: item.deadline,
            });
          }

          console.log(` Project "${item.title}" marked overdue.`);
        }
      }
    } catch (err) {
      console.error("Real-time deadline watcher error:", err);
    }
  }, 30 * 1000); 
};
