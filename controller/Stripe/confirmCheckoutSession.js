import Stripe from "stripe";
import pool from "../../models/db.js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export const confirmCheckoutSession = async (req, res) => {
  try {
    const { session_id } = req.query;
    if (!session_id) {
      return res.status(400).json({ ok: false, error: "Missing session_id" });
    }

    // 1️⃣ Get session from Stripe 
    const session = await stripe.checkout.sessions.retrieve(session_id);

    if (session.payment_status !== "paid") {
      return res.status(400).json({ ok: false, error: "Payment not completed" });
    }

    const user_id = Number(session.metadata.user_id);
    const purpose = session.metadata.purpose; // 'plan' | 'project'
    const reference_id = Number(session.metadata.reference_id);
    const includesVerificationFee =
      session.metadata.includes_verification_fee === "yes";

    const amount = session.amount_total / 1000;

    if (!user_id || !purpose || !reference_id) {
      return res.status(400).json({ ok: false, error: "Invalid metadata" });
    }

    // 2️⃣ Insert payment (idempotent)
    await pool.query(
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
  VALUES ($1, $2, 'JOD', $3, $4, $5, $6, 'paid')
  ON CONFLICT (stripe_session_id)
  DO UPDATE SET status = 'paid';
  `,
  [
    user_id,
    amount,
    purpose,
    reference_id,
    session.id,
    session.payment_intent,
  ]
);


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

    // 4️⃣ PLAN LOGIC → create subscription
    if (purpose === "plan") {
      const planRes = await pool.query(
        "SELECT duration, plan_type FROM plans WHERE id = $1",
        [reference_id]
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
        ON CONFLICT (stripe_session_id) DO NOTHING;
        `,
        [user_id, reference_id, start, end, session.id]
      );
    }

    // 5️⃣ PROJECT LOGIC → move project to admin review
    if (purpose === "project") {
      await pool.query(
        `
        UPDATE projects
        SET status = 'pending_admin'
        WHERE id = $1 AND status = 'pending_payment'
        `,
        [reference_id]
      );
    }

    return res.json({ ok: true });

  } catch (err) {
    console.error("confirmCheckoutSession error:", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
};
