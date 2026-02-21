import express from "express";
import { authentication } from "../middleware/authentication.js";
import requireVerifiedWithSubscription from "../middleware/requireVerifiedWithSubscription.js";
import {
  sendOffer,
  getMyOffersForProject,
  getOffersForMyProjects,
  getOffersForProject,
  approveOrRejectOffer,
  getAllProjectForOffer,
  cancelOffer,
  getAcceptedOffers,
  checkMyPendingOffer,
  getPendingBiddingApprovals,
  adminApproveBiddingOffer,
  adminRejectBiddingOffer,
} from "../controller/offers.js";

const offersRouter = express.Router();

// Get all open bidding projects 
offersRouter.get(
  "/projects/open",
  authentication,
  requireVerifiedWithSubscription,
  getAllProjectForOffer
);

// Send an offer for a project
offersRouter.post(
  "/:projectId/offers",
  authentication,
  requireVerifiedWithSubscription,
  sendOffer
);

// Get all offers made by the logged-in freelancer for a specific project
offersRouter.get(
  "/:projectId/my-offers",
  authentication,
  requireVerifiedWithSubscription,
  getMyOffersForProject
);

// Get all offers for all projects owned by the logged-in client
offersRouter.get(
  "/my-projects/offers",
  authentication,
  getOffersForMyProjects
);

// Get offers for a specific project (client-owner only)
offersRouter.get(
  "/project/:projectId/offers",
  authentication,
  getOffersForProject
);

// Approve or reject an offer (client)
offersRouter.post(
  "/offers/approve-reject",
  authentication,
  approveOrRejectOffer
);


// Cancel (withdraw) a pending offer 
offersRouter.put(
  "/offers/:offerId/cancel",
  authentication,
  requireVerifiedWithSubscription,
  cancelOffer
);

//  Get accepted offers
offersRouter.get(
  "/offers/accepted",
  authentication,
  getAcceptedOffers
);

offersRouter.get(
  "/my/:projectId/pending",
  authentication,
  requireVerifiedWithSubscription,
  checkMyPendingOffer
);

// Admin endpoints for bidding approvals
offersRouter.get(
  "/admin/pending-bidding-approvals",
  authentication,
  getPendingBiddingApprovals
);

offersRouter.post(
  "/admin/projects/:projectId/approve-bidding-offer",
  authentication,
  adminApproveBiddingOffer
);

offersRouter.post(
  "/admin/projects/:projectId/reject-bidding-offer",
  authentication,
  adminRejectBiddingOffer
);

export default offersRouter;
