import Stripe from "stripe";
import pool from "../../models/db.js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export const handleStripeWebhook = async (req, res) => {
  const signature = req.headers["stripe-signature"];

  try {
    const event = stripe.webhooks.constructEvent(
      req.body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET
    );

    // ======================================================
    //  CHECKOUT SUCCESSFUL
    // ======================================================
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;

      const freelancer_id = session.metadata.user_id; 
      const plan_id = session.metadata.plan_id;
      const includesVerificationFee = session.metadata.includes_verification_fee;

      const stripe_session_id = session.id;
      const stripe_payment_intent = session.payment_intent;
      const amount_total = session.amount_total / 1000; 


     
      await pool.query(
        `INSERT INTO payments (user_id, plan_id, amount, stripe_session_id, stripe_payment_intent)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (stripe_session_id) DO NOTHING;`,
        [freelancer_id, plan_id, amount_total, stripe_session_id, stripe_payment_intent]
      );

      console.log("💰 Payment saved:", amount_total, "JOD");

      
      if (includesVerificationFee === "yes") {
        await pool.query(
          "UPDATE users SET is_verified = true WHERE id = $1",
          [freelancer_id]
        );
        console.log("✔️ User marked as verified");
      }

    
      const planRes = await pool.query(
        `SELECT duration, plan_type FROM plans WHERE id = $1`,
        [plan_id]
      );

      const plan = planRes.rows[0];

      let start_date = new Date();
      let end_date = new Date(start_date);

      if (plan.plan_type === "monthly") {
        end_date.setMonth(end_date.getMonth() + plan.duration);
      } else if (plan.plan_type === "yearly") {
        end_date.setFullYear(end_date.getFullYear() + plan.duration);
      } else {
        end_date.setMonth(end_date.getMonth() + 1);
      }

      const start_date_sql = start_date.toISOString().split("T")[0];
      const end_date_sql = end_date.toISOString().split("T")[0];

     
      await pool.query(
        `INSERT INTO subscriptions (freelancer_id, plan_id, start_date, end_date, status)
         VALUES ($1, $2, $3, $4, 'active')`,
        [freelancer_id, plan_id, start_date_sql, end_date_sql]
      );

      console.log("🔥 Subscription created for freelancer:", freelancer_id);
    }

    return res.json({ received: true });

  } catch (err) {
    console.error("⚠️ Webhook error:", err);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }
};


