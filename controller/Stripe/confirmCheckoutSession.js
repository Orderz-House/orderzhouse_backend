import Stripe from "stripe";
import pool from "../../models/db.js";
import { fromStripeAmount } from "../../utils/stripeAmount.js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Helper: Extract payment intent ID safely
const extractPaymentIntentId = (paymentIntent) => {
  if (!paymentIntent) return null;
  if (typeof paymentIntent === "string") return paymentIntent;
  if (typeof paymentIntent === "object" && paymentIntent.id) return paymentIntent.id;
  return null;
};

export const confirmCheckoutSession = async (req, res) => {
  try {
    // 2️⃣ BACKEND CHECK: Log incoming request
    console.log("[confirmCheckoutSession] Request received:", {
      query: req.query,
      params: req.params,
      method: req.method,
      url: req.url,
    });

    const { session_id } = req.query;
    
    if (!session_id || session_id.trim() === "") {
      console.error("[confirmCheckoutSession] Missing session_id in query");
      return res.status(400).json({ 
        ok: false, 
        error: "Missing session_id",
        success: false,
        message: "Session ID is required"
      });
    }

    // 3️⃣ STRIPE VALIDATION: Check if Stripe secret key exists
    if (!process.env.STRIPE_SECRET_KEY) {
      console.error("[confirmCheckoutSession] STRIPE_SECRET_KEY not configured");
      return res.status(500).json({ 
        ok: false, 
        error: "Stripe configuration error",
        success: false,
        message: "Payment service configuration error"
      });
    }

    // 2️⃣ Improve Stripe session retrieval diagnostics
    const stripeKeyPrefix = process.env.STRIPE_SECRET_KEY.substring(0, 7); // "sk_test" or "sk_live"
    const sessionIdPrefix = session_id.substring(0, 7); // "cs_test" or "cs_live"
    const keyMode = stripeKeyPrefix.includes("test") ? "test" : "live";
    const sessionMode = sessionIdPrefix.includes("test") ? "test" : "live";
    
    console.log("[confirmCheckoutSession] Stripe mode check:", {
      keyMode,
      sessionMode,
      keyPrefix: stripeKeyPrefix,
      sessionPrefix: sessionIdPrefix,
    });

    // Detect test/live mismatch
    if (keyMode !== sessionMode) {
      console.error("[confirmCheckoutSession] Test/Live mode mismatch detected");
      return res.status(400).json({ 
        ok: false, 
        error: "Stripe mode mismatch",
        success: false,
        message: `Stripe key is in ${keyMode} mode but session is in ${sessionMode} mode. Please use matching test or live credentials.`
      });
    }

    // 1️⃣ Get session from Stripe 
    console.log("[confirmCheckoutSession] Retrieving Stripe session:", session_id);
    let session;
    try {
      session = await stripe.checkout.sessions.retrieve(session_id);
    } catch (stripeError) {
      console.error("[confirmCheckoutSession] Stripe retrieve error:", {
        message: stripeError.message,
        type: stripeError.type,
        code: stripeError.code,
      });
      
      if (stripeError.type === 'StripeInvalidRequestError') {
        return res.status(400).json({ 
          ok: false, 
          error: "Invalid session ID",
          success: false,
          message: "The payment session is invalid or expired"
        });
      }
      
      return res.status(500).json({ 
        ok: false, 
        error: "Stripe service error",
        success: false,
        message: "Failed to verify payment with Stripe"
      });
    }
    
    console.log("[confirmCheckoutSession] Session retrieved:", {
      id: session.id,
      payment_status: session.payment_status,
      metadata: session.metadata,
    });

    // Verify payment status
    if (session.payment_status !== "paid") {
      console.warn("[confirmCheckoutSession] Payment not completed:", {
        session_id: session.id,
        payment_status: session.payment_status,
      });
      return res.status(400).json({ 
        ok: false, 
        error: "Payment not completed",
        success: false,
        message: `Payment status is ${session.payment_status}. Payment must be completed.`
      });
    }

    // Extract and validate metadata
    const user_id = Number(session.metadata?.user_id);
    const purpose = session.metadata?.purpose; // 'plan' | 'project' | 'offer'
    const reference_id = session.metadata?.reference_id ? Number(session.metadata.reference_id) : null;
    const includesYearlyFee = session.metadata?.includes_yearly_fee === "yes";

    console.log("[confirmCheckoutSession] Extracted metadata:", {
      user_id,
      purpose,
      reference_id,
      includesYearlyFee,
      metadata: session.metadata,
    });

    // Validate required metadata
    if (!user_id || isNaN(user_id)) {
      console.error("[confirmCheckoutSession] Invalid user_id in metadata");
      return res.status(400).json({ 
        ok: false, 
        error: "Invalid metadata: user_id is required",
        success: false,
        message: "Payment session metadata is invalid"
      });
    }
    
    if (!purpose || !['plan', 'project', 'offer'].includes(purpose)) {
      console.error("[confirmCheckoutSession] Invalid purpose in metadata:", purpose);
      return res.status(400).json({ 
        ok: false, 
        error: "Invalid metadata: purpose must be 'plan', 'project', or 'offer'",
        success: false,
        message: "Payment session metadata is invalid"
      });
    }
    
    // For projects: reference_id is not required (project is created from project_data)
    // For plans: reference_id (plan_id) is required
    // For offers: reference_id (offer_id) is required
    if (purpose === "plan" && (!reference_id || isNaN(reference_id))) {
      console.error("[confirmCheckoutSession] Invalid reference_id for plan purpose");
      return res.status(400).json({ 
        ok: false, 
        error: "Invalid metadata: reference_id (plan_id) is required for plan payments",
        success: false,
        message: "Payment session metadata is invalid"
      });
    }
    
    if (purpose === "offer" && (!reference_id || isNaN(reference_id))) {
      console.error("[confirmCheckoutSession] Invalid reference_id for offer purpose");
      return res.status(400).json({ 
        ok: false, 
        error: "Invalid metadata: reference_id (offer_id) is required for offer payments",
        success: false,
        message: "Payment session metadata is invalid"
      });
    }
    
    // For projects: check if project_data exists (project is created from this)
    if (purpose === "project" && !session.metadata?.project_data) {
      console.error("[confirmCheckoutSession] Missing project_data for project purpose");
      return res.status(400).json({ 
        ok: false, 
        error: "Invalid metadata: project_data is required for project payments",
        success: false,
        message: "Payment session metadata is invalid"
      });
    }

    // 4️⃣ Convert Stripe amount to JOD (JOD uses 1000 minor units)
    const amount = fromStripeAmount(session.amount_total);
    const currency = "JOD";

    // 3️⃣ Make payment_intent insertion safe
    const paymentIntentId = extractPaymentIntentId(session.payment_intent);

    // For projects: project will be created from project_data, so reference_id will be set after creation
    // For plans: reference_id is the plan_id
    // For offers: reference_id is the offer_id
    let referenceIdForDb = null;
    
    if (purpose === "offer") {
      referenceIdForDb = Number(session.metadata.reference_id);
    } else if (purpose === "plan") {
      referenceIdForDb = reference_id;
    }
    // For projects: reference_id will be set after project creation (see PROJECT LOGIC section)

    // 2️⃣ Insert payment (idempotent)
    // Note: For projects, reference_id will be NULL initially, then updated after project creation
    const paymentResult = await pool.query(
  `
  INSERT INTO payments (
    user_id,
    amount,
    currency,
    purpose,
    reference_id,
    stripe_session_id,
    stripe_payment_intent,
    status
  )
  VALUES ($1, $2, $3, $4, $5, $6, $7, 'paid')
  ON CONFLICT (stripe_session_id)
  DO UPDATE SET status = 'paid'
  RETURNING id;
  `,
  [
    user_id,
    amount,
    currency,
    purpose,
    referenceIdForDb,
    session.id,
    paymentIntentId,
  ]
);
    const paymentId = paymentResult.rows[0]?.id;

    // 3️⃣ Yearly fee tracking (plans only) - record in user_yearly_fees table if fee was paid
    if (purpose === "plan" && includesYearlyFee) {
      const currentYear = new Date().getFullYear();
      await pool.query(
        `
        INSERT INTO user_yearly_fees (user_id, fee_year, stripe_session_id)
        VALUES ($1, $2, $3)
        ON CONFLICT (user_id, fee_year) DO NOTHING
        `,
        [user_id, currentYear, session.id]
      );
    }

    // 4️⃣ PLAN LOGIC → create subscription with pending_start status
    if (purpose === "plan") {
      const planRes = await pool.query(
        "SELECT duration, plan_type FROM plans WHERE id = $1",
        [reference_id]
      );

      if (planRes.rowCount === 0) {
        return res.status(404).json({ ok: false, error: "Plan not found" });
      }

      const plan = planRes.rows[0];

      // Subscription starts in pending_start state - dates will be set when activated
      // For now, set placeholder dates (CURRENT_DATE) because columns are NOT NULL
      // These will be recalculated on activation when freelancer starts first project
      // 1️⃣ Fix Date bug: setHours takes 4 args (hours, minutes, seconds, milliseconds)
      const placeholderStart = new Date();
      placeholderStart.setHours(0, 0, 0, 0);
      const placeholderEnd = new Date(placeholderStart);

      // Insert subscription with pending_start status
      // Handle activated_at column gracefully (may not exist in older DBs)
      try {
        await pool.query(
          `
          INSERT INTO subscriptions (
            freelancer_id,
            plan_id,
            start_date,
            end_date,
            status,
            activated_at,
            stripe_session_id
          )
          VALUES ($1, $2, $3, $4, 'pending_start', NULL, $5)
          ON CONFLICT (stripe_session_id) DO NOTHING;
          `,
          [user_id, reference_id, placeholderStart, placeholderEnd, session.id]
        );
      } catch (err) {
        // Fallback if activated_at column doesn't exist yet
        if (err.message && err.message.includes('activated_at')) {
          await pool.query(
            `
            INSERT INTO subscriptions (
              freelancer_id,
              plan_id,
              start_date,
              end_date,
              status,
              stripe_session_id
            )
            VALUES ($1, $2, $3, $4, 'pending_start', $5)
            ON CONFLICT (stripe_session_id) DO NOTHING;
            `,
            [user_id, reference_id, placeholderStart, placeholderEnd, session.id]
          );
        } else {
          throw err;
        }
      }
      
      // Check if this is user's first paid plan purchase and complete referral
      const existingSubscriptions = await pool.query(
        'SELECT id FROM subscriptions WHERE freelancer_id = $1 AND stripe_session_id != $2',
        [user_id, session.id]
      );
      
      // If this is the first subscription (no other subscriptions exist), complete referral
      if (existingSubscriptions.rowCount === 0) {
        try {
          // Find pending referral for this user
          const referralResult = await pool.query(`
            SELECT id, referrer_user_id, status
            FROM referrals
            WHERE referred_user_id = $1 AND status = 'pending'
            LIMIT 1
          `, [user_id]);
          
          if (referralResult.rows.length > 0) {
            const referral = referralResult.rows[0];
            const referralId = referral.id;
            const referrerUserId = referral.referrer_user_id;
            
            // Get reward amounts (configurable)
            const referrerReward = 5.0; // JOD
            
            // Mark referral as completed
            await pool.query(`
              UPDATE referrals
              SET status = 'completed', completed_at = CURRENT_TIMESTAMP
              WHERE id = $1
            `, [referralId]);
            
            // Create reward for referrer
            await pool.query(`
              INSERT INTO referral_rewards (user_id, referral_id, amount, type)
              VALUES ($1, $2, $3, 'referral')
            `, [referrerUserId, referralId, referrerReward]);
            
            console.log(`✅ Referral completed for user ${user_id}, referrer ${referrerUserId} earned ${referrerReward} JOD`);
          }
        } catch (err) {
          // Silently fail - referral completion is not critical
          console.error('Referral completion error:', err);
        }
      }
    }

    // 5️⃣ PROJECT LOGIC → create project from project_data
    let projectCreated = false;
    let projectId = null;
    let projectError = null;
    
    if (purpose === "project") {
      try {
        // 6️⃣ Keep DB operations idempotent: Check if project already exists for this session
        const existingPaymentCheck = await pool.query(
          `SELECT reference_id FROM payments WHERE stripe_session_id = $1 AND reference_id IS NOT NULL`,
          [session.id]
        );
        
        if (existingPaymentCheck.rowCount > 0 && existingPaymentCheck.rows[0].reference_id) {
          // Project already created for this session - reuse it
          projectId = existingPaymentCheck.rows[0].reference_id;
          projectCreated = true;
          console.log(`[confirmCheckoutSession] Project ${projectId} already exists for session ${session.id}, reusing`);
        } else {
          // Parse project_data from metadata
          let projectData;
          try {
            projectData = JSON.parse(session.metadata.project_data);
          } catch (parseError) {
            console.error("[confirmCheckoutSession] Failed to parse project_data:", {
              error: parseError.message,
              raw_data: session.metadata.project_data,
            });
            throw new Error(`Invalid project_data format: ${parseError.message}`);
          }
          
          console.log("[confirmCheckoutSession] Creating project from payment:", {
            user_id,
            title: projectData.title,
            project_type: projectData.project_type,
            category_id: projectData.category_id,
            sub_sub_category_id: projectData.sub_sub_category_id,
            duration_type: projectData.duration_type,
            budget: projectData.budget,
          });

          // 1️⃣ Bidding projects do NOT require payment - reject them
          if (projectData.project_type === "bidding") {
            console.error("[confirmCheckoutSession] Bidding projects should not go through Stripe confirmation");
            return res.status(400).json({
              ok: false,
              success: false,
              error: "Invalid project type for payment",
              message: "Bidding projects should not go through Stripe confirmation.",
            });
          }

          // Validate required fields before attempting insert
          if (!projectData.category_id) {
            throw new Error("Missing category_id in project_data");
          }
          if (!projectData.sub_sub_category_id) {
            throw new Error("Missing sub_sub_category_id in project_data");
          }
          if (!projectData.title || !projectData.title.trim()) {
            throw new Error("Missing or empty title in project_data");
          }
          if (!projectData.description || !projectData.description.trim()) {
            throw new Error("Missing or empty description in project_data");
          }
          if (!projectData.duration_type) {
            throw new Error("Missing duration_type in project_data");
          }
          if (projectData.project_type === "fixed" && (!projectData.budget || projectData.budget <= 0)) {
            throw new Error("Invalid budget for fixed project");
          }
          if (projectData.project_type === "hourly" && (!projectData.hourly_rate || projectData.hourly_rate <= 0)) {
            throw new Error("Invalid hourly_rate for hourly project");
          }
          if (projectData.duration_type === "days" && (!projectData.duration_days || projectData.duration_days <= 0)) {
            throw new Error("Invalid duration_days");
          }
          if (projectData.duration_type === "hours" && (!projectData.duration_hours || projectData.duration_hours <= 0)) {
            throw new Error("Invalid duration_hours");
          }

          // Normalize project data (matching createProject structure)
          const durationDaysValue = projectData.duration_type === "days" ? Number(projectData.duration_days) : null;
          const durationHoursValue = projectData.duration_type === "hours" ? Number(projectData.duration_hours) : null;
          const normalizedBudget = projectData.project_type === "fixed" ? Number(projectData.budget) : null;
          const normalizedBudgetMin = projectData.project_type === "bidding" ? Number(projectData.budget_min) : null;
          const normalizedBudgetMax = projectData.project_type === "bidding" ? Number(projectData.budget_max) : null;
          const normalizedHourlyRate = projectData.project_type === "hourly" ? Number(projectData.hourly_rate) : null;

          // Ensure preferred_skills is an array (PostgreSQL TEXT[] expects array)
          const preferredSkillsArray = Array.isArray(projectData.preferred_skills) 
            ? projectData.preferred_skills 
            : (projectData.preferred_skills ? [projectData.preferred_skills] : []);

          // 2️⃣-5️⃣ Compute project status: fixed and hourly projects must be "active"
          let projectStatus = "active";

          console.log("[confirmCheckoutSession] Normalized project data:", {
            durationDaysValue,
            durationHoursValue,
            normalizedBudget,
            normalizedHourlyRate,
            preferredSkillsCount: preferredSkillsArray.length,
            projectStatus,
          });

          // Create project with computed status and payment_method='stripe'
          const projectInsertResult = await pool.query(
            `
            INSERT INTO projects (
              user_id,
              category_id,
              sub_category_id,
              sub_sub_category_id,
              title,
              description,
              budget,
              duration_days,
              duration_hours,
              project_type,
              budget_min,
              budget_max,
              hourly_rate,
              preferred_skills,
              status,
              completion_status,
              is_deleted,
              payment_method,
              admin_approval_status
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 'not_started', false, 'stripe', 'none')
            RETURNING id, title
            `,
            [
              user_id,
              projectData.category_id,
              projectData.sub_category_id || null,
              projectData.sub_sub_category_id,
              projectData.title.trim(),
              projectData.description.trim(),
              normalizedBudget,
              durationDaysValue,
              durationHoursValue,
              projectData.project_type,
              normalizedBudgetMin,
              normalizedBudgetMax,
              normalizedHourlyRate,
              preferredSkillsArray,
              projectStatus,
            ]
          );

          if (projectInsertResult.rowCount === 0) {
            console.error("[confirmCheckoutSession] Project creation returned 0 rows - INSERT failed silently");
            projectError = { message: "Project creation returned no rows - database insert failed" };
          } else {
            const project = projectInsertResult.rows[0];
            projectId = project.id;
            projectCreated = true;
            
            // Update payment record with the created project ID
            const updateResult = await pool.query(
              `UPDATE payments SET reference_id = $1 WHERE stripe_session_id = $2 AND reference_id IS NULL`,
              [projectId, session.id]
            );
            
            console.log(`✅ Project ${project.id} "${project.title}" created with status ${projectStatus} after payment`);
            console.log(`✅ Payment record updated: ${updateResult.rowCount} row(s) updated`);

            // A) Create escrow if freelancer is already assigned (rare but possible)
            // Check if project has an active freelancer assignment
            const assignmentCheck = await pool.query(
              `SELECT freelancer_id FROM project_assignments 
               WHERE project_id = $1 AND status = 'active' LIMIT 1`,
              [projectId]
            );

            if (assignmentCheck.rows.length > 0 && paymentId) {
              const freelancerId = assignmentCheck.rows[0].freelancer_id;
              const { createEscrowHeld } = await import("../../services/escrowService.js");
              try {
                await createEscrowHeld({
                  projectId,
                  clientId: user_id,
                  freelancerId,
                  amount,
                  paymentId,
                });
                console.log(`✅ Escrow created for project ${projectId} with freelancer ${freelancerId}`);
              } catch (escrowError) {
                console.error("[confirmCheckoutSession] Escrow creation error:", escrowError);
                // Don't fail payment confirmation if escrow creation fails
              }
            }
          }
        }
      } catch (projectErrorCaught) {
        // 5️⃣ Prevent false "confirmation failed": Payment is already confirmed, don't return 500
        projectError = {
          message: projectErrorCaught.message,
          stack: projectErrorCaught.stack,
          code: projectErrorCaught.code,
          detail: projectErrorCaught.detail,
          constraint: projectErrorCaught.constraint,
        };
        console.error("[confirmCheckoutSession] Error creating project:", {
          message: projectErrorCaught.message,
          stack: projectErrorCaught.stack,
          code: projectErrorCaught.code,
          detail: projectErrorCaught.detail,
          constraint: projectErrorCaught.constraint,
          projectData: session.metadata?.project_data,
        });
        // Continue - payment is confirmed, we'll return success with project_created: false
      }
    }

    // 6️⃣ OFFER ACCEPT (BIDDING) → بعد دفع العميل مبلغ العرض: قبول العرض وتسليم المشروع للفريلانسر
    if (purpose === "offer") {
      const offerId = referenceIdForDb;
      try {
        const { completeOfferAcceptance } = await import("../offers.js");
        await completeOfferAcceptance(offerId);
        console.log(`✅ Offer ${offerId} accepted and freelancer assigned after payment`);
      } catch (err) {
        console.error("completeOfferAcceptance error:", err);
        return res.status(500).json({ ok: false, error: "Failed to complete offer acceptance" });
      }
    }

    // 7️⃣ RETURN STRUCTURE: Return success response with all required fields
    const responseData = {
      ok: true,
      success: true,
      purpose,
      message: "Payment confirmed successfully",
      stripe_session_id: session.id,
      payment_intent_id: paymentIntentId,
      amount,
      currency,
    };

    // Add project-specific fields if purpose is project
    if (purpose === "project") {
      responseData.project_created = projectCreated;
      if (projectId) {
        responseData.project_id = projectId;
      }
      if (projectError) {
        responseData.project_error = {
          message: projectError.message,
          code: projectError.code,
          detail: projectError.detail,
          constraint: projectError.constraint,
        };
        // Also update main message to indicate project creation failed
        responseData.message = "Payment confirmed but project creation failed. Check project_error for details.";
      }
    }

    console.log("[confirmCheckoutSession] Confirmation successful:", {
      purpose,
      user_id,
      reference_id: referenceIdForDb,
      project_created: purpose === "project" ? projectCreated : undefined,
      project_id: purpose === "project" ? projectId : undefined,
    });
    
    return res.json(responseData);

  } catch (err) {
    console.error("[confirmCheckoutSession] Unexpected error:", {
      message: err.message,
      stack: err.stack,
      name: err.name,
    });
    
    return res.status(500).json({ 
      ok: false, 
      success: false,
      error: "Server error",
      message: "An unexpected error occurred during payment confirmation"
    });
  }
};
