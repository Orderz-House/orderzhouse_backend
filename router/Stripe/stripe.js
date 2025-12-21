import express from "express";
import { createCheckoutSession } from "../../controller/Stripe/stripe.js";
import { confirmCheckoutSession } from "../../controller/Stripe/confirmCheckoutSession.js";
import { createProjectCheckoutSession } from "../../controller/Stripe/stripe.js";
import { authentication } from "../../middleware/authentication.js";

const StripeRouter = express.Router();

StripeRouter.post("/create-checkout-session", createCheckoutSession);
StripeRouter.post("/project-checkout-session", authentication,createProjectCheckoutSession);
StripeRouter.get("/confirm", confirmCheckoutSession);

export default StripeRouter;
