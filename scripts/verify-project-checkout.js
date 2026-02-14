/**
 * Quick script to verify project checkout session creation (45 JOD).
 * Run from backendEsModule with env loaded:
 *   node -r dotenv/config scripts/verify-project-checkout.js
 * Requires: STRIPE_SECRET_KEY, CLIENT_URL in .env
 * Optional: set BASE_URL=http://localhost:5000
 */
const BASE = process.env.BASE_URL || "http://localhost:5000";

const body = {
  category_id: 2,
  sub_category_id: null,
  sub_sub_category_id: 56,
  title: "Verify checkout script",
  description: "Test",
  project_type: "fixed",
  budget: 45.0,
  hourly_rate: null,
  duration_type: "days",
  duration_days: 5,
  duration_hours: null,
  preferred_skills: [],
};

async function main() {
  console.log("POST", BASE + "/stripe/project-checkout-session");
  console.log("Body (budget 45 JOD):", JSON.stringify(body, null, 2));
  const res = await fetch(BASE + "/stripe/project-checkout-session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (res.ok && data.url) {
    console.log("OK – session.url:", data.url);
    console.log("sessionId:", data.sessionId);
    process.exit(0);
  }
  console.error("Failed:", res.status, data);
  process.exit(1);
}

main();
