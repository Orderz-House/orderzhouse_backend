import Stripe from "stripe";
import pool from "../../models/db.js";
import { fromStripeAmount } from "../../utils/stripeAmount.js";

// Initialize Stripe with secret key from env
const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";

if (!stripeSecretKey) {
  console.error("⚠️ STRIPE_SECRET_KEY is not configured in environment variables");
}

if (!webhookSecret) {
  console.warn("⚠️ Stripe webhook disabled: missing STRIPE_WEBHOOK_SECRET in environment variables");
  console.warn("   Webhook route will return 500 error if accessed. Add STRIPE_WEBHOOK_SECRET to .env to enable.");
} else {
  console.log("✅ Stripe webhook enabled (STRIPE_WEBHOOK_SECRET found)");
}

const stripe = stripeSecretKey ? new Stripe(stripeSecretKey) : null;

export const handleStripeWebhook = async (req, res) => {
  // ✅ Safe "not enabled yet" behavior
  if (!webhookSecret) {
    console.error("❌ Webhook accessed but STRIPE_WEBHOOK_SECRET is not configured");
    return res.status(500).json({
      received: false,
      error: "Webhook is not enabled. STRIPE_WEBHOOK_SECRET must be configured in environment variables.",
    });
  }

  if (!stripe) {
    console.error("❌ Webhook accessed but STRIPE_SECRET_KEY is not configured");
    return res.status(500).json({
      received: false,
      error: "Stripe is not configured. STRIPE_SECRET_KEY must be configured in environment variables.",
    });
  }

  const signature = req.headers["stripe-signature"];

  if (!signature) {
    console.error("⚠️ Webhook request missing stripe-signature header");
    return res.status(400).json({
      received: false,
      error: "Missing stripe-signature header",
    });
  }

  try {
    // Verify webhook signature using raw body
    const event = stripe.webhooks.constructEvent(
      req.body,
      signature,
      webhookSecret
    );

    // ======================================================
    //  CHECKOUT SUCCESSFUL
    // ======================================================
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;

      const freelancer_id = Number(session.metadata?.user_id);
      const plan_id = Number(session.metadata?.plan_id);
      const includesVerificationFee = session.metadata?.includes_verification_fee === "yes";

      if (!freelancer_id || !plan_id) {
        console.error("⚠️ Webhook: Missing required metadata", {
          freelancer_id,
          plan_id,
          session_id: session.id,
        });
        return res.status(400).json({
          received: false,
          error: "Missing required metadata: user_id or plan_id",
        });
      }

      const stripe_session_id = session.id;
      const stripe_payment_intent = session.payment_intent || null;
      const amount_total = fromStripeAmount(session.amount_total);

      // ✅ Transactional + Idempotent processing
      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        // ✅ Insert payment with ON CONFLICT DO NOTHING (idempotent)
        // Use correct schema: purpose='subscription', reference_id=plan_id
        const paymentResult = await client.query(
          `INSERT INTO payments (
            user_id,
            amount,
            currency,
            stripe_session_id,
            stripe_payment_intent,
            purpose,
            reference_id,
            status
          )
          VALUES ($1, $2, 'JOD', $3, $4, 'subscription', $5, 'paid')
          ON CONFLICT (stripe_session_id) DO NOTHING
          RETURNING id`,
          [freelancer_id, amount_total, stripe_session_id, stripe_payment_intent, plan_id]
        );

        // ✅ If payment already exists (rowCount=0), exit early (already processed)
        if (paymentResult.rowCount === 0) {
          console.log("💰 Payment already processed (idempotent skip):", stripe_session_id);
          await client.query("COMMIT");
          client.release();
          return res.json({ received: true, message: "Already processed" });
        }

        const paymentId = paymentResult.rows[0].id;
        console.log("💰 Payment saved:", amount_total, "JOD (payment_id:", paymentId, ")");

        // ✅ Verification fee logic (only if payment was newly inserted)
        if (includesVerificationFee) {
          await client.query(
            "UPDATE users SET is_verified = true WHERE id = $1",
            [freelancer_id]
          );
          console.log("✔️ User marked as verified (freelancer_id:", freelancer_id, ")");
        }

        // ✅ Referral logic: Check if this is first subscription BEFORE inserting
        // Count existing subscriptions to determine if this will be the first
        const existingSubscriptionsCount = await client.query(
          `SELECT COUNT(*) as count
           FROM subscriptions
           WHERE freelancer_id = $1`,
          [freelancer_id]
        );

        const isFirstSubscription = Number(existingSubscriptionsCount.rows[0]?.count || 0) === 0;

        // ✅ Create subscription as pending_start (NO dates set yet)
        // Dates will be calculated when activated on first accepted project
        // Note: stripe_session_id should have UNIQUE constraint for ON CONFLICT to work
        const subscriptionResult = await client.query(
          `INSERT INTO subscriptions (
            freelancer_id,
            plan_id,
            status,
            stripe_session_id,
            activated_at
          )
          VALUES ($1, $2, 'pending_start', $3, NULL)
          ON CONFLICT (stripe_session_id) DO NOTHING
          RETURNING id`,
          [freelancer_id, plan_id, stripe_session_id]
        );

        if (subscriptionResult.rowCount === 0) {
          console.log("🔥 Subscription already exists (idempotent skip):", stripe_session_id);
        } else {
          const subscriptionId = subscriptionResult.rows[0].id;
          console.log("🔥 Subscription created (pending_start) for freelancer:", freelancer_id, "(subscription_id:", subscriptionId, ")");
        }

        if (isFirstSubscription) {
          try {
            // Find pending referral for this user
            const referralResult = await client.query(
              `SELECT id, referrer_user_id, status
               FROM referrals
               WHERE referred_user_id = $1 AND status = 'pending'
               LIMIT 1`,
              [freelancer_id]
            );

            if (referralResult.rows.length > 0) {
              const referral = referralResult.rows[0];
              const referralId = referral.id;
              const referrerUserId = referral.referrer_user_id;

              // Get reward amounts (configurable)
              const referrerReward = 5.0; // JOD

              // Mark referral as completed
              await client.query(
                `UPDATE referrals
                 SET status = 'completed', completed_at = CURRENT_TIMESTAMP
                 WHERE id = $1`,
                [referralId]
              );

              // Create reward for referrer
              await client.query(
                `INSERT INTO referral_rewards (user_id, referral_id, amount, type)
                 VALUES ($1, $2, $3, 'referral')`,
                [referrerUserId, referralId, referrerReward]
              );

              console.log(
                `✅ Referral completed for user ${freelancer_id}, referrer ${referrerUserId} earned ${referrerReward} JOD`
              );
            }
          } catch (referralErr) {
            // Silently fail - referral completion is not critical
            console.error("⚠️ Referral completion error (non-critical):", referralErr.message);
          }
        }

        await client.query("COMMIT");
        client.release();

        return res.json({
          received: true,
          message: "Webhook processed successfully",
          payment_id: paymentId,
          subscription_created: subscriptionResult.rowCount > 0,
        });
      } catch (dbError) {
        await client.query("ROLLBACK");
        client.release();
        console.error("❌ Database error in webhook:", dbError);
        throw dbError;
      }
    }

    // Handle other event types if needed
    console.log("ℹ️ Webhook received unhandled event type:", event.type);
    return res.json({ received: true, message: "Event type not handled" });
  } catch (err) {
    console.error("⚠️ Webhook error:", err.message);
    
    // Return appropriate status based on error type
    if (err.type === "StripeSignatureVerificationError") {
      return res.status(400).json({
        received: false,
        error: "Invalid signature",
        message: "Webhook signature verification failed",
      });
    }

    return res.status(400).json({
      received: false,
      error: err.message,
    });
  }
};
