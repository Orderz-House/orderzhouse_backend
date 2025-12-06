import express from "express";
import { submitRating, getRatingsForFreelancer } from "../controller/rating.js";
import { authentication } from "../middleware/authentication.js";

const ratingsRouter = express.Router();

ratingsRouter.post("/", authentication, submitRating); // Client submits a rating
ratingsRouter.get("/freelancer/:freelancerId", getRatingsForFreelancer); // Publicly viewable

export default ratingsRouter;
