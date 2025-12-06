import pool from "../models/db.js";

const filterMessage = async (message, userId) => {
    let text = message.toLowerCase();
    let violation = false
    const phoneRegex = /(\+?\d{1,3}[-.\s]?)?(\(?\d{2,4}\)?[-.\s]?)?\d{3,4}[-.\s]?\d{4}/g;
    //console.log(phoneRegex.test(text));
    if(phoneRegex.test(text)) violation = true;

    const emailRegex = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/g;
    if(emailRegex.test(text)) violation = true;

    const keywords = [
        'whatsapp', 'telegram', 'facebook', 'instagram', 'snapchat', 'twitter',
        'discord', 'skype', 'phone', 'call me', 'email', 'gmail', 'yahoo', 'outlook',
        'contact me', 'dm me', 'direct message', 'number is', 'my number', 'my email'
    ];

    keywords.forEach(word => {
        const wordRegex = new RegExp(word, 'gi');
        //text = text.replace(wordRegex, '[filtered]');
        if(wordRegex.test(text)) violation = true;
    });

    if(violation){
        try{
        const setViolation = await pool.query("UPDATE users SET violation_count = violation_count + 1 WHERE id = $1 RETURNING *", [userId]);
        if(setViolation.rows[0].violation_count >= 3){
            const reason = "Your account has been suspended due to violations. Please contact the support team."
            const setsuspend = await pool.query("UPDATE users SET is_deleted = TRUE, reason_for_disruption = $2 WHERE id = $1 RETURNING *", [userId, reason]);
            return setsuspend
        }
        return setViolation;

        }catch (err){
            throw err;
        }
    }
    
    return text; 
};

export default filterMessage;