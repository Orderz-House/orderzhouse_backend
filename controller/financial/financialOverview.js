import { getFinancialOverview } from "./financialService.js";

export const getMyFinancialOverview = async (req, res) => {
  const userId = req.token?.userId;
  const role = req.token?.role;

  if (!userId || !role) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }

  try {
    const data = await getFinancialOverview(userId, role);
    return res.json({
      success: true,
      data,
    });
  } catch (err) {
    console.error("getMyFinancialOverview error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};
