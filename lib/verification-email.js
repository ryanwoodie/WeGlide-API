const nodemailer = require('nodemailer');
const { google } = require('googleapis');

const GMAIL_API_SCOPE = 'https://www.googleapis.com/auth/gmail.send';

function getSmtpConfig() {
    const smtpUser = process.env.GMAIL_SMTP_USER;
    const smtpPass = process.env.GMAIL_SMTP_APP_PASSWORD;

    if (smtpUser && smtpPass) {
        return {
            provider: 'gmail-smtp',
            smtpUser,
            smtpPass
        };
    }

    return null;
}

function getEmailConfig() {
    const gmailApiUser = process.env.GMAIL_OAUTH_USER || process.env.GMAIL_SMTP_USER;
    const gmailApiClientId = process.env.GMAIL_OAUTH_CLIENT_ID;
    const gmailApiClientSecret = process.env.GMAIL_OAUTH_CLIENT_SECRET;
    const gmailApiRefreshToken = process.env.GMAIL_OAUTH_REFRESH_TOKEN;
    const gmailApiRedirectUri = process.env.GMAIL_OAUTH_REDIRECT_URI || 'http://127.0.0.1:3005/oauth2callback';

    if (gmailApiClientId && gmailApiClientSecret && gmailApiRefreshToken) {
        return {
            provider: 'gmail-api',
            gmailApiUser,
            gmailApiClientId,
            gmailApiClientSecret,
            gmailApiRefreshToken,
            gmailApiRedirectUri,
            // SMTP app-password fallback: used if the OAuth refresh token is dead
            // (Google revokes refresh tokens, classically after 7 days while the
            // consent screen is in "Testing"). App passwords don't expire that way.
            smtpFallback: getSmtpConfig()
        };
    }

    const smtpConfig = getSmtpConfig();
    if (smtpConfig) {
        return smtpConfig;
    }

    const error = new Error('Verification email service is not configured');
    error.code = 'EMAIL_CONFIG_ERROR';
    error.publicMessage = 'Verification email is temporarily unavailable. Please contact support.';
    throw error;
}

// Auth failures worth retrying over SMTP: a dead/revoked OAuth refresh token.
function isGmailAuthError(error) {
    if (!error) return false;
    if (error.code === 'EAUTH') return true;
    const message = typeof error.message === 'string' ? error.message : '';
    const detail = error.response && error.response.data && error.response.data.error;
    return message.includes('invalid_grant') || detail === 'invalid_grant';
}

function getFromAddress(config) {
    if (process.env.EMAIL_FROM) {
        return process.env.EMAIL_FROM;
    }

    const defaultFromName = process.env.EMAIL_FROM_NAME || 'SAC Leaderboard';

    if (config.provider === 'gmail-api') {
        if (config.gmailApiUser) {
            return formatMailboxAddress(config.gmailApiUser, defaultFromName);
        }

        const error = new Error('EMAIL_FROM or GMAIL_OAUTH_USER is required for Gmail API sending');
        error.code = 'EMAIL_CONFIG_ERROR';
        error.publicMessage = 'Verification email is temporarily unavailable. Please contact support.';
        throw error;
    }

    return formatMailboxAddress(config.smtpUser, defaultFromName);
}

function formatVerificationSummary(details) {
    if (details.type === 'pic') {
        return `Claimed PIC hours as of October 1, 2025: ${details.picHours}`;
    }

    return `Claimed date of birth: ${details.dateOfBirth}`;
}

function buildMessage(details) {
    const from = getFromAddress(details.config);
    const subject = details.type === 'pic'
        ? `Confirm PIC hours verification for ${details.pilotName}`
        : `Confirm date of birth verification for ${details.pilotName}`;

    return {
        from,
        subject,
        text: [
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
        ].join('\n'),
        html: `
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
        `
    };
}

function getSmtpTransporter(config) {
    return nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: config.smtpUser,
            pass: config.smtpPass
        }
    });
}

function getGmailClient(config) {
    const auth = new google.auth.OAuth2(
        config.gmailApiClientId,
        config.gmailApiClientSecret,
        config.gmailApiRedirectUri
    );

    auth.setCredentials({
        refresh_token: config.gmailApiRefreshToken
    });

    return google.gmail({
        version: 'v1',
        auth
    });
}

function buildRawMimeMessage(message, to) {
    const boundary = `boundary_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const lines = [
        `From: ${message.from}`,
        `To: ${to}`,
        `Subject: ${encodeHeader(message.subject)}`,
        'MIME-Version: 1.0',
        `Content-Type: multipart/alternative; boundary="${boundary}"`,
        '',
        `--${boundary}`,
        'Content-Type: text/plain; charset="UTF-8"',
        'Content-Transfer-Encoding: 7bit',
        '',
        message.text,
        '',
        `--${boundary}`,
        'Content-Type: text/html; charset="UTF-8"',
        'Content-Transfer-Encoding: 7bit',
        '',
        message.html.trim(),
        '',
        `--${boundary}--`,
        ''
    ];

    return Buffer.from(lines.join('\r\n'))
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '');
}

function encodeHeader(value) {
    return `=?UTF-8?B?${Buffer.from(String(value), 'utf8').toString('base64')}?=`;
}

function formatMailboxAddress(email, name) {
    if (!name || /<.+>/.test(email)) {
        return email;
    }

    return `"${String(name).replace(/"/g, '\\"')}" <${email}>`;
}

async function sendViaGmailApi(config, details, message) {
    const gmail = getGmailClient(config);

    await gmail.users.messages.send({
        userId: 'me',
        requestBody: {
            raw: buildRawMimeMessage(message, details.email)
        }
    });
}

async function sendViaGmailSmtp(config, details, message) {
    const transporter = getSmtpTransporter(config);

    await transporter.sendMail({
        from: message.from,
        to: details.email,
        subject: message.subject,
        text: message.text,
        html: message.html
    });
}

async function sendVerificationEmail(details) {
    const config = getEmailConfig();
    const message = buildMessage({
        ...details,
        config
    });

    try {
        if (config.provider === 'gmail-api') {
            try {
                await sendViaGmailApi(config, details, message);
            } catch (apiError) {
                // If the OAuth token is dead but an SMTP app password is configured,
                // heal automatically instead of failing the request.
                if (config.smtpFallback && isGmailAuthError(apiError)) {
                    console.warn('[verification-email] Gmail API auth failed (%s); falling back to SMTP app password.',
                        (apiError && apiError.message) || 'unknown error');
                    await sendViaGmailSmtp(config.smtpFallback, details, message);
                } else {
                    throw apiError;
                }
            }
        } else {
            await sendViaGmailSmtp(config, details, message);
        }
    } catch (error) {
        if (!error.code && isGmailAuthError(error)) {
            error.code = 'EAUTH';
        }

        error.publicMessage = 'Unable to send the verification email right now. Please try again later or contact support.';
        throw error;
    }
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
    GMAIL_API_SCOPE,
    sendVerificationEmail
};
