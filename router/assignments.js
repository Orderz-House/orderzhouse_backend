import express from "express";
import { authentication } from "../middleware/authentication.js";
import { getAssignmentForFreelancer , checkIfAssigned} from "../controller/projectsManagment/assignments.js";

const assignmentsRouter = express.Router();
assignmentsRouter.get("/:projectId/my-assignment", authentication, getAssignmentForFreelancer);
assignmentsRouter.get("/:projectId/check", authentication, checkIfAssigned);



export default assignmentsRouter;
