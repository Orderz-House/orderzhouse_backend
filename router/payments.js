import express from "express";
import { 
  getUserPayments, 
  getAllPayments 
} from "../controller/payments.js";

import adminOnly from "../middleware/adminOnly.js"; 

const PaymentsRouter = express.Router();

PaymentsRouter.get("/user/:user_id", getUserPayments);

PaymentsRouter.get("/admin/all", adminOnly, getAllPayments);

export default PaymentsRouter;
