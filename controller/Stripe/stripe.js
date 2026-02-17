import Stripe from "stripe";
import pool from "../../models/db.js";
import { toStripeAmount } from "../../utils/stripeAmount.js";

let _stripe = null;
function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key || String(key).trim() === "") {
    throw new Error("STRIPE_SECRET_KEY is not configured");
  }
  if (!_stripe) _stripe = new Stripe(key);
  return _stripe;
}


/* ============================================================
   PLAN CHECKOUT SESSION
============================================================ */
export const createCheckoutSession = async (req, res) => {
  try {
    // Feature flag guard: block Stripe if PAYMENTS_MODE !== "stripe"
    const paymentsMode = process.env.PAYMENTS_MODE || "offline";
    if (paymentsMode !== "stripe") {
      return res.status(400).json({
        error: "Stripe payments are disabled",
        message: "Stripe payments are disabled. Please choose Subscribe from Company.",
      });
    }

    console.log("[Stripe] Request body:", req.body);
    // Accept both plan_id/planId and user_id/userId
    const plan_id = req.body.plan_id || req.body.planId;
    const user_id = req.body.user_id || req.body.userId;

    if (!plan_id || !user_id) {
      return res.status(400).json({ error: "Missing plan_id or user_id" });
    }

    if (!process.env.STRIPE_SECRET_KEY) {
      console.error("[Stripe] STRIPE_SECRET_KEY is missing");
      return res.status(500).json({ error: "Stripe configuration error", message: "STRIPE_SECRET_KEY not set" });
    }

    const stripe = getStripe();

    if (!process.env.CLIENT_URL) {
      console.error("[Stripe] CLIENT_URL is missing");
      return res.status(500).json({ error: "Configuration error", message: "CLIENT_URL not set" });
    }

    console.log("[Stripe] Fetching plan:", plan_id);
    const planRes = await pool.query(
      "SELECT id, name, description, price FROM plans WHERE id = $1",
      [plan_id]
    );

    if (planRes.rowCount === 0) {
      return res.status(404).json({ error: "Plan not found" });
    }

    console.log("[Stripe] Fetching user:", user_id);
    const userRes = await pool.query(
      "SELECT id, role_id FROM users WHERE id = $1",
      [user_id]
    );

    if (userRes.rowCount === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    const plan = planRes.rows[0];
    const user = userRes.rows[0];

    // Check if user is freelancer (role_id = 3)
    if (Number(user.role_id) !== 3) {
      return res.status(403).json({ 
        error: "Forbidden", 
        message: "Only freelancers can subscribe to plans" 
      });
    }

    // Check if user already has an active or pending_start subscription
    const activeSubscriptionCheck = await pool.query(
      `SELECT id, status, end_date, start_date 
       FROM subscriptions 
       WHERE freelancer_id = $1 
         AND status IN ('active', 'pending_start')
         AND (end_date > NOW() OR start_date > NOW())
       ORDER BY id DESC
       LIMIT 1`,
      [user_id]
    );

    if (activeSubscriptionCheck.rowCount > 0) {
      const existingSub = activeSubscriptionCheck.rows[0];
      const expirationDate = existingSub.end_date 
        ? new Date(existingSub.end_date).toLocaleDateString()
        : new Date(existingSub.start_date).toLocaleDateString();
      
      return res.status(400).json({
        success: false,
        error: "Active subscription exists",
        message: `You already have an active or upcoming subscription. You cannot change plans until it expires.${existingSub.end_date ? ` Current subscription expires on ${expirationDate}.` : ''}`
      });
    }

    console.log("[Stripe] Plan data:", { id: plan.id, name: plan.name, price: plan.price });
    console.log("[Stripe] User data:", { id: user.id, role_id: user.role_id });

    const planPrice = Number(plan.price) || 0;
    const currentYear = new Date().getFullYear();
    
    // Yearly 25 JOD fee check - only charge if not paid in current calendar year
    // Check user_yearly_fees table (NOT is_verified)
    const feeCheckRes = await pool.query(
      `SELECT id FROM user_yearly_fees 
       WHERE user_id = $1 AND fee_year = $2 
       LIMIT 1`,
      [user_id, currentYear]
    );
    const needsYearlyFee = feeCheckRes.rowCount === 0;

    console.log("[Stripe] Computed:", { planPrice, needsYearlyFee });

    // CASE A: Free plan (price = 0) AND yearly fee required
    if (planPrice === 0 && needsYearlyFee) {
      const line_items = [
        {
          price_data: {
            currency: "jod",
            product_data: { name: "Annual Plan Activation Fee" },
            unit_amount: toStripeAmount(25),
          },
          quantity: 1,
        },
      ];

      const success_url = `${process.env.CLIENT_URL}/payment/success?session_id={CHECKOUT_SESSION_ID}`;
      const cancel_url = `${process.env.CLIENT_URL}/payment/cancel`;

      console.log("[Stripe] Free plan with yearly fee - creating session with 25 JD only");
      console.log("[Stripe] Before Stripe create - mode, success_url, cancel_url:", {
        mode: "payment",
        success_url,
        cancel_url,
      });

      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        payment_method_types: ["card"],
        line_items,
        metadata: {
          user_id: String(user_id),
          purpose: "plan",
          reference_id: String(plan_id),
          includes_yearly_fee: "yes",
        },
        success_url,
        cancel_url,
      });

      console.log("[Stripe] Session created:", session.id);
      return res.json({ url: session.url });
    }

    // CASE B: Free plan (price = 0) AND yearly fee NOT required
    if (planPrice === 0 && !needsYearlyFee) {
      console.log("[Stripe] Free plan without yearly fee - creating subscription directly");

      // Create subscription directly without Stripe
      const planRes = await pool.query(
        "SELECT duration, plan_type FROM plans WHERE id = $1",
        [plan_id]
      );

      if (planRes.rowCount === 0) {
        return res.status(404).json({ error: "Plan not found" });
      }

      const planData = planRes.rows[0];
      const placeholderStart = new Date();
      placeholderStart.setHours(0, 0, 0, 0, 0);
      const placeholderEnd = new Date(placeholderStart);

      // Insert subscription with pending_start status
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
          [user_id, plan_id, placeholderStart, placeholderEnd, `free_${Date.now()}`]
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
            [user_id, plan_id, placeholderStart, placeholderEnd, `free_${Date.now()}`]
          );
        } else {
          throw err;
        }
      }

      console.log("[Stripe] Free subscription created directly");
      return res.json({ free: true, url: null });
    }

    // CASE C: Paid plan (price > 0)
    if (planPrice <= 0 || isNaN(planPrice)) {
      console.error("[Stripe] Invalid plan price:", plan.price);
      return res.status(400).json({ error: "Invalid plan price" });
    }

    const unit_amount = toStripeAmount(planPrice);
    if (unit_amount <= 0) {
      console.error("[Stripe] Invalid unit_amount:", unit_amount);
      return res.status(400).json({ error: "Invalid plan price amount" });
    }

    const line_items = [
      {
        price_data: {
          currency: "jod",
          product_data: {
            name: plan.name,
            description: plan.description || undefined,
          },
          unit_amount: unit_amount,
        },
        quantity: 1,
      },
    ];

    if (needsYearlyFee) {
      line_items.push({
        price_data: {
          currency: "jod",
          product_data: { name: "Annual Plan Activation Fee" },
          unit_amount: toStripeAmount(25),
        },
        quantity: 1,
      });
    }

    const success_url = `${process.env.CLIENT_URL}/payment/success?session_id={CHECKOUT_SESSION_ID}`;
    const cancel_url = `${process.env.CLIENT_URL}/payment/cancel`;
    console.log("[Stripe] Before Stripe create (paid plan) - mode, success_url, cancel_url:", {
      mode: "payment",
      success_url,
      cancel_url,
    });

    const session = await getStripe().checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items,
      metadata: {
        user_id: String(user_id),
        purpose: "plan",
        reference_id: String(plan_id),
        includes_yearly_fee: needsYearlyFee ? "yes" : "no",
      },
      success_url,
      cancel_url,
    });

    console.log("[Stripe] Session created:", session.id);
    return res.json({ url: session.url });

  } catch (err) {
    console.error("[Stripe] Create session error - message:", err.message);
    console.error("[Stripe] Create session error - stack:", err.stack);
    if (err.raw != null) console.error("[Stripe] Create session error - raw:", err.raw);
    return res.status(500).json({
      message: err.message || "Failed to create checkout session",
      raw: err.raw?.message ?? undefined,
    });
  }
};

/* ============================================================
   PROJECT CHECKOUT SESSION (NO PROJECT CREATED YET)
   Currency: JOD (3 decimal places) => unit_amount = amount * 1000

============================================================ */
export const createProjectCheckoutSession = async (req, res) => {
  const client = await pool.connect();
  try {
    // Check payment mode feature flag
    const paymentsMode = (process.env.PAYMENTS_MODE || "offline").toLowerCase();
    
    if (paymentsMode === "offline") {
      return res.status(400).json({
        success: false,
        message: "Stripe payments are currently disabled. Please use offline payment methods (CliQ or Cash).",
        code: "STRIPE_DISABLED",
      });
    }

    if (!process.env.STRIPE_SECRET_KEY || String(process.env.STRIPE_SECRET_KEY).trim() === "") {
      return res.status(500).json({
        success: false,
        message: "STRIPE_SECRET_KEY is not configured",
        code: null,
      });
    }

    const clientUrl = process.env.CLIENT_URL;
    if (!clientUrl || String(clientUrl).trim() === "") {
      return res.status(500).json({
        success: false,
        message: "CLIENT_URL is not configured (required for success/cancel URLs)",
        code: null,
      });
    }

    const userId = req.token.userId;
    const roleId = req.token.role || req.token.roleId;
    const projectData = req.body;
    const projectType = projectData.project_type;
    const title = projectData.title != null ? String(projectData.title).trim() : "";

    if (!title) {
      return res.status(400).json({
        success: false,
        message: "Project title is required",
        code: null,
      });
    }

    // Check if user can post without payment (internal clients)
    const userRes = await pool.query(
      `SELECT can_post_without_payment FROM users WHERE id = $1 AND is_deleted = false`,
      [userId]
    );
    const canPostWithoutPayment = userRes.rows[0]?.can_post_without_payment === true;
    const isInternalClient = Number(roleId) === 2 && canPostWithoutPayment;

    // If internal client, skip payment and return flag for frontend to create project directly
    if (isInternalClient) {
      return res.json({
        success: true,
        skipPayment: true,
        message: "Payment skipped for internal client. Please create project directly.",
      });
    }

    let unitAmount = 0;

    if (projectType === "fixed") {
      const budget = Number(projectData.budget);
      if (!Number.isFinite(budget) || budget <= 0) {
        return res.status(400).json({
          success: false,
          message: "Invalid budget for fixed project (must be a positive number)",
          code: null,
        });
      }
      unitAmount = toStripeAmount(budget);
    } else if (projectType === "hourly") {
      const hourlyRate = Number(projectData.hourly_rate);
      const durationHours = projectData.duration_hours != null
        ? Number(projectData.duration_hours)
        : null;
      if (!Number.isFinite(hourlyRate) || hourlyRate <= 0) {
        return res.status(400).json({
          success: false,
          message: "Invalid hourly_rate for hourly project (must be a positive number)",
          code: null,
        });
      }
      if (durationHours == null || !Number.isFinite(durationHours) || durationHours <= 0) {
        return res.status(400).json({
          success: false,
          message: "Invalid or missing duration_hours for hourly project",
          code: null,
        });
      }
      const amount = hourlyRate * durationHours;
      unitAmount = toStripeAmount(amount);
    } else {
      return res.status(400).json({
        success: false,
        message: "Bidding projects are paid later",
        code: null,
      });
    }

    if (unitAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: "Calculated amount must be greater than zero",
        code: null,
      });
    }

    const successUrl = `${clientUrl.replace(/\/$/, "")}/projects/payment-success?session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${clientUrl.replace(/\/$/, "")}/projects/payment-cancel`;


    const stripe = getStripe();
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "jod",
            product_data: {
              name: `Project: ${title}`,

            },
            unit_amount: unitAmount,
          },
          quantity: 1,
        },
      ],
      metadata: {
        user_id: String(userId),
        purpose: "project",
        project_data: JSON.stringify(projectData),
      },
      success_url: successUrl,
      cancel_url: cancelUrl,

    });

    return res.json({
      success: true,
      url: session.url,
      sessionId: session.id,
    });
  } catch (err) {
    console.error("createProjectCheckoutSession error:", {
      type: err.type,
      code: err.code,
      message: err.message,
      rawMessage: err.raw?.message,
      rawParam: err.raw?.param,
      rawDeclineCode: err.raw?.decline_code,
    });

    const isDev = process.env.NODE_ENV !== "production";
    const safeMessage = isDev
      ? (err.raw?.message ?? err.message ?? "Stripe error")
      : "Payment setup failed. Please try again.";
    const code = err.code ?? null;

    return res.status(err.statusCode || 500).json({
      success: false,
      message: safeMessage,
      code,
    });

  }
};

/* ============================================================
   OFFER ACCEPT CHECKOUT (BIDDING: CLIENT PAYS BID AMOUNT TO ACCEPT OFFER)
   بعد الدفع يُستدعى completeOfferAcceptance من confirmCheckoutSession
============================================================ */
export const createOfferAcceptCheckoutSession = async (req, res) => {
  try {
    if (!process.env.STRIPE_SECRET_KEY || String(process.env.STRIPE_SECRET_KEY).trim() === "") {
      return res.status(500).json({
        success: false,
        message: "STRIPE_SECRET_KEY is not configured",
      });
    }
    const clientUrl = process.env.CLIENT_URL;
    if (!clientUrl || String(clientUrl).trim() === "") {
      return res.status(500).json({
        success: false,
        message: "CLIENT_URL is not configured",
      });
    }

    const userId = req.token?.userId;
    const { offerId } = req.body;
    if (!userId || !offerId) {
      return res.status(400).json({
        success: false,
        message: "Missing offerId or not authenticated",
      });
    }

    const { rows } = await pool.query(
      `SELECT o.id, o.project_id, o.freelancer_id, o.bid_amount, o.offer_status,
              p.user_id AS client_id, p.title AS project_title, p.project_type
       FROM offers o
       JOIN projects p ON o.project_id = p.id
       WHERE o.id = $1 AND p.is_deleted = false`,
      [offerId]
    );
    if (!rows.length) {
      return res.status(404).json({ success: false, message: "Offer not found" });
    }
    const offer = rows[0];
    if (String(offer.client_id) !== String(userId)) {
      return res.status(403).json({ success: false, message: "Not authorized to pay for this offer" });
    }
    if (String(offer.offer_status) !== "pending") {
      return res.status(400).json({
        success: false,
        message: "Offer is no longer pending (already accepted or rejected)",
      });
    }
    if (String(offer.project_type) !== "bidding") {
      return res.status(400).json({
        success: false,
        message: "This offer is not for a bidding project",
      });
    }

    const amount = Number(offer.bid_amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid offer amount",
      });
    }
    const unitAmount = toStripeAmount(amount);

    const successUrl = `${clientUrl.replace(/\/$/, "")}/projects/payment-success?session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${clientUrl.replace(/\/$/, "")}/projects/payment-cancel`;

    const stripe = getStripe();
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "jod",
            product_data: {
              name: `Accept offer — ${offer.project_title}`,
              description: `Pay ${amount} JOD to accept this offer and assign the freelancer to the project.`,
            },
            unit_amount: unitAmount,
          },
          quantity: 1,
        },
      ],
      metadata: {
        user_id: String(userId),
        purpose: "offer",
        reference_id: String(offerId),
      },
      success_url: successUrl,
      cancel_url: cancelUrl,
    });

    return res.json({
      success: true,
      url: session.url,
      sessionId: session.id,
    });
  } catch (err) {
    console.error("createOfferAcceptCheckoutSession error:", err);
    return res.status(500).json({
      success: false,
      message: err.message || "Failed to create payment session",
    });
  }
};

/* ============================================================
   CONFIRM CHECKOUT SESSION (CREATE PROJECT AFTER PAYMENT)
============================================================ */
export const confirmCheckoutSession = async (req, res) => {
  try {
    const { session_id } = req.query;

    if (!session_id) {
      return res.status(400).json({ ok: false, error: "Missing session_id" });
    }

    // 1️⃣ Retrieve Stripe session
    const session = await getStripe().checkout.sessions.retrieve(session_id);

    if (session.payment_status !== "paid") {
      return res.status(400).json({ ok: false, error: "Payment not completed" });
    }

    const user_id = Number(session.metadata.user_id);
    const purpose = session.metadata.purpose;
    const includesVerificationFee =
      session.metadata.includes_verification_fee === "yes";

    const amount = session.amount_total / 1000;

    if (!user_id || !purpose) {
      return res.status(400).json({ ok: false, error: "Invalid metadata" });
    }

    // 2️⃣ Insert payment (idempotent)
    const paymentRes = await pool.query(
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
      VALUES ($1, $2, 'JOD', $3, NULL, $4, $5, 'paid')
      ON CONFLICT (stripe_session_id)
      DO UPDATE SET status = 'paid'
      RETURNING id;
      `,
      [
        user_id,
        amount,
        purpose,
        session.id,
        session.payment_intent,
      ]
    );

    const paymentId = paymentRes.rows[0].id;

    // 3️⃣ Verification fee logic (plans only)
    if (includesVerificationFee) {
      await pool.query(
        `
        UPDATE users
        SET is_verified = true
        WHERE id = $1 AND is_verified = false
        `,
        [user_id]
      );
    }

    // 4️⃣ PLAN LOGIC
    if (purpose === "plan") {
      const planId = Number(session.metadata.reference_id);

      const planRes = await pool.query(
        "SELECT duration, plan_type FROM plans WHERE id = $1",
        [planId]
      );

      if (planRes.rowCount === 0) {
        return res.status(404).json({ ok: false, error: "Plan not found" });
      }

      const plan = planRes.rows[0];
      const start = new Date();
      const end = new Date(start);

      if (plan.plan_type === "monthly") {
        end.setMonth(end.getMonth() + plan.duration);
      } else {
        end.setFullYear(end.getFullYear() + plan.duration);
      }

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
        VALUES ($1, $2, $3, $4, 'active', $5)
        ON CONFLICT (stripe_session_id) DO NOTHING
        `,
        [user_id, planId, start, end, session.id]
      );
    }

    // 5️⃣ PROJECT LOGIC (CREATE PROJECT AFTER PAYMENT)
    if (purpose === "project") {
      const projectData = JSON.parse(session.metadata.project_data);

      const { rows } = await pool.query(
        `
        INSERT INTO projects (
          user_id,
          title,
          description,
          project_type,
          budget,
          hourly_rate,
          category_id,
          status
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,'pending_admin')
        RETURNING id
        `,
        [
          user_id,
          projectData.title,
          projectData.description,
          projectData.project_type,
          projectData.budget || null,
          projectData.hourly_rate || null,
          projectData.category_id,
        ]
      );

      const projectId = rows[0].id;

      // Link payment → project
      await pool.query(
        `
        UPDATE payments
        SET reference_id = $1
        WHERE id = $2
        `,
        [projectId, paymentId]
      );
    }

    return res.json({ ok: true });

  } catch (err) {
    console.error("confirmCheckoutSession error:", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
};
