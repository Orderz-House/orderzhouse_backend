import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { LogCreators, ACTION_TYPES } from "../services/loggingService.js";
import { NotificationCreators } from "../services/notificationService.js"; // تركته زي ما هو
import eventBus from "../events/eventBus.js"; // ✅ ADDED
import nodemailer from "nodemailer";
import pool from "../models/db.js";
import cloudinary from "../cloudinary/setupfile.js";
import { Readable } from "stream";
import dotenv from "dotenv";

dotenv.config();

/* =========================================
   CLOUDINARY UPLOAD HELPER
========================================= */
const uploadFilesToCloudinary = async (files, folder) => {
  const uploadedFiles = [];

  for (const file of files) {
    const result = await new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        { resource_type: "auto", folder },
        (error, result) => (error ? reject(error) : resolve(result))
      );
      Readable.from(file.buffer).pipe(uploadStream);
    });

    uploadedFiles.push({
      url: result.secure_url,
      public_id: result.public_id,
      name: file.originalname,
      size: file.size,
    });
  }

  return uploadedFiles;
};

/* =========================================
   EMAIL TRANSPORTER
========================================= */
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT),
  secure: process.env.SMTP_SECURE === "true",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

/* =========================================
   OTP HELPERS
========================================= */
const generateOtp = () =>
  Math.floor(100000 + Math.random() * 900000).toString();

/**
 * إرسال OTP إما على الإيميل أو (مستقبلاً) SMS
 */
const deliverOtp = async (destination, method, otp) => {
  try {
    if (method === "sms") {
      // لو حابب تركّب Twilio أو غيره لاحقاً
      console.log(
        `[OTP - SMS] To: ${destination} | Code: ${otp} (integrate SMS provider here)`
      );
      return;
    }

    // الوضع الافتراضي: إيميل
    const mailOptions = {
      from: `"OrderzHouse" <${process.env.EMAIL_FROM}>`,
      to: destination,
      subject: "Your login verification code",
      html: `
        <h2>Login verification</h2>
        <p>Use the following One-Time Password (OTP) to complete your login:</p>
        <h1 style="color:#007bff; font-size: 26px; letter-spacing:4px;">${otp}</h1>
        <p>This code expires in <b>2 minutes</b>.</p>
        <br/>
        <p>Thanks,<br/>OrderzHouse Team</p>
      `,
    };

    await transporter.sendMail(mailOptions);
  } catch (err) {
    console.error("deliverOtp error:", err);
    throw err;
  }
};

/* ======================================================
   REGISTER
====================================================== */
const register = async (req, res) => {
  const client = await pool.connect();

  try {
    const {
      role_id,
      first_name,
      last_name,
      email,
      password,
      phone_number,
      country,
      username,

      // ✅ NEW: freelancer chooses multiple main categories
      category_ids = [],
    } = req.body;

    /* =========================
       BASIC VALIDATION
    ========================= */
    if (
      !role_id ||
      !first_name ||
      !last_name ||
      !email ||
      !password ||
      !phone_number ||
      !country ||
      !username
    ) {
      return res.status(400).json({
        success: false,
        message: "All fields are required",
      });
    }

    const roleId = parseInt(role_id, 10);
    if (Number.isNaN(roleId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid role_id",
      });
    }

    const emailLower = email.toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const passwordRegex = /^(?=.*[A-Z])(?=.*[a-z])(?=.*\d).{8,}$/;

    if (!emailRegex.test(emailLower)) {
      return res.status(400).json({
        success: false,
        message: "Invalid email format",
      });
    }

    if (!passwordRegex.test(password)) {
      return res.status(400).json({
        success: false,
        message:
          "Password must be at least 8 chars, include upper, lower, number",
      });
    }

    /* =========================
       FREELANCER VALIDATION
    ========================= */
    if (roleId === 3) {
      if (!Array.isArray(category_ids)) {
        return res.status(400).json({
          success: false,
          message: "category_ids must be an array",
        });
      }

      if (category_ids.length === 0) {
        return res.status(400).json({
          success: false,
          message: "At least one category is required for freelancers",
        });
      }

      // optional safety limit
      if (category_ids.length > 5) {
        return res.status(400).json({
          success: false,
          message: "Maximum 5 categories allowed",
        });
      }
    }

    /* =========================
       START TRANSACTION
    ========================= */
    await client.query("BEGIN");

    /* =========================
       UNIQUE USER CHECK
    ========================= */
    const existingUser = await client.query(
      "SELECT id FROM users WHERE email = $1 OR username = $2",
      [emailLower, username]
    );

    if (existingUser.rows.length > 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        success: false,
        message: "Email or username already exists",
      });
    }

    /* =========================
       CATEGORY VALIDATION (MAIN ONLY)
    ========================= */
    if (roleId === 3) {
      const categoryCheck = await client.query(
        `SELECT id
         FROM categories
         WHERE is_deleted = false
           AND level = 0
           AND id = ANY($1::int[])`,
        [category_ids]
      );

      if (categoryCheck.rows.length !== category_ids.length) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          success: false,
          message: "One or more category_ids are invalid",
        });
      }
    }

    /* =========================
       CREATE USER
    ========================= */
    const hashedPassword = await bcrypt.hash(password, 10);

    const userResult = await client.query(
      `INSERT INTO users
        (role_id, first_name, last_name, email, password, phone_number, country, username, email_verified)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,FALSE)
       RETURNING id, email, first_name`,
      [
        roleId,
        first_name,
        last_name,
        emailLower,
        hashedPassword,
        phone_number,
        country,
        username,
      ]
    );

    const user = userResult.rows[0];

    /* =========================
       FREELANCER → MULTI CATEGORIES
    ========================= */
    if (roleId === 3) {
      await client.query(
        `INSERT INTO freelancer_categories (freelancer_id, category_id)
         SELECT $1, unnest($2::int[])`,
        [user.id, category_ids]
      );
    }

    /* =========================
       EMAIL OTP
    ========================= */
    const otp = generateOtp();
    const otpExpiry = new Date(Date.now() + 5 * 60 * 1000);

    await client.query(
      `UPDATE users
       SET email_otp = $1, email_otp_expires = $2
       WHERE id = $3`,
      [otp, otpExpiry, user.id]
    );

    await transporter.sendMail({
      from: `"OrderzHouse" <${process.env.EMAIL_FROM}>`,
      to: user.email,
      subject: "Verify your email",
      html: `
        <h2>Hello ${user.first_name}</h2>
        <p>Your verification code:</p>
        <h1>${otp}</h1>
        <p>Expires in 5 minutes</p>
      `,
    });

    /* =========================
       COMMIT
    ========================= */
    await client.query("COMMIT");

    return res.status(201).json({
      success: true,
      message: "Registered successfully. OTP sent ✅",
      user_id: user.id,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("REGISTER ERROR:", err);
    return res.status(500).json({
      success: false,
      message: "Registration failed",
      error: err.message,
    });
  } finally {
    client.release();
  }
};

/* ======================================================
   VERIFY EMAIL OTP
====================================================== */
const verifyEmailOtp = async (req, res) => {
  const { email, otp } = req.body;

  if (!email || !otp) {
    return res
      .status(400)
      .json({ success: false, message: "Email and OTP are required" });
  }

  try {
    const { rows } = await pool.query(
      "SELECT id, email_otp, email_otp_expires FROM users WHERE email = $1",
      [email.toLowerCase()]
    );

    if (rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    const user = rows[0];

    if (user.email_otp !== otp) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid OTP" });
    }

    if (new Date() > new Date(user.email_otp_expires)) {
      return res.status(400).json({
        success: false,
        message: "OTP expired",
      });
    }

    await pool.query(
      "UPDATE users SET email_verified = TRUE, email_otp = NULL, email_otp_expires = NULL WHERE id = $1",
      [user.id]
    );

    return res.status(200).json({
      success: true,
      message: "Email verified successfully ✅",
    });
  } catch (err) {
    console.error("Verify Email OTP Error:", err);
    return res
      .status(500)
      .json({ success: false, message: "Server error" });
  }
};

/* ======================================================
   LOGIN + OTP
====================================================== */
// داخل controller/user.js

const DEACTIVATION_GRACE_DAYS = 30;

const login = async (req, res) => {
  try {
    const { email, password, otpMethod = "email" } = req.body;
    if (!email || !password) {
      return res
        .status(400)
        .json({ success: false, message: "Email and password required" });
    }

    const { rows } = await pool.query(
      "SELECT * FROM users WHERE email=$1",
      [email.toLowerCase()]
    );
    const user = rows[0];

    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    // لو الإيميل مش مفاعَل
    if (!user.email_verified) {
      return res.status(403).json({
        success: false,
        message: "Please verify your email before logging in",
      });
    }

    // لو الأكاونت معطّل
    if (user.is_deleted) {
      if (user.deactivated_at) {
        const deactivatedAt = new Date(user.deactivated_at);
        const now = new Date();
        const diffMs = now - deactivatedAt;
        const diffDays = diffMs / (1000 * 60 * 60 * 24);

        // خلّص فترة السماح
        if (diffDays > DEACTIVATION_GRACE_DAYS) {
          return res.status(410).json({
            success: false,
            message:
              "Your account has been permanently deleted after 30 days of deactivation.",
          });
        }
        // أقل من 30 يوم → ممكن نرجّعه Active بعد ما نتأكد من الباسورد
      } else {
        // is_deleted = TRUE بدون deactivated_at → احتمال حظر أدمن
        return res.status(403).json({
          success: false,
          message:
            "Your account is suspended. Please contact support.",
        });
      }
    }

    const validPassword = await bcrypt.compare(password, user.password);

    if (validPassword) {
      // لو الأكاونت كان معطَّل ضمن فترة السماح → رجعه Active
      if (user.is_deleted && user.deactivated_at) {
        await pool.query(
          `
          UPDATE users
          SET 
            is_deleted = FALSE,
            deactivated_at = NULL,
            reason_for_disruption = NULL
          WHERE id = $1
          `,
          [user.id]
        );
        user.is_deleted = false;
        user.deactivated_at = null;
        user.reason_for_disruption = null;
      }

      // لو مافي محاولات فاشلة → Login مباشر بدون OTP
      if ((user.failed_login_attempts || 0) === 0) {
        await pool.query(
          "UPDATE users SET otp_code=NULL, otp_expires=NULL, failed_login_attempts=0 WHERE id=$1",
          [user.id]
        );

        const tokenPayload = {
          userId: user.id,
          role: user.role_id,
          is_verified: user.email_verified,
          username: user.username,
          is_deleted: user.is_deleted,
          is_two_factor_enabled: user.is_two_factor_enabled,
        };

        const token = jwt.sign(tokenPayload, process.env.JWT_SECRET, {
          expiresIn: "1d",
        });

        return res.status(200).json({
          success: true,
          message: "Login successful",
          token,
          userInfo: {
            id: user.id,
            username: user.username,
            email: user.email,
            role_id: user.role_id,
            first_name: user.first_name,
            last_name: user.last_name,
            profile_pic_url: user.profile_pic_url,
            is_deleted: user.is_deleted,
            is_two_factor_enabled: user.is_two_factor_enabled,
            email_verified: user.email_verified,
          },
        });
      }

      // لو فيه محاولات فاشلة قديمة → صفّر العداد وخليه يكمل على OTP
      await pool.query(
        "UPDATE users SET failed_login_attempts=0 WHERE id=$1",
        [user.id]
      );
    } else {
      const newAttempts = (user.failed_login_attempts || 0) + 1;
      await pool.query(
        "UPDATE users SET failed_login_attempts=$1 WHERE id=$2",
        [newAttempts, user.id]
      );

      if (newAttempts < 3) {
        return res.status(401).json({
          success: false,
          message: "Invalid credentials",
        });
      }
    }

    // من هون وطالع → يا باسورد غلط أكثر من مرة أو عندنا login مشبوه → نرسل OTP
    const otp = generateOtp();
    const expiresAt = new Date(Date.now() + 2 * 60 * 1000); // 2 دقائق

    await pool.query(
      "UPDATE users SET otp_code=$1, otp_expires=$2 WHERE id=$3",
      [otp, expiresAt, user.id]
    );

    const destination =
      otpMethod === "email" ? user.email : user.phone_number;
    await deliverOtp(destination, otpMethod, otp);

    return res.status(200).json({
      success: true,
      message: "OTP sent successfully",
      user_id: user.id,
      username: user.username,
    });
  } catch (err) {
    console.error("Login Error:", err);
    return res
      .status(500)
      .json({ success: false, message: "Server error" });
  }
};

/* ======================================================
   VERIFY OTP (LOGIN)
====================================================== */
const verifyOTP = async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res
        .status(400)
        .json({ success: false, message: "Email and OTP are required" });
    }

    const { rows } = await pool.query("SELECT * FROM users WHERE email=$1", [
      email.toLowerCase(),
    ]);
    const user = rows[0];

    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    if (user.otp_code !== otp) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid OTP" });
    }

    if (!user.otp_expires || new Date() > new Date(user.otp_expires)) {
      return res
        .status(400)
        .json({ success: false, message: "OTP expired" });
    }

    await pool.query(
      "UPDATE users SET otp_code=NULL, otp_expires=NULL, failed_login_attempts=0 WHERE id=$1",
      [user.id]
    );

    const tokenPayload = {
      userId: user.id,
      role: user.role_id,
      is_verified: user.email_verified,
      username: user.username,
      is_deleted: user.is_deleted,
      is_two_factor_enabled: user.is_two_factor_enabled,
    };

    const token = jwt.sign(tokenPayload, process.env.JWT_SECRET, {
      expiresIn: "1d",
    });

    return res.status(200).json({
      success: true,
      message: "Login successful",
      token,
      userInfo: {
        id: user.id,
        username: user.username,
        email: user.email,
        role_id: user.role_id,
        first_name: user.first_name,
        last_name: user.last_name,
        profile_pic_url: user.profile_pic_url,
        is_deleted: user.is_deleted,
        is_two_factor_enabled: user.is_two_factor_enabled,
        email_verified: user.email_verified,
      },
    });
  } catch (error) {
    console.error("Verify OTP Error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Server error" });
  }
};
/* ======================================================
   SEND OTP (MANUAL API)
====================================================== */
const sendOtpController = async (req, res) => {
  try {
    const { email, method = "email" } = req.body;
    if (!email)
      return res
        .status(400)
        .json({ success: false, message: "Email required" });

    const otp = generateOtp();
    const expires = new Date(Date.now() + 2 * 60 * 1000);

    await pool.query(
      "UPDATE users SET otp_code = $1, otp_expires = $2 WHERE email = $3",
      [otp, expires, email.toLowerCase()]
    );

    await deliverOtp(email, method, otp);
    return res.status(200).json({ success: true, message: "OTP sent" });
  } catch (err) {
    console.error("sendOtpController Error:", err);
    return res.status(500).json({
      success: false,
      message: "Login error",
      error: err.message,
    });
  }
};

/* =========================================
   EDIT USER PROFILE 
========================================= */
const editUserSelf = async (req, res) => {
  const userId = req.token.userId;
  const {
    first_name,
    last_name,
    username,
    phone_number,
    country,
    profile_pic_url,
  } = req.body;

  try {
    let finalProfileUrl = profile_pic_url;

    if (req.files && req.files.length > 0) {
      const uploaded = await uploadFilesToCloudinary(
        req.files,
        "users/profile_pics"
      );
      finalProfileUrl = uploaded[0].url;
    }

    const result = await pool.query(
      `UPDATE users
       SET
         first_name = COALESCE($1, first_name),
         last_name = COALESCE($2, last_name),
         username = COALESCE($3, username),
         phone_number = COALESCE($4, phone_number),
         country = COALESCE($5, country),
         profile_pic_url = COALESCE($6, profile_pic_url),
         updated_at = NOW()
       WHERE id = $7 AND is_deleted = FALSE
       RETURNING id, first_name, last_name, username, email, phone_number, country, profile_pic_url, is_deleted, is_two_factor_enabled, email_verified`,
      [
        first_name,
        last_name,
        username,
        phone_number,
        country,
        finalProfileUrl,
        userId,
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Profile updated successfully",
      user: result.rows[0],
    });
  } catch (err) {
    console.error("editUserSelf Error:", err.message);
    return res
      .status(500)
      .json({ success: false, message: "Error updating profile" });
  }
};

/* =========================================
   UPLOAD PROFILE PIC (ONE FILE)
========================================= */
const uploadProfilePic = async (req, res) => {
  const userId = req.token.userId;

  try {
    if (!req.file) {
      return res
        .status(400)
        .json({ success: false, message: "No file uploaded" });
    }

    const uploadStream = cloudinary.uploader.upload_stream(
      { folder: "users/profile_pics", resource_type: "image" },
      async (error, result) => {
        if (error) {
          console.error("Cloudinary Upload Error:", error);
          return res
            .status(500)
            .json({ success: false, message: "Error uploading image" });
        }

        const { rows } = await pool.query(
          `UPDATE users
           SET profile_pic_url = $1, updated_at = NOW()
           WHERE id = $2 AND is_deleted = FALSE
           RETURNING profile_pic_url, is_deleted, is_two_factor_enabled, email_verified`,
          [result.secure_url, userId]
        );

        return res.status(200).json({
          success: true,
          message: "Profile picture uploaded successfully",
          url: rows[0].profile_pic_url,
        });
      }
    );

    Readable.from(req.file.buffer).pipe(uploadStream);
  } catch (err) {
    console.error("uploadProfilePic Error:", err.message);
    return res.status(500).json({
      success: false,
      message: "Server error uploading profile picture",
    });
  }
};

/* =========================================
   RATE FREELANCER
========================================= */
const rateFreelancer = async (req, res) => {
  const reviewerName = req.token.username;
  const { userId, rating, projectId } = req.body;

  if (!userId || !rating) {
    return res.status(400).json({
      success: false,
      message: "userId and rating are required",
    });
  }

  try {
    const freelancerResult = await pool.query(
      "SELECT role_id, rating_sum, rating_count FROM users WHERE id = $1 AND is_deleted = FALSE",
      [userId]
    );

    if (freelancerResult.rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Freelancer not found" });
    }

    const freelancer = freelancerResult.rows[0];

    if (freelancer.role_id !== 3) {
      return res.status(403).json({
        success: false,
        message: "Target user is not a freelancer",
      });
    }

    const newSum = Number(freelancer.rating_sum) + Number(rating);
    const newCount = Number(freelancer.rating_count) + 1;
    const newAvg = (newSum / newCount).toFixed(2);

    const updateResult = await pool.query(
      `UPDATE users
       SET rating_sum = $1, rating_count = $2, rating = $3
       WHERE id = $4
       RETURNING id, first_name, last_name, rating, rating_count`,
      [newSum, newCount, newAvg, userId]
    );

    try {
      // ✅ EVENT BUS بدل NotificationCreators
      eventBus.emit("rating.submitted", {
        ratingId: null,
        projectId: projectId || null,
        freelancerId: userId,
        clientId: req.token?.userId || null,
        clientName: reviewerName || "A client",
        rating,
        comment: null,
      });
    } catch (notificationError) {
      console.error(
        `Failed to emit rating.submitted event for freelancer ${userId}:`,
        notificationError
      );
    }

    return res.status(200).json({
      success: true,
      message: "Freelancer rated successfully",
      freelancer: updateResult.rows[0],
    });
  } catch (err) {
    console.error("Rating error:", err.message);
    return res.status(500).json({
      success: false,
      message: "Server error during rating",
      error: err.message,
    });
  }
};

/* =========================================
   GET USER DATA (للفرونت)
========================================= */
const getUserdata = async (req, res) => {
  const userId = req.token.userId;

  try {
    const user = await pool.query(
      `SELECT 
         id,
         first_name,
         last_name,
         email,
         username,
         role_id,
         profile_pic_url,
         phone_number,
         country,
         bio,
         rating,
         rating_sum,
         rating_count,
         is_deleted,
         is_two_factor_enabled,
         email_verified,
         created_at,
         updated_at
       FROM users 
       WHERE id = $1`,
      [userId]
    );

    if (!user.rows.length) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    return res.json({
      success: true,
      user: user.rows[0],
    });
  } catch (err) {
    console.error("getUserdata error:", err);
    return res
      .status(500)
      .json({ success: false, message: "Server error" });
  }
};

/* =========================================
   PASSWORD & ACCOUNT MANAGEMENT
========================================= */

const verifyPassword = async (req, res) => {
  const { password } = req.body;
  const userId = req.token.userId;

  try {
    const userResult = await pool.query(
      "SELECT password FROM users WHERE id = $1 AND is_deleted = FALSE",
      [userId]
    );

    if (userResult.rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    const hashedPassword = userResult.rows[0].password;

    if (!password || !hashedPassword) {
      return res.status(400).json({
        success: false,
        message: "Password or hashed password missing",
      });
    }

    const match = await bcrypt.compare(password, hashedPassword);

    return res.json({
      success: match,
      message: match ? "Password verified" : "Incorrect password",
    });
  } catch (error) {
    console.error("Verify Password Error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error during password verification",
    });
  }
};

const updatePassword = async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const userId = req.token.userId;
  const passwordRegex = /^(?=.*[A-Z])(?=.*[a-z])(?=.*\d).{8,}$/;

  if (!currentPassword || !newPassword) {
    return res.status(400).json({
      success: false,
      message: "Current and new passwords are required",
    });
  }

  if (!passwordRegex.test(newPassword)) {
    return res.status(400).json({
      success: false,
      message: "New password does not meet complexity requirements.",
    });
  }

  try {
    const userResult = await pool.query(
      "SELECT password FROM users WHERE id = $1 AND is_deleted = FALSE",
      [userId]
    );

    if (userResult.rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    const match = await bcrypt.compare(
      currentPassword,
      userResult.rows[0].password
    );

    if (!match) {
      return res.status(400).json({
        success: false,
        message: "Current password is incorrect",
      });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await pool.query("UPDATE users SET password = $1 WHERE id = $2", [
      hashedPassword,
      userId,
    ]);

    await LogCreators.userAuth(
      userId,
      ACTION_TYPES.PASSWORD_CHANGE,
      true,
      { ip: req.ip }
    );

    return res.json({
      success: true,
      message: "Password updated successfully",
    });
  } catch (error) {
    console.error("Update Password Error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error during password update",
    });
  }
};

const deactivateAccount = async (req, res) => {
  const userId = req.token.userId;
  const { reason } = req.body; 
  try {
    const userCheck = await pool.query(
      "SELECT id, is_deleted FROM users WHERE id = $1",
      [userId]
    );

    if (userCheck.rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    if (userCheck.rows[0].is_deleted) {
      return res.status(400).json({
        success: false,
        message: "Account is already deactivated",
      });
    }

    const finalReason =
      (reason && reason.trim()) || "Deactivated by user";

    await pool.query(
      `
      UPDATE users
      SET 
        is_deleted = TRUE,
        deactivated_at = NOW(),
        reason_for_disruption = $2
      WHERE id = $1
      `,
      [userId, finalReason]
    );

    await LogCreators.userAuth(
      userId,
      ACTION_TYPES.ACCOUNT_DEACTIVATED,
      true,
      {
        ip: req.ip,
        reason: finalReason,
      }
    );

    return res.json({
      success: true,
      message:
        "Account deactivated successfully. You have 30 days to reactivate by logging in.",
    });
  } catch (error) {
    console.error("Deactivate Account Error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error during account deactivation",
    });
  }
};

const getDeactivatedUsers = async (req, res) => {
  try {
    // بس الأدمن
    if (req.token?.role !== 1) {
      return res
        .status(403)
        .json({ success: false, message: "Access denied. Admins only." });
    }

    const { rows } = await pool.query(
      `
      SELECT
        id,
        first_name,
        last_name,
        email,
        role_id,
        is_deleted,
        deactivated_at,
        GREATEST(
          0,
          30 - FLOOR(EXTRACT(EPOCH FROM (NOW() - deactivated_at)) / 86400)
        )::int AS days_remaining
      FROM users
      WHERE
        is_deleted = TRUE
        AND deactivated_at IS NOT NULL
        -- لو حابب تشوف بس اللي لسا ضمن فترة الـ 30 يوم:
        AND deactivated_at > NOW() - INTERVAL '30 days'
      ORDER BY deactivated_at DESC
      `
    );

    return res.json({
      success: true,
      users: rows,
    });
  } catch (error) {
    console.error("getDeactivatedUsers Error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Server error fetching deactivated users" });
  }
};


/* =========================================
   EXPORTS
========================================= */
export {
  register,
  login,
  verifyOTP,
  editUserSelf,
  rateFreelancer,
  verifyPassword,
  updatePassword,
  deactivateAccount,
  verifyEmailOtp,
  uploadProfilePic,
  sendOtpController,
  getUserdata,
  getDeactivatedUsers,
};
