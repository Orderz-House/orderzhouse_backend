import Stripe from "stripe";
import pool from "../../models/db.js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

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

export const createProjectCheckoutSession = async (req, res) => {
  try {
    const { project_id } = req.body;
    const userId = req.token.userId;

    const { rows } = await pool.query(
      `SELECT * FROM projects WHERE id = $1 AND user_id = $2`,
      [project_id, userId]
    );

    if (!rows.length) {
      return res.status(404).json({ error: "Project not found" });
    }

    const project = rows[0];

    let amount = 0;

    if (project.project_type === "fixed") {
      amount = project.budget;
    } else if (project.project_type === "hourly") {
      amount = project.hourly_rate * 3; // minimum
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
            product_data: { name: project.title },
            unit_amount: Math.round(amount * 1000),
          },
          quantity: 1,
        },
      ],
      metadata: {
        user_id: String(userId),
        purpose: "project",
        reference_id: String(project.id),
      },
      success_url: `${process.env.CLIENT_URL}/projects/payment-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.CLIENT_URL}/projects/payment-cancel`,
    });

    return res.json({ url: session.url });

  } catch (err) {
    console.error("createProjectCheckoutSession error:", err);
    res.status(500).json({ error: "Stripe error" });
  }
};
