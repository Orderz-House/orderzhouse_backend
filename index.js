import express from "express";
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
import liveScreenRoutes from "./router/LiveScreen.js";

dotenv.config();

// Start real-time deadline watcher
startDeadlineWatcher();

// Cleanup deactivated users every 20 mins
cron.schedule("*/20 * * * *", async () => {
  console.log("Running cleanupDeactivatedUsers cron job...");
  await cleanupDeactivatedUsers();
});

// Routers
import SubscriptionRouter from "./router/subscription.js";
import CoursesRouter from "./router/course.js";
import assignmentsRouter from "./router/assignments.js";
import VerificationRouter from "./router/verification.js";
import paymentsRoutes from "./router/payments.js";
import AdminUser from "./router/adminUser.js";
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
import Blogsrouter from "./router/blogs.js";
import freelancerCategoriesRouter from "./router/freelancerCategories.js";
import subscriptionsRoutes from "./router/subscription.js";
import emailVerificationRoutes from "./router/emailVerification.js";
import chatsRouter from "./router/chats.js";
import StripeRouter from "./router/Stripe/stripe.js";
import webhookRouter from "./router/Stripe/stripeWebhook.js";

// DB connection already imported above

const app = express();
const PORT = process.env.PORT || 5000; // Use Hostinger PORT

// Stripe webhook (needs raw body)
app.use("/stripe", webhookRouter);

// Body parser
app.use(express.json());

// CORS
app.use(cors({
  origin: [
    "https://orderzhouse.com",
    "http://localhost:5173",
    "http://localhost:5174",
    "https://darkgoldenrod-quail-976616.hostingersite.com"
  ],
  credentials: true,
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization','X-Requested-With']
}));

// Health endpoint
app.get("/health", (req, res) => res.send("OK"));

// Routers
app.use("/assignments", assignmentsRouter);
app.use("/verification", VerificationRouter);
app.use("/freelancerCategories", freelancerCategoriesRouter);
app.use("/blogs", Blogsrouter);
app.use("/admUser", AdminUser);
app.use("/category", categoriesRouter);
app.use("/tasks", tasksRouter);
app.use("/offers", offersRouter);
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

let server, io;

if (process.env.NODE_ENV !== "test") {
  server = http.createServer(app);
  const { default: initSocket } = await import("./sockets/socket.js");
  io = initSocket(server);

  const startServer = (portToUse) => {
    server.once("error", (err) => {
      if (err && err.code === "EADDRINUSE") {
        console.error(`⚠️ Port ${portToUse} in use. Retrying with a random free port...`);
        server.close(() => startServer(0));
        return;
      }
      throw err;
    });

    server.listen(portToUse, () => {
      const addressInfo = server.address();
      const boundPort =
        typeof addressInfo === "object" && addressInfo ? addressInfo.port : portToUse;
      console.log(`✅ Server listening at http://localhost:${boundPort}`);
    });
  };

  startServer(PORT);
} else {
  server = http.createServer(app);
  io = null;
}

export { app, server, io };
