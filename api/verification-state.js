const fs = require('fs');
const path = require('path');

const {
    defaultState,
    loadVerificationState,
    sanitizeVerificationState
} = require('../lib/verification-store');

const AUTO_VERIFICATION_FILE = 'pilot_pic_hours_verification.json';

function loadAutoVerificationState() {
    const filePath = path.join(process.cwd(), AUTO_VERIFICATION_FILE);
    if (!fs.existsSync(filePath)) {
        return defaultState();
    }

    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (error) {
        console.warn('[verification-state] Failed to parse auto verification file:', error.message);
        return defaultState();
    }
}

module.exports = async (req, res) => {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const automaticState = loadAutoVerificationState();
        const manualState = await loadVerificationState();

        const merged = {
            picHoursVerifications: {
                ...(automaticState.picHoursVerifications || {}),
                ...(manualState.picHoursVerifications || {})
            },
            dobVerifications: {
                ...(automaticState.dobVerifications || {}),
                ...(manualState.dobVerifications || {})
            }
        };

        return res.status(200).json(sanitizeVerificationState(merged));
    } catch (error) {
        console.error('[verification-state] Error:', error);
        return res.status(500).json({ error: 'Failed to load verification state' });
    }
};
