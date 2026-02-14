const freelancerOnly = (req, res, next) => {
  try {
    const tokenData = req.token;
    
    if (!tokenData) {
      return res.status(401).json({ 
        success: false, 
        message: "Unauthorized - No token provided" 
      });
    }

    const roleId = tokenData.role || tokenData.roleId;
    
    if (Number(roleId) !== 3) {
      return res.status(403).json({ 
        success: false, 
        message: "Plans are available for freelancers only." 
      });
    }

    next();
  } catch (error) {
    console.error("freelancerOnly error:", error);
    return res.status(500).json({ 
      success: false, 
      message: "Server error in freelancer verification" 
    });
  }
};

export default freelancerOnly;
