import express from "express";
import rateLimit from "express-rate-limit";
import cookieParser from "cookie-parser";
import "./models/db.js";
import cors from "cors";
import http from "http";
import dotenv from "dotenv";
import cron from "node-cron";
import "./services/notificationListeners.js";

// Cron jobs
import "./cron/expireSubscriptions.js";
import "./cron/autoExpireOldOffers.js";
import { startDeadlineWatcher } from "./cron/realTimeDeadlineWatcher.js";
import { cleanupDeactivatedUsers } from "./cron/cleanupDeactivatedUsers.js";
import { registerTenderVaultRotationJobs } from "./cron/tenderVaultRotation.js";
import liveScreenRoutes from "./router/LiveScreen.js";

dotenv.config();

// Check email configuration (Resend) so OTP works everywhere
const hasEmailConfig = !!(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
console.log(`📧 Email configured: ${hasEmailConfig ? "✅ YES (Resend API key and EMAIL_FROM set)" : "❌ NO (OTP emails will fail)"}`);
if (!hasEmailConfig) {
  console.warn("⚠️  Set RESEND_API_KEY and EMAIL_FROM for OTP emails to work.");
}

// Start real-time deadline watcher
startDeadlineWatcher();

// delete permanently after 30 days
cron.schedule("*/20 * * * *", async () => {
console.log("Running cleanupDeactivatedUsers cron job...");
  await cleanupDeactivatedUsers();
});

// Register Tender Vault Rotation System cron jobs
registerTenderVaultRotationJobs();



// Routers
import SubscriptionRouter from "./router/subscription.js";
import CoursesRouter from "./router/course.js";
import assignmentsRouter from "./router/assignments.js";
import VerificationRouter from "./router/verification.js";
import paymentsRoutes from "./router/payments.js";
import AdminUser from "./router/adminUser.js"
import tasksRouter from "./router/tasks.js";
import usersRouter from "./router/user.js";
import plansRouter from "./router/plans.js";
import logsRouter from "./router/logs.js";
import projectsRouter from "./router/projects.js";
import categoriesRouter from "./router/category.js";
import notificationsRouter from "./router/notifications.js";
import authRouter from "./router/auth.js";
import offersRouter from "./router/offers.js";
import ratingsRouter from "./router/rating.js";
import Blogsrouter from "./router/blogs.js"
import freelancerCategoriesRouter from "./router/freelancerCategories.js";
import subscriptionsRoutes from "./router/subscription.js";
//import analyticsRoutes from "./router/analytics.js";
import emailVerificationRoutes from "./router/emailVerification.js";
import chatsRouter from "./router/chats.js";
import StripeRouter from "./router/Stripe/stripe.js";
import webhookRouter from "./router/Stripe/stripeWebhook.js";
import searchRouter from "./router/search.js";
import referralsRouter from "./router/referrals.js";
import tenderVaultRouter from "./router/tenderVault.js";


// DB connection
dotenv.config();

const app = express();
const PORT = process.env.NODE_ENV === "test" ? 0 : process.env.PORT || 5000;

if (process.env.NODE_ENV !== "test") {
  app.set("trust proxy", 1);
  
}

// ✅ Stripe webhook needs the raw body (mounted BEFORE express.json())
// This ensures the webhook route gets raw body for signature verification
app.use("/stripe", webhookRouter);

app.use(express.json());
app.use(cookieParser());

// CORS configuration - supports both local and production
const allowedOrigins = [
  process.env.FRONTEND_URL,
  "https://orderzhouse.com",
  "https://www.orderzhouse.com",
  "http://localhost:5173",
  "http://localhost:5174"
].filter(Boolean); // Remove undefined values

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or Postman)
    if (!origin) return callback(null, true);
    
    // Check if origin is in allowed list
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      // In development, allow all origins for easier testing
      if (process.env.NODE_ENV === "development") {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  exposedHeaders: ['Content-Type', 'Authorization']
}));

// Global rate limiter for all API routes (does not apply to /stripe webhook mounted above)
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many requests, please try again later." },
});
app.use(globalLimiter);

// Stricter limiter for auth endpoints (environment-aware)
const isDevelopment = process.env.NODE_ENV === "development";
const authMaxRequests = isDevelopment ? 1000 : 20; // 20 per 15 min: protects from brute force, allows typos/retries

// Log rate limit configuration on startup
console.log(`🔒 Auth Rate Limiter: ${authMaxRequests} requests per 15 minutes (${isDevelopment ? "DEVELOPMENT" : "PRODUCTION"} mode)`);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: authMaxRequests,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many login/register attempts, please try later." },
  // Skip rate limiting in development if needed (uncomment if still having issues)
  // skip: (req) => isDevelopment,
});
app.use("/users/login", authLimiter);
app.use("/users/register", authLimiter);

// Stricter limiter for password reset (do not leak email existence)
const passwordResetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many password reset attempts. Please try again later." },
});
app.use("/users/forgot-password", passwordResetLimiter);
app.use("/users/reset-password", passwordResetLimiter);

// ============================================================
// 🧪 TEMP TEST ROUTES - Direct in index.js (MUST BE FIRST!)
// ============================================================

app.get("/payments/history", (req, res) => {
  console.log("✅ TEMP /payments/history route HIT!");
  res.json({
    success: true,
    message: "TEMP payments/history working!",
    data: { items: [], page: 1, limit: 50, type: "all" },
  });
});
// ============================================================

// Routers
//APPOINTMENTS
app.use("/assignments", assignmentsRouter);
app.use("/verification", VerificationRouter);
app.use("/freelancerCategories", freelancerCategoriesRouter);
app.use("/blogs", Blogsrouter)
app.use("/admUser" , AdminUser)
app.use("/category" , categoriesRouter);
app.use("/tasks", tasksRouter);
app.use("/offers", offersRouter);
//app.use("/analytics", analyticsRoutes);
app.use("/projects", projectsRouter);
app.use("/users", usersRouter);
app.use("/plans", plansRouter);
app.use("/logs", logsRouter);
app.use("/courses", CoursesRouter);
app.use("/subscriptions", subscriptionsRoutes);
app.use("/chats", chatsRouter);
app.use("/notifications", notificationsRouter);
app.use("/auth", authRouter);
app.use("/ratings", ratingsRouter);
app.use("/email", emailVerificationRoutes);
app.use("/payments", paymentsRoutes);
app.use("/chat", chatsRouter);
app.use("/api", liveScreenRoutes);
app.use("/stripe", StripeRouter);
app.use("/search", searchRouter);
app.use("/referrals", referralsRouter);
app.use("/tender-vault", tenderVaultRouter);

let server, io;

if (process.env.NODE_ENV !== "test") {
  server = http.createServer(app);
  const { default: initSocket } = await import("./sockets/socket.js");
  io = initSocket(server);

  const startServer = (portToUse) => {
    server.once("error", (err) => {
      if (err && err.code === "EADDRINUSE") {
        console.error(
          `⚠️ Port ${portToUse} in use. Retrying with a random free port...`
        );
        server.close(() => startServer(0));
        return;
      }
      throw err;
    });

    server.listen(portToUse, () => {
      const addressInfo = server.address();
      const boundPort =
        typeof addressInfo === "object" && addressInfo
          ? addressInfo.port
          : portToUse;

      console.log(`✅ Server listening at http://localhost:${boundPort}`);
    });
  };

  startServer(PORT);
} else {
  // For tests, create minimal server without socket.io
  server = http.createServer(app);
  io = null;
}

export { app, server, io };