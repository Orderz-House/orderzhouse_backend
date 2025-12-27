import Stripe from "stripe";
import pool from "../../models/db.js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

/* ============================================================
   PLAN CHECKOUT SESSION
============================================================ */
export const createCheckoutSession = async (req, res) => {
  try {
    const { plan_id, user_id } = req.body;

    if (!plan_id || !user_id) {
      return res.status(400).json({ error: "Missing plan_id or user_id" });
    }

    const planRes = await pool.query(
      "SELECT id, name, description, price FROM plans WHERE id = $1",
      [plan_id]
    );

    if (planRes.rowCount === 0) {
      return res.status(404).json({ error: "Plan not found" });
    }

    const userRes = await pool.query(
      "SELECT id, is_verified FROM users WHERE id = $1",
      [user_id]
    );

    if (userRes.rowCount === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    const plan = planRes.rows[0];
    const user = userRes.rows[0];

    const line_items = [
      {
        price_data: {
          currency: "jod",
          product_data: {
            name: plan.name,
            description: plan.description || undefined,
          },
          unit_amount: Math.round(Number(plan.price) * 1000),
        },
        quantity: 1,
      },
    ];

    // Optional verification fee
    if (!user.is_verified) {
      line_items.push({
        price_data: {
          currency: "jod",
          product_data: { name: "Account Verification Fee" },
          unit_amount: 25 * 1000,
        },
        quantity: 1,
      });
    }

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items,
      metadata: {
        user_id: String(user_id),
        purpose: "plan",
        reference_id: String(plan_id),
        includes_verification_fee: user.is_verified ? "no" : "yes",
      },
      success_url: `${process.env.CLIENT_URL}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.CLIENT_URL}/payment/cancel`,
    });

    return res.json({ url: session.url });

  } catch (err) {
    console.error("Stripe create session error:", err);
    return res.status(500).json({ error: "Stripe error" });
  }
};

/* ============================================================
   PROJECT CHECKOUT SESSION (NO PROJECT CREATED YET)
============================================================ */
export const createProjectCheckoutSession = async (req, res) => {
  try {
    const userId = req.token.userId;
    const projectData = req.body;

    let amount = 0;

    if (projectData.project_type === "fixed") {
      amount = projectData.budget;
    } else if (projectData.project_type === "hourly") {
      amount = projectData.hourly_rate * 3; // minimum
    } else {
      return res.status(400).json({ error: "Bidding paid later" });
    }

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "jod",
            product_data: {
              name: projectData.title,
            },
            unit_amount: Math.round(amount * 1000),
          },
          quantity: 1,
        },
      ],
      metadata: {
        user_id: String(userId),
        purpose: "project",
        project_data: JSON.stringify(projectData), // TEMP storage
      },
      success_url: `${process.env.CLIENT_URL}/projects/payment-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.CLIENT_URL}/projects/payment-cancel`,
    });

    return res.json({ url: session.url });

  } catch (err) {
    console.error("createProjectCheckoutSession error:", err);
    return res.status(500).json({ error: "Stripe error" });
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
    const session = await stripe.checkout.sessions.retrieve(session_id);

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
