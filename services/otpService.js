import nodemailer from "nodemailer";

// ✅ توليد OTP عشوائي مكوّن من 6 أرقام
export const generateOtp = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// ✅ إرسال OTP عبر البريد الإلكتروني
export const deliverOtp = async (destination, method, otp) => {
  if (method !== "email") {
    throw new Error("Only email method supported");
  }

  // إعداد SMTP (من حسابك، ليس إليه)
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.office365.com",
    port: process.env.SMTP_PORT || 587,
    secure: process.env.SMTP_SECURE === "true" ? true : false,
    auth: {
      user: process.env.EMAIL_USER, // FROM email
      pass: process.env.EMAIL_PASS, // App password
    },
  });

  const mailOptions = {
    from: `"OrderzHouse Support" <${process.env.EMAIL_USER}>`,
    to: destination, // send to user's email
    subject: "Your OTP Code - OrderzHouse",
    text: `Your verification code is: ${otp}`,
    html: `
      <div style="font-family:Arial,sans-serif;line-height:1.5;color:#333">
        <h2>Your OTP Code</h2>
        <p>Hello,</p>
        <p>Use the following OTP to complete your verification process:</p>
        <h3 style="background:#f2f2f2;padding:10px;border-radius:8px;width:max-content;">${otp}</h3>
        <p>This code will expire in 2 minutes.</p>
        <p>— OrderzHouse Team</p>
      </div>
    `,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log(`✅ OTP email sent to ${destination}`);
    return info;
  } catch (error) {
    console.error("❌ Failed to deliver OTP:", error);
    throw error;
  }
};
