import express from "express";
import { search } from "../controller/search.js";

const searchRouter = express.Router();

// Public search endpoint
searchRouter.get("/", search);

export default searchRouter;
