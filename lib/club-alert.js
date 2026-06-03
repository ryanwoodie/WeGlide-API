'use strict';

const QUEBEC_REGION = 'CA-QC';
const PROFILE_SETTINGS_URL = 'https://www.weglide.org/settings/profile';

function normalizeRegion(region) {
    return String(region || '').trim().toUpperCase().replace(/_/g, '-');
}

function hasAssignedClub(profile) {
    const club = profile && profile.club;
    if (!club || typeof club !== 'object') {
        return false;
    }
    return Boolean(
        Number.isFinite(Number(club.id)) ||
        String(club.name || '').trim() ||
        String(club.region || '').trim()
    );
}

function isQuebecRegion(region) {
    return normalizeRegion(region).startsWith(QUEBEC_REGION);
}

function isQuebecProfile(profile) {
    return isQuebecRegion(profile && profile.club && profile.club.region);
}

function isQuebecFlight(flight) {
    return isQuebecRegion(flight && flight.takeoff_airport && flight.takeoff_airport.region);
}

function isQuebecPilotContext({ profile, flights = [] } = {}) {
    return isQuebecProfile(profile) || flights.some(isQuebecFlight);
}

function getFirstName(name) {
    return String(name || '').trim().split(/\s+/)[0] || 'there';
}

function buildNoClubAlertMessage({ pilotName, bilingual = false } = {}) {
    const firstName = getFirstName(pilotName);
    const english = `Hi ${firstName} | Thanks for uploading your flight to WeGlide. Your WeGlide profile does not currently have a club assigned. To qualify for the SAC Decentralized Soaring Contest, please add your club here: ${PROFILE_SETTINGS_URL} | After your club is saved, future SAC leaderboard updates can include you in the club-based contest scoring. | Ryan Wood, SAC Sporting Committee`;

    if (!bilingual) {
        return english;
    }

    return `${english} | FR: Bonjour ${firstName} | Merci d'avoir televerse votre vol sur WeGlide. Aucun club n'est actuellement associe a votre profil WeGlide. Pour etre admissible au concours decentralise de l'Association canadienne de vol a voile (SAC), veuillez ajouter votre club ici: ${PROFILE_SETTINGS_URL} | Une fois votre club enregistre, les prochaines mises a jour du classement SAC pourront vous inclure dans le classement par club. | Ryan Wood, SAC Sporting Committee`;
}

function buildNoClubAlertCandidates({ flights = [], profiles = {}, state = {} } = {}) {
    const byPilot = new Map();
    flights.forEach(flight => {
        const pilotId = flight && flight.user && flight.user.id;
        if (typeof pilotId !== 'number') {
            return;
        }
        const entry = byPilot.get(pilotId) || {
            pilotId,
            pilotName: flight.user.name || '',
            flights: []
        };
        if (!entry.pilotName && flight.user.name) {
            entry.pilotName = flight.user.name;
        }
        entry.flights.push(flight);
        byPilot.set(pilotId, entry);
    });

    const notified = (state && state.notifiedNoClubPilots) || {};
    return Array.from(byPilot.values())
        .filter(candidate => !notified[String(candidate.pilotId)])
        .map(candidate => {
            const profile = profiles[String(candidate.pilotId)] || profiles[candidate.pilotId] || {};
            return {
                ...candidate,
                pilotName: profile.name || candidate.pilotName,
                profile,
                bilingual: isQuebecPilotContext({ profile, flights: candidate.flights })
            };
        })
        .filter(candidate => !hasAssignedClub(candidate.profile))
        .map(candidate => ({
            pilotId: candidate.pilotId,
            pilotName: candidate.pilotName,
            firstName: getFirstName(candidate.pilotName),
            flightIds: candidate.flights.map(flight => flight.id).filter(Boolean),
            latestFlightId: candidate.flights[candidate.flights.length - 1]?.id || null,
            latestFlightDate: candidate.flights[candidate.flights.length - 1]?.scoring_date || null,
            takeoffRegions: Array.from(new Set(candidate.flights
                .map(flight => normalizeRegion(flight?.takeoff_airport?.region))
                .filter(Boolean))),
            bilingual: candidate.bilingual,
            messageBody: buildNoClubAlertMessage({
                pilotName: candidate.pilotName,
                bilingual: candidate.bilingual
            })
        }));
}

module.exports = {
    PROFILE_SETTINGS_URL,
    QUEBEC_REGION,
    buildNoClubAlertCandidates,
    buildNoClubAlertMessage,
    getFirstName,
    hasAssignedClub,
    isQuebecFlight,
    isQuebecPilotContext,
    isQuebecProfile,
    isQuebecRegion,
    normalizeRegion
};
