const nodemailer = require('nodemailer');

function getTransporter() {
    const user = process.env.GMAIL_SMTP_USER;
    const pass = process.env.GMAIL_SMTP_APP_PASSWORD;

    if (!user || !pass) {
        throw new Error('GMAIL_SMTP_USER or GMAIL_SMTP_APP_PASSWORD is not configured');
    }

    return nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user,
            pass
        }
    });
}

function getFromAddress() {
    return process.env.EMAIL_FROM || process.env.GMAIL_SMTP_USER;
}

function formatVerificationSummary(details) {
    if (details.type === 'pic') {
        return `Claimed PIC hours as of October 1, 2025: ${details.picHours}`;
    }

    return `Claimed date of birth: ${details.dateOfBirth}`;
}

async function sendVerificationEmail(details) {
    const transporter = getTransporter();
    const from = getFromAddress();
    const subject = details.type === 'pic'
        ? `Confirm PIC hours verification for ${details.pilotName}`
        : `Confirm date of birth verification for ${details.pilotName}`;

    const text = [
        `Hello ${details.pilotName},`,
        '',
        'Someone requested verification on the SAC Leaderboard using this email address.',
        formatVerificationSummary(details),
        '',
        'Open this link to confirm the submission:',
        details.verificationLink,
        '',
        'This link expires in 60 minutes.',
        '',
        'If you did not make this request, you can ignore this email.'
    ].join('\n');

    const html = `
        <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #222;">
            <p>Hello ${escapeHtml(details.pilotName)},</p>
            <p>Someone requested verification on the SAC Leaderboard using this email address.</p>
            <p><strong>${escapeHtml(formatVerificationSummary(details))}</strong></p>
            <p><a href="${details.verificationLink}" style="display: inline-block; padding: 10px 16px; border-radius: 6px; background: #0a5f9e; color: #fff; text-decoration: none;">Confirm verification</a></p>
            <p>If the button does not work, open this link:</p>
            <p><a href="${details.verificationLink}">${details.verificationLink}</a></p>
            <p>This link expires in 60 minutes.</p>
            <p>If you did not make this request, you can ignore this email.</p>
        </div>
    `;

    await transporter.sendMail({
        from,
        to: details.email,
        subject,
        text,
        html
    });
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

module.exports = {
    sendVerificationEmail
};
