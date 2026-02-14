/**
 * Tender Vault Rotation System
 * Automated daily rotation of stored tenders to active display
 */

import pool from "../models/db.js";

/**
 * Generate a unique temporary Client ID
 * Format: CL-XXXXXXXXX (9 random digits)
 */
export function generateTemporaryClientId() {
  const randomDigits = Math.floor(100000000 + Math.random() * 900000000);
  return `CL-${randomDigits}`;
}

/**
 * Ensure Client ID is unique (check both tender_vault_cycles and tender_client_ids for backward compatibility)
 */
async function ensureUniqueClientId() {
  let clientId = generateTemporaryClientId();
  let attempts = 0;
  const maxAttempts = 10;

  while (attempts < maxAttempts) {
    // Check in tender_vault_cycles (new table)
    const { rows: cyclesRows } = await pool.query(
      `SELECT id FROM tender_vault_cycles WHERE client_public_id = $1`,
      [clientId]
    );

    // Also check tender_client_ids for backward compatibility
    const { rows: clientIdsRows } = await pool.query(
      `SELECT id FROM tender_client_ids WHERE client_id = $1`,
      [clientId]
    );

    if (cyclesRows.length === 0 && clientIdsRows.length === 0) {
      return clientId;
    }

    clientId = generateTemporaryClientId();
    attempts++;
  }

  throw new Error("Failed to generate unique Client ID after multiple attempts");
}

/**
 * Daily Rotation Job: Select 30-70 random tenders from Stored and activate them
 */
export async function performDailyRotation() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    console.log("🔄 Starting daily tender vault rotation...");

    // Random selection count between 30 and 70
    const selectionCount = Math.floor(Math.random() * (70 - 30 + 1)) + 30;

    // Find eligible tenders:
    // - status = 'stored'
    // - NOT displayed in last 60 days (or never displayed)
    // - usage_count < 4
    // - NOT temporarily archived (or archive period expired)
    const now = new Date();
    const sixtyDaysAgo = new Date(now);
    sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

    const { rows: eligibleTenders } = await client.query(
      `SELECT id, usage_count
       FROM tender_vault_projects
       WHERE status = 'stored'
         AND is_deleted = false
         AND usage_count < 4
         AND (
           last_displayed_at IS NULL
           OR last_displayed_at < $1
         )
         AND (
           temporary_archived_until IS NULL
           OR temporary_archived_until < NOW()
         )
       ORDER BY RANDOM()
       LIMIT $2`,
      [sixtyDaysAgo, selectionCount]
    );

    if (eligibleTenders.length === 0) {
      console.log("⚠️  No eligible tenders found for rotation");
      await client.query("COMMIT");
      return { success: true, activated: 0, message: "No eligible tenders" };
    }

    console.log(`📦 Found ${eligibleTenders.length} eligible tenders, activating...`);

    const activatedTenders = [];
    const nowTimestamp = new Date();
    const endTimestamp = new Date(nowTimestamp);
    endTimestamp.setHours(endTimestamp.getHours() + 12); // 12 hours from now

    for (const tender of eligibleTenders) {
      try {
        // Get current usage_count to determine new cycle number
        const { rows: tenderInfo } = await client.query(
          `SELECT usage_count FROM tender_vault_projects WHERE id = $1`,
          [tender.id]
        );
        const currentUsageCount = tenderInfo[0]?.usage_count || 0;
        const newCycleNumber = currentUsageCount + 1;

        // Generate unique Client ID for this cycle
        const clientId = await ensureUniqueClientId();

        // Get tender details to create temporary project
        const { rows: tenderDetails } = await client.query(
          `SELECT * FROM tender_vault_projects WHERE id = $1`,
          [tender.id]
        );

        if (tenderDetails.length === 0) {
          console.error(`❌ Tender ${tender.id} not found`);
          continue;
        }

        const tenderData = tenderDetails[0];

        // Extract subcategory IDs from metadata JSONB
        const metadata = tenderData.metadata && typeof tenderData.metadata === 'object' 
          ? tenderData.metadata 
          : (typeof tenderData.metadata === 'string' ? JSON.parse(tenderData.metadata) : {});
        const subCategoryId = metadata.sub_category_id ? parseInt(metadata.sub_category_id) : null;
        const subSubCategoryId = metadata.sub_sub_category_id ? parseInt(metadata.sub_sub_category_id) : null;

        // Create temporary project entry in projects table for offers/applications
        // This allows freelancers to apply/offer to the tender
        const { rows: projectRows } = await client.query(
          `INSERT INTO projects (
            user_id, category_id, sub_category_id, sub_sub_category_id,
            title, description, budget_min, budget_max, currency,
            duration_value, duration_unit, country, attachments,
            project_type, status, completion_status, is_deleted,
            created_at, updated_at
          )
          VALUES (
            NULL, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
            'bidding', 'bidding', 'not_started', false, NOW(), NOW()
          )
          RETURNING id`,
          [
            tenderData.category_id,
            subCategoryId,
            subSubCategoryId,
            tenderData.title,
            tenderData.description,
            tenderData.budget_min,
            tenderData.budget_max,
            tenderData.currency || 'JD',
            tenderData.duration_value,
            tenderData.duration_unit,
            tenderData.country,
            tenderData.attachments || '[]',
          ]
        );

        const tempProjectId = projectRows[0].id;

        // Update tender: activate with 12-hour window and link to temp project
        await client.query(
          `UPDATE tender_vault_projects
           SET status = 'active',
               usage_count = usage_count + 1,
               display_start_time = $1,
               display_end_time = $2,
               last_displayed_at = $1,
               updated_at = NOW(),
               metadata = jsonb_set(
                 COALESCE(metadata, '{}'::jsonb),
                 '{temp_project_id}',
                 $3::text::jsonb
               )
           WHERE id = $4`,
          [nowTimestamp, endTimestamp, tempProjectId.toString(), tender.id]
        );

        // Create cycle record in tender_vault_cycles
        await client.query(
          `INSERT INTO tender_vault_cycles (
            tender_id, cycle_number, client_public_id, status,
            display_start_time, display_end_time, order_id
          )
          VALUES ($1, $2, $3, 'active', $4, $5, $6)`,
          [tender.id, newCycleNumber, clientId, nowTimestamp, endTimestamp, tempProjectId]
        );

        activatedTenders.push({
          tender_id: tender.id,
          cycle_number: newCycleNumber,
          client_public_id: clientId,
          temp_project_id: tempProjectId,
          display_until: endTimestamp,
        });

        console.log(`✅ Activated tender ${tender.id} (cycle ${newCycleNumber}, Client ID: ${clientId}, Temp Project: ${tempProjectId})`);
      } catch (err) {
        console.error(`❌ Failed to activate tender ${tender.id}:`, err.message);
        // Continue with next tender
      }
    }

    // Check if any tenders reached max usage and move to expired
    const { rows: maxUsageTenders } = await client.query(
      `SELECT id FROM tender_vault_projects
       WHERE status = 'active'
         AND usage_count >= max_usage
         AND id = ANY($1::int[])`,
      [activatedTenders.map(t => t.tender_id)]
    );

    if (maxUsageTenders.length > 0) {
      await client.query(
        `UPDATE tender_vault_projects
         SET status = 'expired',
             updated_at = NOW()
         WHERE id = ANY($1::int[])`,
        [maxUsageTenders.map(t => t.id)]
      );
      console.log(`⚠️  ${maxUsageTenders.length} tenders reached max usage and moved to expired`);
    }

    await client.query("COMMIT");

    console.log(`✅ Daily rotation completed: ${activatedTenders.length} tenders activated`);

    return {
      success: true,
      activated: activatedTenders.length,
      tenders: activatedTenders,
      expired: maxUsageTenders.length,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("❌ Daily rotation error:", error);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Expiration Job: Check active tenders past display_end_time
 * If not awarded, return to Stored and mark as temporarily archived
 */
export async function checkAndExpireActiveTenders() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    console.log("⏰ Checking for expired active tenders...");

    // Find active tenders past display_end_time
    const { rows: expiredTenders } = await client.query(
      `SELECT tv.id, tcy.id AS cycle_id, tcy.client_public_id, tcy.status AS cycle_status
       FROM tender_vault_projects tv
       LEFT JOIN LATERAL (
         SELECT id, client_public_id, status
         FROM tender_vault_cycles
         WHERE tender_id = tv.id
         ORDER BY cycle_number DESC
         LIMIT 1
       ) tcy ON true
       WHERE tv.status = 'active'
         AND tv.display_end_time < NOW()
         AND tv.is_deleted = false`,
    );

    if (expiredTenders.length === 0) {
      console.log("✅ No expired tenders found");
      await client.query("COMMIT");
      return { success: true, expired: 0 };
    }

    console.log(`📦 Found ${expiredTenders.length} expired tenders`);

    const returnedToStored = [];
    const sixtyDaysFromNow = new Date();
    sixtyDaysFromNow.setDate(sixtyDaysFromNow.getDate() + 60);

    for (const tender of expiredTenders) {
      // Check if tender was awarded (cycle status = 'awarded')
      if (tender.cycle_status === 'awarded') {
        // Tender was awarded, should be converted to order (handled separately)
        console.log(`ℹ️  Tender ${tender.id} was awarded, skipping expiration`);
        continue;
      }

      // Not awarded: update cycle status to expired, return tender to Stored
      if (tender.cycle_id) {
        await client.query(
          `UPDATE tender_vault_cycles
           SET status = 'expired',
               updated_at = NOW()
           WHERE id = $1`,
          [tender.cycle_id]
        );
      }

      await client.query(
        `UPDATE tender_vault_projects
         SET status = 'stored',
             temporary_archived_until = $1,
             display_start_time = NULL,
             display_end_time = NULL,
             updated_at = NOW()
         WHERE id = $2`,
        [sixtyDaysFromNow, tender.id]
      );

      returnedToStored.push(tender.id);
      console.log(`✅ Tender ${tender.id} returned to Stored (temporarily archived until ${sixtyDaysFromNow.toISOString()})`);
    }

    await client.query("COMMIT");

    console.log(`✅ Expiration check completed: ${returnedToStored.length} tenders returned to Stored`);

    return {
      success: true,
      expired: returnedToStored.length,
      tender_ids: returnedToStored,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("❌ Expiration check error:", error);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Convert tender to normal order when freelancer is selected
 * Locks the Client ID and creates a normal project
 */
export async function convertTenderToOrder(tenderId, freelancerId, offerId = null) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Get tender details with latest cycle and temp project ID
    const { rows: tenderRows } = await client.query(
      `SELECT 
        tv.*,
        tcy.id AS cycle_id,
        tcy.client_public_id,
        tcy.status AS cycle_status,
        tcy.order_id AS temp_project_id
       FROM tender_vault_projects tv
       LEFT JOIN LATERAL (
         SELECT id, client_public_id, status, order_id
         FROM tender_vault_cycles
         WHERE tender_id = tv.id
         ORDER BY cycle_number DESC
         LIMIT 1
       ) tcy ON true
       WHERE tv.id = $1
         AND tv.status = 'active'
         AND (tcy.status IS NULL OR tcy.status = 'active')`,
      [tenderId]
    );

    if (tenderRows.length === 0) {
      throw new Error("Tender not found or already converted");
    }

    const tender = tenderRows[0];
    const tempProjectId = tender.temp_project_id;

    if (!tempProjectId) {
      throw new Error("Temporary project not found for this tender");
    }

    if (!tender.cycle_id) {
      throw new Error("Active cycle not found for this tender");
    }

    // Update cycle status to awarded and link order
    await client.query(
      `UPDATE tender_vault_cycles
       SET status = 'awarded',
           order_id = $1,
           updated_at = NOW()
       WHERE id = $2`,
      [tempProjectId, tender.cycle_id]
    );

    // Update tender status (mark as converted, don't return to stored)
    await client.query(
      `UPDATE tender_vault_projects
       SET status = 'archived',
           updated_at = NOW()
       WHERE id = $1`,
      [tenderId]
    );

    // Create/update project assignment if freelancer is provided
    if (freelancerId) {
      // Check if assignment already exists (from offer acceptance)
      const { rows: existingAssignment } = await client.query(
        `SELECT id FROM project_assignments WHERE project_id = $1 AND freelancer_id = $2`,
        [tempProjectId, freelancerId]
      );

      if (existingAssignment.length === 0) {
        await client.query(
          `INSERT INTO project_assignments (
            project_id, freelancer_id, status, assigned_at
          ) VALUES ($1, $2, 'active', NOW())`,
          [tempProjectId, freelancerId]
        );
      }
    }

    await client.query("COMMIT");

    console.log(`✅ Tender ${tenderId} converted to order ${tempProjectId} with Client ID ${tender.client_public_id}`);

    return {
      success: true,
      project_id: tempProjectId,
      client_public_id: tender.client_public_id,
      tender_id: tenderId,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("❌ Convert tender to order error:", error);
    throw error;
  } finally {
    client.release();
  }
}
