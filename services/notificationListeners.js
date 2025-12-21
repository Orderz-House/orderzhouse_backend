import eventBus from "../events/eventBus.js";
import {
  NotificationCreators,
  createNotification,
  createBulkNotifications,
  NOTIFICATION_TYPES,
} from "./notificationService.js";

/**
 * helper: never crash server because of notifications
 */
const safe = (label, fn) => async (data) => {
  try {
    await fn(data || {});
  } catch (err) {
    console.error(`[NotificationListenerError] ${label}:`, err);
  }
};

/* ===========================
   MESSAGE EVENTS
=========================== */
eventBus.on(
  "message.received",
  safe("message.received", async (data) => {
    const { senderId, recipientId, messageId, preview } = data;
    await NotificationCreators.messageReceived(
      senderId,
      recipientId,
      messageId,
      preview
    );
  })
);

/* ===========================
   OFFER EVENTS
=========================== */
eventBus.on(
  "offer.submitted",
  safe("offer.submitted", async (data) => {
    const { offerId, projectId, projectTitle, freelancerName } = data;
    await NotificationCreators.offerSubmitted(
      offerId,
      projectId,
      projectTitle,
      freelancerName
    );
  })
);

eventBus.on(
  "offer.statusChanged",
  safe("offer.statusChanged", async (data) => {
    const { offerId, projectTitle, freelancerId, accepted } = data;
    await NotificationCreators.offerStatusChanged(
      offerId,
      projectTitle,
      freelancerId,
      accepted
    );
  })
);

/* ===========================
   PROJECT EVENTS
=========================== */
eventBus.on(
  "project.created",
  safe("project.created", async (data) => {
    const { projectId, projectTitle, clientId, categoryId } = data;
    await NotificationCreators.projectCreated(
      projectId,
      projectTitle,
      clientId,
      categoryId
    );
  })
);

eventBus.on(
  "project.statusChanged",
  safe("project.statusChanged", async (data) => {
    const { userId, projectId, messageText } = data;
    await createNotification(
      userId,
      NOTIFICATION_TYPES.PROJECT_STATUS_CHANGED,
      String(messageText || "Project status updated"),
      projectId,
      "project"
    );
  })
);

/* ===========================
   APPLICATIONS (Apply / Approve / Reject)
=========================== */
eventBus.on(
  "freelancer.appliedForProject",
  safe("freelancer.appliedForProject", async (data) => {
    const { clientId, freelancerId, projectId, projectTitle } = data;
    await NotificationCreators.freelancerAppliedForProject(
      clientId,
      freelancerId,
      projectId,
      projectTitle
    );
  })
);

eventBus.on(
  "freelancer.applicationStatusChanged",
  safe("freelancer.applicationStatusChanged", async (data) => {
    const { projectId, freelancerId, projectTitle, accepted } = data;
    await NotificationCreators.freelancerApplicationStatusChanged(
      projectId,
      freelancerId,
      projectTitle,
      accepted
    );
  })
);

/* ===========================
   ASSIGNMENTS (Invite / Assign / Remove / Accept / Reject)
=========================== */
eventBus.on(
  "freelancer.assignmentChanged",
  safe("freelancer.assignmentChanged", async (data) => {
    // يدعم الشكلين:
    // { projectId, freelancerId, assigned }
    // أو { projectId, projectTitle, freelancerId, assigned }
    const { projectId, projectTitle, freelancerId, assigned } = data;

    if (projectTitle !== undefined) {
      await NotificationCreators.freelancerAssignmentChanged(
        projectId,
        projectTitle,
        freelancerId,
        assigned
      );
    } else {
      await NotificationCreators.freelancerAssignmentChanged(
        projectId,
        freelancerId,
        assigned
      );
    }
  })
);

eventBus.on(
  "freelancer.assigned",
  safe("freelancer.assigned", async (data) => {
    const { freelancerId, projectId, projectTitle } = data;
    await NotificationCreators.freelancerAssigned(
      freelancerId,
      projectId,
      projectTitle
    );
  })
);

eventBus.on(
  "freelancer.acceptedAssignment",
  safe("freelancer.acceptedAssignment", async (data) => {
    const { projectId, freelancerId } = data;
    await NotificationCreators.freelancerAcceptedAssignment(projectId, freelancerId);
  })
);

eventBus.on(
  "freelancer.rejectedAssignment",
  safe("freelancer.rejectedAssignment", async (data) => {
    const { projectId, freelancerId } = data;
    await NotificationCreators.freelancerRejectedAssignment(projectId, freelancerId);
  })
);

/* ===========================
   WORKFLOW (Submit / Review / Resubmit)
=========================== */

/**
 * لو عندك إشعار للعميل عند تسليم العمل
 * data: { clientId, projectId, projectTitle, freelancerId, messageText }
 */
eventBus.on(
  "work.submitted",
  safe("work.submitted", async (data) => {
    const { clientId, projectId, projectTitle, freelancerId, messageText } = data;

    // إشعار بسيط للعميل
    if (clientId) {
      await createNotification(
        clientId,
        NOTIFICATION_TYPES.WORK_SUBMITTED,
        String(
          messageText ||
            `📦 Work submitted for "${projectTitle || "your project"}".`
        ),
        projectId,
        "project"
      );
    }

  })
);

eventBus.on(
  "work.reviewed",
  safe("work.reviewed", async (data) => {
    const { freelancerId, projectId, projectTitle, status } = data;
    await NotificationCreators.workCompletionReviewed(
      freelancerId,
      projectId,
      projectTitle,
      status
    );
  })
);

eventBus.on(
  "work.resubmitted",
  safe("work.resubmitted", async (data) => {
    const { projectId, projectTitle, freelancerId } = data;
    await NotificationCreators.workResubmittedForReview(
      projectId,
      projectTitle,
      freelancerId
    );
  })
);

/* ===========================
   ESCROW EVENTS
=========================== */
eventBus.on(
  "escrow.funded",
  safe("escrow.funded", async (data) => {
    const { projectId, projectTitle, freelancerId, amount } = data;
    await NotificationCreators.escrowFunded(
      projectId,
      projectTitle,
      freelancerId,
      amount
    );
  })
);

eventBus.on(
  "escrow.released",
  safe("escrow.released", async (data) => {
    const { projectId, projectTitle, freelancerId, amount } = data;
    await NotificationCreators.escrowReleased(
      projectId,
      projectTitle,
      freelancerId,
      amount
    );
  })
);

/* ===========================
   REVIEW EVENTS
=========================== */
eventBus.on(
  "review.submitted",
  safe("review.submitted", async (data) => {
    const { reviewId, freelancerId, reviewerName } = data;
    await NotificationCreators.reviewSubmitted(
      reviewId,
      freelancerId,
      reviewerName
    );
  })
);

/* ===========================
   TASK SYSTEM EVENTS
=========================== */
eventBus.on(
  "task.requested",
  safe("task.requested", async (data) => {
    const { freelancerId, taskId, messageText } = data;
    await NotificationCreators.taskRequested(freelancerId, taskId, messageText);
  })
);

eventBus.on(
  "task.statusChange",
  safe("task.statusChange", async (data) => {
    const { userId, taskId, messageText } = data;
    await NotificationCreators.taskStatusChange(userId, taskId, messageText);
  })
);

/* ===========================
   TASK PAYMENT EVENTS (proof / admin confirm)
=========================== */
eventBus.on(
  "payment.proofSubmitted",
  safe("payment.proofSubmitted", async (data) => {
    const { freelancerId, requestId } = data;
    await NotificationCreators.paymentSubmitted(freelancerId, requestId);
  })
);

eventBus.on(
  "payment.confirmed",
  safe("payment.confirmed", async (data) => {
    const { userId, requestId } = data;
    await NotificationCreators.paymentConfirmed(userId, requestId);
  })
);

/* ===========================
   USER VERIFICATION (Admin approves/rejects freelancer)
=========================== */
eventBus.on(
  "freelancer.verificationApproved",
  safe("freelancer.verificationApproved", async (data) => {
    const { freelancerId } = data;

    await createNotification(
      freelancerId,
      NOTIFICATION_TYPES.USER_VERIFIED,
      "Your account has been verified.",
      freelancerId,
      "user"
    );
  })
);

eventBus.on(
  "freelancer.verificationRejected",
  safe("freelancer.verificationRejected", async (data) => {
    const { freelancerId } = data;

    await createNotification(
      freelancerId,
      NOTIFICATION_TYPES.USER_VERIFICATION_REJECTED,
      "❌ Your verification request was rejected by admin.",
      freelancerId,
      "user"
    );
  })
);

/* ===========================
   SUBSCRIPTION EVENTS
   data: { userId, messageText, subscriptionId }
=========================== */
eventBus.on(
  "subscription.statusChanged",
  safe("subscription.statusChanged", async (data) => {
    const { userId, messageText, subscriptionId } = data;

    await createNotification(
      userId,
      NOTIFICATION_TYPES.SUBSCRIPTION_STATUS_CHANGED,
      String(messageText || "Your subscription status has changed."),
      subscriptionId || null,
      "subscription"
    );
  })
);

/* ===========================
   COURSE EVENTS
   data: { userId, courseId, courseTitle }
=========================== */
eventBus.on(
  "course.enrolled",
  safe("course.enrolled", async (data) => {
    const { userId, courseId, courseTitle } = data;

    await createNotification(
      userId,
      NOTIFICATION_TYPES.COURSE_ENROLLED,
      `🎓 You enrolled in "${courseTitle || "a course"}".`,
      courseId || null,
      "course"
    );
  })
);

/* ===========================
   APPOINTMENT EVENTS
   data: { userIds, userId, appointmentId, messageText, type }
=========================== */
eventBus.on(
  "appointment.scheduled",
  safe("appointment.scheduled", async (data) => {
    const { userId, userIds, appointmentId, messageText } = data;
    const recipients = Array.isArray(userIds) && userIds.length ? userIds : [userId].filter(Boolean);

    await createBulkNotifications(
      recipients,
      NOTIFICATION_TYPES.APPOINTMENT_SCHEDULED,
      String(messageText || "Appointment scheduled."),
      appointmentId || null,
      "appointment"
    );
  })
);

eventBus.on(
  "appointment.cancelled",
  safe("appointment.cancelled", async (data) => {
    const { userId, userIds, appointmentId, messageText } = data;
    const recipients = Array.isArray(userIds) && userIds.length ? userIds : [userId].filter(Boolean);

    await createBulkNotifications(
      recipients,
      NOTIFICATION_TYPES.APPOINTMENT_CANCELLED,
      String(messageText || "Appointment cancelled."),
      appointmentId || null,
      "appointment"
    );
  })
);

eventBus.on(
  "appointment.requested",
  safe("appointment.requested", async (data) => {
    const { userId, userIds, appointmentId, messageText } = data;
    const recipients = Array.isArray(userIds) && userIds.length ? userIds : [userId].filter(Boolean);

    await createBulkNotifications(
      recipients,
      NOTIFICATION_TYPES.APPOINTMENT_REQUESTED,
      String(messageText || "Appointment requested."),
      appointmentId || null,
      "appointment"
    );
  })
);

eventBus.on(
  "appointment.rescheduled",
  safe("appointment.rescheduled", async (data) => {
    const { userId, userIds, appointmentId, messageText } = data;
    const recipients = Array.isArray(userIds) && userIds.length ? userIds : [userId].filter(Boolean);

    await createBulkNotifications(
      recipients,
      NOTIFICATION_TYPES.APPOINTMENT_RESCHEDULED,
      String(messageText || "Appointment rescheduled."),
      appointmentId || null,
      "appointment"
    );
  })
);

eventBus.on(
  "appointment.completed",
  safe("appointment.completed", async (data) => {
    const { userId, userIds, appointmentId, messageText } = data;
    const recipients = Array.isArray(userIds) && userIds.length ? userIds : [userId].filter(Boolean);

    await createBulkNotifications(
      recipients,
      NOTIFICATION_TYPES.APPOINTMENT_COMPLETED,
      String(messageText || "Appointment completed."),
      appointmentId || null,
      "appointment"
    );
  })
);

/* ===========================
   SYSTEM ANNOUNCEMENT
=========================== */
eventBus.on(
  "system.announcement",
  safe("system.announcement", async (data) => {
    const { adminId, messageText, userIds } = data;
    await NotificationCreators.systemAnnouncement(adminId, messageText, userIds);
  })
);

console.log("Notification listeners loaded");
