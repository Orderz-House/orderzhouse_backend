import express from "express";
import authentication from "../middleware/authentication.js";
import requireTenderVaultPermission from "../middleware/requireTenderVaultPermission.js";
import {
  getTenderVaultProjects,
  getTenderVaultProject,
  createTenderVaultProject,
  updateTenderVaultProject,
  updateTenderVaultProjectStatus,
  deleteTenderVaultProject,
} from "../controller/tenderVault/tenderVault.js";
import pool from "../models/db.js";

// Sanity check: verify table exists on first route access
let tableCheckDone = false;
async function checkTableExists() {
  if (tableCheckDone) return;
  try {
    const { rows } = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'tender_vault_projects'
      );
    `);
    if (!rows[0]?.exists) {
      console.warn("⚠️  WARNING: tender_vault_projects table does not exist. Run migration 010_fix_tender_vault_projects_schema.js");
    } else {
      // Check for critical columns (sub_category_id is NOT required - it's in metadata)
      const { rows: cols } = await pool.query(`
        SELECT column_name FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'tender_vault_projects'
        AND column_name IN ('category_id', 'created_by', 'status', 'metadata', 'attachments');
      `);
      // Require: category_id, created_by, status, metadata, attachments
      if (cols.length < 5) {
        console.warn("⚠️  WARNING: tender_vault_projects table missing required columns. Run migration 011_create_tender_vault_projects_correct_schema.js");
      } else {
        console.log("✅ tender_vault_projects table verified");
      }
    }
    tableCheckDone = true;
  } catch (err) {
    console.warn("⚠️  Could not verify tender_vault_projects table:", err.message);
  }
}

const router = express.Router();

// All routes require authentication and tender vault permission
router.use(authentication);
router.use(requireTenderVaultPermission);
router.use(async (req, res, next) => {
  // Run table check on first request
  await checkTableExists();
  next();
});

router.get("/projects", getTenderVaultProjects);
router.get("/projects/:id", getTenderVaultProject);
router.post("/projects", createTenderVaultProject);
router.put("/projects/:id", updateTenderVaultProject);
router.patch("/projects/:id/status", updateTenderVaultProjectStatus);
router.delete("/projects/:id", deleteTenderVaultProject);

export default router;
