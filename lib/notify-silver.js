'use strict';

const { isQuebecPilotContext } = require('./club-alert');
const { getFirstName, joinMessageSections } = require('./notify-top5');

function computeSilverCandidates({ leaderboardData, state }) {
    const seen = new Set();
    return (leaderboardData.silverCgullLeaderboard || []).flatMap(pilot => {
        const id = String(pilot.userId);
        if (!/^\d+$/.test(id) || !pilot.pilot || seen.has(id) ||
            state.dobVerifications?.[id] || state.notifiedPilots?.[id]?.silverNotifiedAt) return [];
        seen.add(id);
        return [{
            pilotId: Number(id), pilotName: pilot.pilot, firstName: getFirstName(pilot.pilot),
            messageKind: 'silver', ranks: {},
            bilingual: isQuebecPilotContext({
                profile: leaderboardData.pilotProfiles?.[id],
                flights: (leaderboardData.minimalFlights || [])
                    .filter(flight => String(flight.user?.id) === id)
            })
        }];
    }).sort((a, b) => a.pilotId - b.pilotId);
}

function buildSilverLinks({ baseUrl, candidate }) {
    return { verify: `${baseUrl}/?contest=silverCGull&verifyDob=${candidate.pilotId}` };
}

function buildSilverMessageBody({ candidate, links }) {
    const sections = [
        `Hi ${candidate.firstName}, you're listed as a candidate for the SAC Silver C-Gull Trophy, awarded to the youngest pilot to achieve Silver C.`,
        `Please confirm your date of birth here: ${links.verify} If you received your Silver badge before this season, choose the removal option instead; no date of birth is required. Enter your email address and open the confirmation link emailed to you.`
    ];
    if (candidate.bilingual) sections.push(
        `Bonjour ${candidate.firstName}, vous figurez parmi les candidats au trophee Silver C-Gull de l'ACVV, decerne au plus jeune pilote a obtenir l'insigne d'argent.`,
        `Veuillez confirmer votre date de naissance ici : ${links.verify} Si vous avez obtenu votre insigne d'argent avant cette saison, choisissez le retrait; aucune date de naissance n'est requise. Saisissez votre adresse courriel, puis ouvrez le lien de confirmation recu par courriel.`
    );
    sections.push('Ryan Wood, SAC Sporting Committee');
    return joinMessageSections(sections);
}

function buildSendQueue(initial, silver, reminders) {
    const topThree = candidate => Math.min(...Object.values(candidate.ranks)) <= 3;
    return [...initial.filter(topThree), ...silver, ...initial.filter(c => !topThree(c)), ...reminders];
}

module.exports = { computeSilverCandidates, buildSilverLinks, buildSilverMessageBody, buildSendQueue };
