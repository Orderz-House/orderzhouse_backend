import pool from "../models/db.js";
import { v2 as cloudinary } from 'cloudinary';
import eventBus from "../events/eventBus.js"; 

// ===== CLOUDINARY SETUP =====
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true
});

const getExcerpt = (desc = "", len = 160) => {
  if (!desc) return "";
  return desc.length > len ? desc.substring(0, len) + "..." : desc;
};

const getCoverFromAttachments = (attachments) => {
  if (!attachments) return "/default-cover.jpg";
  try {
    let att = attachments;
    if (typeof attachments === "string") {
      try {
        att = JSON.parse(attachments);
      } catch {
        return attachments;
      }
    }
    if (Array.isArray(att) && att.length > 0) {
      return att[0];
    }
    if (typeof att === "string") return att;
  } catch (e) {
    console.warn("Cover parse error:", e);
  }
  return "/default-cover.jpg";
};

const buildSections = (desc = "") => {
  const paras = (desc || "")
    .split("\n\n")
    .map(p => p.trim())
    .filter(p => p.length > 0);
  if (paras.length === 0) return [];
  return [{ id: "intro", h: "Introduction", p: paras }];
};

const transformBlog = (row) => {
  const cover = getCoverFromAttachments(row.attachments);
  const excerpt = getExcerpt(row.description);
  const tags = row.tags || ["General"];
  const category = row.category || "General";
  const author = row.fullname_user || "Anonymous";
  const read = row.read_time || "5 min";

  return {
    id: row.id,
    title: row.title,
    excerpt,
    cover,
    author,
    date: row.created_at,
    read,
    category,
    tags: Array.isArray(tags) ? tags : [String(tags)],
    sections: buildSections(row.description),
    status: row.status,
    user_id: row.user_id,
    attachments: row.attachments
  };
};

const uploadToCloudinary = async (fileBuffer, mimeType, folder = 'blogs') => {
  try {
    const fileBase64 = fileBuffer.toString('base64');
    const fileUri = `data:${mimeType};base64,${fileBase64}`;
    
    const result = await cloudinary.uploader.upload(fileUri, {
      folder: folder,
      resource_type: 'auto',
      timeout: 60000
    });
    
    return result.secure_url;
  } catch (error) {
    console.error('Cloudinary upload error:', error);
    throw new Error(`Upload failed: ${error.message}`);
  }
};

// ===== MIDDLEWARE FOR FILE UPLOADS =====
export const blogUpload = (req, res, next) => {
  next();
};

// ===== CONTROLLERS =====

export const getBlogs = async (req, res) => {
  try {
    const { page = 1, limit = 10, status = 'approved', search = '', user_id } = req.query;
    const offset = (Number(page) - 1) * Number(limit);

    let query = `
      SELECT id, user_id, fullname_user, title, description, 
             status, attachments, created_at, category, tags, read_time
      FROM blogs
      WHERE is_deleted = false
    `;
    const params = [];

    if (status) {
      params.push(status);
      query += ` AND status = $${params.length}`;
    }

    if (search) {
      params.push(`%${search}%`);
      query += ` AND (title ILIKE $${params.length} OR description ILIKE $${params.length})`;
    }

    if (user_id) {
      params.push(user_id);
      query += ` AND user_id = $${params.length}`;
    }

    query += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(Number(limit), offset);

    const { rows } = await pool.query(query, params);
    const data = rows.map(transformBlog);

    res.json(data);
  } catch (error) {
    console.error("Error fetching blogs:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

export const getBlogById = async (req, res) => {
  try {
    const { id } = req.params;
    const { rows } = await pool.query(
      `SELECT id, user_id, fullname_user, title, description, 
              status, attachments, created_at, category, tags, read_time
       FROM blogs
       WHERE id = $1 AND is_deleted = false`,
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: "Blog not found" });
    }

    const transformed = transformBlog(rows[0]);
    res.json(transformed);
  } catch (error) {
    console.error("Error fetching blog:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

export const createBlog = async (req, res) => {
  try {
    const userId = req.token.userId;
    const fullname = req.token.fullname || "Anonymous";

    const title = req.body.title;
    const description = req.body.description || req.body.content || "";
    if (!title || !description) {
      return res.status(400).json({ success: false, message: "Title and description are required" });
    }

    const category = req.body.category || "General";
    let tags = req.body.tags || ["General"];
    if (!Array.isArray(tags)) {
      tags = typeof tags === "string" 
        ? tags.split(",").map(t => t.trim()).filter(Boolean)
        : ["General"];
    }
    tags = tags.map(t => String(t).trim()).filter(Boolean);
    if (tags.length === 0) tags = ["General"];

    const read_time = req.body.read_time || req.body.read || "5 min";

    let coverUrl = "/default-cover.jpg";
    let attachmentUrls = [];

    if (req.files?.cover?.[0]) {
      const coverBuffer = req.files.cover[0].buffer;
      coverUrl = await uploadToCloudinary(coverBuffer, 'blogs/covers');
      attachmentUrls.push(coverUrl);
    } else if (req.body.cover) {
      coverUrl = req.body.cover;
      attachmentUrls.push(coverUrl);
    }

    if (req.files?.attachments) {
      for (const file of req.files.attachments) {
        const fileBuffer = file.buffer;
        const fileUrl = await uploadToCloudinary(fileBuffer, 'blogs/attachments');
        attachmentUrls.push(fileUrl);
      }
    }

    const attachmentsData = JSON.stringify(attachmentUrls);

    const { rows } = await pool.query(
      `INSERT INTO blogs (
        user_id, fullname_user, title, description, status, 
        attachments, category, tags, read_time
      ) VALUES ($1, $2, $3, $4, 'pending', $5, $6, $7, $8)
      RETURNING id, user_id, fullname_user, title, description, 
                attachments, created_at, category, tags, read_time`,
      [userId, fullname, title, description, attachmentsData, category, tags, read_time]
    );

    eventBus.emit("blog.created", {
      blogId: rows[0].id,
      authorId: userId,
      title,
    });

    const transformed = transformBlog(rows[0]);
    res.status(201).json({
      success: true,
      message: "Blog created successfully. Awaiting approval.",
      ...transformed,
    });
  } catch (error) {
    console.error("CREATE BLOG ERROR:", error);
    res.status(500).json({ success: false, message: error.message || "Server error" });
  }
};

export const updateBlog = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.token.userId;

    const { rows: existing } = await pool.query(
      `SELECT user_id, status FROM blogs WHERE id = $1 AND is_deleted = false`,
      [id]
    );

    if (existing.length === 0) {
      return res.status(404).json({ success: false, message: "Blog not found" });
    }

    if (existing[0].user_id !== userId) {
      return res.status(403).json({ success: false, message: "Not authorized" });
    }

    if (existing[0].status === 'approved') {
      return res.status(400).json({ success: false, message: "Cannot update approved blog" });
    }

    let attachmentUrls = [];
    let hasNewAttachments = false;

    if (req.files?.cover?.[0]) {
      const coverBuffer = req.files.cover[0].buffer;
      const coverUrl = await uploadToCloudinary(coverBuffer, 'blogs/covers');
      attachmentUrls.push(coverUrl);
      hasNewAttachments = true;
    }

    if (req.files?.attachments) {
      for (const file of req.files.attachments) {
        const fileBuffer = file.buffer;
        const fileUrl = await uploadToCloudinary(fileBuffer, 'blogs/attachments');
        attachmentUrls.push(fileUrl);
      }
      hasNewAttachments = true;
    }

    const fields = [];
    const values = [];
    let idx = 2;

    if (req.body.title !== undefined) { 
      fields.push(`title = $${idx}`); 
      values.push(req.body.title); 
      idx++; 
    }
    if (req.body.description !== undefined) { 
      fields.push(`description = $${idx}`); 
      values.push(req.body.description); 
      idx++; 
    }
    if (hasNewAttachments) {
      fields.push(`attachments = $${idx}`);
      values.push(JSON.stringify(attachmentUrls));
      idx++;
    }
    if (req.body.category !== undefined) { 
      fields.push(`category = $${idx}`); 
      values.push(req.body.category); 
      idx++; 
    }
    if (req.body.tags !== undefined) {
      let dbTags = ["General"];
      if (Array.isArray(req.body.tags)) {
        dbTags = req.body.tags.filter(t => t.trim()).map(t => t.trim());
      } else if (typeof req.body.tags === "string") {
        dbTags = req.body.tags.split(",").map(t => t.trim()).filter(Boolean);
      }
      fields.push(`tags = $${idx}`);
      values.push(dbTags);
      idx++;
    }
    if (req.body.read_time !== undefined) { 
      fields.push(`read_time = $${idx}`); 
      values.push(req.body.read_time); 
      idx++; 
    }

    if (fields.length === 0) {
      return res.status(400).json({ success: false, message: "No fields to update" });
    }

    values.push(id);
    const query = `UPDATE blogs SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = $${idx}`;
    await pool.query(query, values);

    const { rows } = await pool.query(
      `SELECT id, user_id, fullname_user, title, description, attachments, 
              created_at, category, tags, read_time
       FROM blogs WHERE id = $1`,
      [id]
    );

    const transformed = transformBlog(rows[0]);
    res.json({ success: true, message: "Blog updated successfully", ...transformed });
  } catch (error) {
    console.error("Error updating blog:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

export const deleteBlog = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.token.userId;

    const { rows } = await pool.query(
      `SELECT user_id, status FROM blogs WHERE id = $1 AND is_deleted = false`,
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: "Blog not found" });
    }

    if (rows[0].user_id !== userId) {
      return res.status(403).json({ success: false, message: "Not authorized to delete this blog" });
    }

    await pool.query(`UPDATE blogs SET is_deleted = true, updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [id]);

    res.json({ success: true, message: "Blog deleted successfully" });
  } catch (error) {
    console.error("Error deleting blog:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

export const approveBlog = async (req, res) => {
  try {
    const { id } = req.params;
    const { rows } = await pool.query(
      `SELECT id FROM blogs WHERE id = $1 AND is_deleted = false`,
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: "Blog not found" });
    }

    await pool.query(`UPDATE blogs SET status = 'approved', updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [id]);

    eventBus.emit("blog.approved", {
      blogId: id,
    });

    res.json({ success: true, message: "Blog approved successfully" });
  } catch (error) {
    console.error("Error approving blog:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

export const rejectBlog = async (req, res) => {
  try {
    const { id } = req.params;
    const { rows } = await pool.query(
      `SELECT id FROM blogs WHERE id = $1 AND is_deleted = false`,
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: "Blog not found" });
    }

    await pool.query(`UPDATE blogs SET status = 'rejected', updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [id]);

    eventBus.emit("blog.rejected", {
      blogId: id,
    });

    res.json({ success: true, message: "Blog rejected successfully" });
  } catch (error) {
    console.error("Error rejecting blog:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

export const likeBlog = async (req, res) => {
  try {
    const { id } = req.params;
    const { rows } = await pool.query(
      `SELECT id, likes_counter FROM blogs WHERE id = $1 AND is_deleted = false AND status = 'approved'`,
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: "Blog not found or not approved" });
    }

    const newCounter = (rows[0].likes_counter || 0) + 1;
    await pool.query(`UPDATE blogs SET likes_counter = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`, [newCounter, id]);

    res.json({ success: true, message: "Blog liked successfully", likes: newCounter });
  } catch (error) {
    console.error("Error liking blog:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

export const saveBlog = async (req, res) => {
  try {
    const { id } = req.params;
    const { rows } = await pool.query(
      `SELECT id, saved_to_fav FROM blogs WHERE id = $1 AND is_deleted = false AND status = 'approved'`,
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: "Blog not found or not approved" });
    }

    const newCounter = (rows[0].saved_to_fav || 0) + 1;
    await pool.query(`UPDATE blogs SET saved_to_fav = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`, [newCounter, id]);

    res.json({ success: true, message: "Blog saved successfully", saved: newCounter });
  } catch (error) {
    console.error("Error saving blog:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};