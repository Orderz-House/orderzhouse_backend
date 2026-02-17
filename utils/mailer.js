import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

/**
 * Send email using Resend
 * @param {Object} options - Email options
 * @param {string} options.to - Recipient email address
 * @param {string} options.subject - Email subject
 * @param {string} options.html - HTML email body
 * @param {string} [options.text] - Plain text email body (optional)
 * @returns {Promise<Object>} Resend send result
 */
export const sendEmail = async ({ to, subject, html, text }) => {
  try {
    const response = await resend.emails.send({
      from: process.env.EMAIL_FROM,
      to,
      subject,
      html,
      text,
    });

    return response;
  } catch (error) {
    console.error("Resend email error:", error);
    throw error;
  }
};

/**
 * Generate OTP email HTML template based on language
 * @param {string} otp - The OTP code
 * @param {string} lang - Language code ('en' | 'ar')
 * @param {number} expiryMinutes - Expiry time in minutes (default: 5)
 * @returns {string} HTML template
 */
const generateOtpEmailTemplate = (otp, lang = 'en', expiryMinutes = 5) => {
  const isArabic = lang === 'ar';
  const dir = isArabic ? 'rtl' : 'ltr';
  const textAlign = isArabic ? 'right' : 'left';
  const fontFamily = isArabic 
    ? "'Segoe UI', 'Tahoma', 'Arial', sans-serif" 
    : "Arial, 'Helvetica Neue', Helvetica, sans-serif";

  if (isArabic) {
    return `
      <!DOCTYPE html>
      <html dir="rtl" lang="ar">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="margin:0; padding:0; background-color:#f5f5f5; font-family:${fontFamily};">
        <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f5f5f5; padding:20px 0;">
          <tr>
            <td align="center">
              <table width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff; border-radius:8px; box-shadow:0 2px 4px rgba(0,0,0,0.1); max-width:600px; margin:0 auto;">
                <tr>
                  <td style="padding:40px 30px; text-align:${textAlign}; direction:rtl;">
                    <h2 style="color:#C2410C; margin:0 0 20px 0; font-size:24px; font-weight:bold; text-align:${textAlign};">
                      تأكيد الحساب
                    </h2>
                    <p style="color:#333333; margin:0 0 20px 0; font-size:16px; line-height:1.6; text-align:${textAlign};">
                      مرحباً،
                    </p>
                    <p style="color:#333333; margin:0 0 20px 0; font-size:16px; line-height:1.6; text-align:${textAlign};">
                      استخدم رمز التحقق التالي لإكمال التسجيل:
                    </p>
                    <div style="background-color:#f2f2f2; border-radius:8px; padding:20px; text-align:center; margin:30px 0;">
                      <h1 style="color:#C2410C; font-size:36px; letter-spacing:4px; margin:0; font-weight:bold; font-family:'Courier New', monospace;">
                        ${otp}
                      </h1>
                    </div>
                    <p style="color:#333333; margin:0 0 20px 0; font-size:16px; line-height:1.6; text-align:center;">
                      ينتهي هذا الرمز خلال <strong>${expiryMinutes} دقائق</strong>.
                    </p>
                    <p style="color:#666666; margin:30px 0 0 0; font-size:12px; line-height:1.6; text-align:${textAlign};">
                      إذا لم تطلب هذا الرمز، يرجى تجاهل هذه الرسالة.
                    </p>
                    <p style="color:#333333; margin:20px 0 0 0; font-size:14px; line-height:1.6; text-align:${textAlign};">
                      شكراً لك،<br/>
                      <strong>فريق OrderzHouse</strong>
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
      </html>
    `;
  } else {
    return `
      <!DOCTYPE html>
      <html dir="ltr" lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="margin:0; padding:0; background-color:#f5f5f5; font-family:${fontFamily};">
        <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f5f5f5; padding:20px 0;">
          <tr>
            <td align="center">
              <table width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff; border-radius:8px; box-shadow:0 2px 4px rgba(0,0,0,0.1); max-width:600px; margin:0 auto;">
                <tr>
                  <td style="padding:40px 30px; text-align:${textAlign}; direction:ltr;">
                    <h2 style="color:#C2410C; margin:0 0 20px 0; font-size:24px; font-weight:bold; text-align:${textAlign};">
                      OrderzHouse Verification
                    </h2>
                    <p style="color:#333333; margin:0 0 20px 0; font-size:16px; line-height:1.6; text-align:${textAlign};">
                      Hello,
                    </p>
                    <p style="color:#333333; margin:0 0 20px 0; font-size:16px; line-height:1.6; text-align:${textAlign};">
                      Use the following verification code to complete your registration:
                    </p>
                    <div style="background-color:#f2f2f2; border-radius:8px; padding:20px; text-align:center; margin:30px 0;">
                      <h1 style="color:#C2410C; font-size:36px; letter-spacing:4px; margin:0; font-weight:bold; font-family:'Courier New', monospace;">
                        ${otp}
                      </h1>
                    </div>
                    <p style="color:#333333; margin:0 0 20px 0; font-size:16px; line-height:1.6; text-align:center;">
                      This code expires in <strong>${expiryMinutes} minutes</strong>.
                    </p>
                    <p style="color:#666666; margin:30px 0 0 0; font-size:12px; line-height:1.6; text-align:${textAlign};">
                      If you didn't request this, please ignore this email.
                    </p>
                    <p style="color:#333333; margin:20px 0 0 0; font-size:14px; line-height:1.6; text-align:${textAlign};">
                      Thanks,<br/>
                      <strong>OrderzHouse Team</strong>
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
      </html>
    `;
  }
};

/**
 * Generate plain text OTP email content
 * @param {string} otp - The OTP code
 * @param {string} lang - Language code ('en' | 'ar')
 * @param {number} expiryMinutes - Expiry time in minutes (default: 5)
 * @returns {string} Plain text content
 */
const generateOtpEmailText = (otp, lang = 'en', expiryMinutes = 5) => {
  if (lang === 'ar') {
    return `رمز التحقق الخاص بـ OrderzHouse: ${otp}\n\nينتهي هذا الرمز خلال ${expiryMinutes} دقائق.\n\nإذا لم تطلب هذا الرمز، يرجى تجاهل هذه الرسالة.\n\nفريق OrderzHouse`;
  } else {
    return `Your OrderzHouse verification code is: ${otp}\n\nThis code expires in ${expiryMinutes} minutes.\n\nIf you didn't request this, please ignore this email.\n\nOrderzHouse Team`;
  }
};

/**
 * Send OTP verification email with bilingual support
 * @param {string} email - Recipient email address
 * @param {string} otp - The OTP code to send
 * @param {string} [lang='en'] - Language code ('en' | 'ar')
 * @param {number} [expiryMinutes=5] - Expiry time in minutes
 * @returns {Promise<Object>} Resend send result
 */
export const sendOtpEmail = async (email, otp, lang = 'en', expiryMinutes = 5) => {
  const isArabic = lang === 'ar';
  const subject = isArabic 
    ? 'رمز التحقق الخاص بـ OrderzHouse'
    : 'Your OrderzHouse verification code';

  const html = generateOtpEmailTemplate(otp, lang, expiryMinutes);
  const text = generateOtpEmailText(otp, lang, expiryMinutes);

  return await sendEmail({
    to: email,
    subject,
    html,
    text,
  });
};

export default sendEmail;
