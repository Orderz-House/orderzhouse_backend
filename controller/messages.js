import pool from "../models/db.js";
import filterMessage from "../middleware/filterMessages.js";
import { createBulkNotifications, NOTIFICATION_TYPES } from "../services/notificationService.js";

const messageHandler = (socket, io) => {
  socket.on("message", async (data) => {
    
    try {
      if (!socket.dataroom || !socket.user || !socket.roomId) {
        console.error("Missing socket.dataroom, socket.user or socket.roomId");
        return;
      }

      // ✅ فلترة الرسالة
      const checkMessage = await filterMessage(data.text, socket.user.userId);
      if (typeof checkMessage !== "string") {
        socket.emit("message_blocked", {
          error: "Your message violates the platform's policy and was not sent.",
        });
        return;
      }

      data.sender_id = socket.user.userId;

      // ✅ حفظ الرسالة
      const query = `
        INSERT INTO messages (project_id, sender_id, receiver_id ,text, image_url, time_sent)
        VALUES ($1, $2, $3, $4,$5, NOW())
        RETURNING *
      `;
      const values = [
        socket.dataroom.id,
        data.sender_id,
        socket.dataroom.id,
        data.text,
        data.image_url,
      ];

      const result = await pool.query(query, values);
      const savedMessage = result.rows[0];

      await pool.query(
        `INSERT INTO message_logs (message_id, sender_id, project_id, receiver_id) 
         VALUES ($1,$2,$3, $3)`,
        [savedMessage.id, savedMessage.sender_id, savedMessage.project_id]
      );

      // ✅ جيب كل أعضاء المشروع باستثناء المرسل
      const { rows: members } = await pool.query(
        `SELECT freelancer_id as user_id 
         FROM project_assignments 
         WHERE project_id = $1 AND freelancer_id != $2`,
        [savedMessage.project_id, savedMessage.sender_id]
      );
      console.log("savedMessage", savedMessage)
      const recipientIds = members.map(m => m.user_id);
      
      console.log("recipientIds", recipientIds);
      
      if (recipientIds.length > 0) {
        const notifyMessage = `New message in project chat`;
        await createBulkNotifications(
          recipientIds,
          NOTIFICATION_TYPES.MESSAGE_RECEIVED,
          notifyMessage,
          savedMessage.id,
          "message"
        );
      }

      // ✅ بث الرسالة لكل الموجودين في الغرفة
      io.to(socket.roomId).emit("message", {
        ...savedMessage,
        tempId: data.tempId,
      });

    } catch (err) {
      console.error("Error handling message:", err);
      socket.emit("message_error", {
        error: "An error occurred while sending your message.",
      });
    }
  });
};

export default messageHandler;
