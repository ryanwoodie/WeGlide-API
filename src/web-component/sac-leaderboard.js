class SACLeaderboard extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        this.data = null;
        this.currentMode = 'mixed';
        this.under200Enabled = false;
    }

    async connectedCallback() {
        this.renderLoading();
        try {
            await this.fetchData();
            this.render();
            this.addEventListeners();
        } catch (error) {
            console.error('Error loading leaderboard:', error);
            this.renderError(error.message);
        }
    }

    async fetchData() {
        const response = await fetch('https://sac-leaderboard.vercel.app/api/data');
        if (!response.ok) throw new Error(`Failed to fetch data: ${response.status}`);
        this.data = await response.json();
    }

    renderLoading() {
        this.shadowRoot.innerHTML = `
            <style>${this.getStyles()}</style>
            <div class="container">
                <div class="loading">
                    <h3>Loading leaderboard data...</h3>
                    <p>Processing flight data and calculating rankings</p>
                </div>
            </div>
        `;
    }

    renderError(message) {
        this.shadowRoot.innerHTML = `
            <style>${this.getStyles()}</style>
            <div class="container">
                <div class="error">
                    <h3>Error Loading Data</h3>
                    <p>${message}</p>
                </div>
            </div>
        `;
    }

    getStyles() {
        return `
        :host {
            display: block;
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
        }
        
        .container {
            max-width: 1400px;
            margin: 0 auto;
            background: white;
            border-radius: 12px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.2);
            overflow: hidden;
        }
        
        .header {
            background: rgb(33, 58, 120);
            color: white;
            padding: 30px;
            text-align: center;
            position: relative;
        }
        
        .header-content {
            display: flex;
            align-items: center;
            justify-content: flex-start;
            gap: 30px;
            position: relative;
        }
        
        .header h1 {
            margin: 0 0 10px 0;
            font-size: 2.5em;
            font-weight: 300;
        }
        
        .header p {
            margin: 0;
            opacity: 0.8;
            font-size: 1.1em;
        }
        
        .stats {
            display: flex;
            justify-content: center;
            gap: 30px;
            margin-top: 20px;
            flex-wrap: wrap;
        }
        
        .stat {
            text-align: center;
        }
        
        .stat-number {
            font-size: 2em;
            font-weight: bold;
            display: block;
        }
        
        .stat-label {
            font-size: 0.9em;
            opacity: 0.8;
        }
        
        .leaderboard {
            padding: 0;
            overflow-x: auto;
            -webkit-overflow-scrolling: touch;
            position: relative;
        }
        
        table {
            width: 100%;
            min-width: 1000px;
            border-collapse: collapse;
        }
        
        th {
            background: #f8f9fa;
            padding: 15px 10px;
            text-align: left;
            font-weight: 600;
            color: #2c3e50;
            border-bottom: 2px solid #dee2e6;
            position: sticky;
            top: 0;
        }
        
        td {
            padding: 12px 10px;
            border-bottom: 1px solid #dee2e6;
        }
        
        tr:hover {
            background-color: #f8f9fa;
        }
        
        .rank {
            font-weight: bold;
            color: #3498db;
            width: 60px;
            text-align: center;
        }
        
        .pilot-name {
            font-weight: 600;
            color: #2c3e50;
            min-width: 130px;
        }
        
        .total-points {
            font-weight: bold;
            color: #27ae60;
            text-align: right;
            min-width: 80px;
        }
        
        .flight-cell {
            min-width: 180px;
            font-size: 0.9em;
        }
        
        .flight-details {
            background: #f8f9fa;
            border-radius: 6px;
            padding: 8px;
            margin: 2px 0;
            border-left: 4px solid #3498db;
        }
        
        .flight-points {
            font-weight: bold;
            color: #2c3e50;
        }
        
        .flight-distance {
            color: #7f8c8d;
            font-size: 0.85em;
        }
        
        .flight-date {
            color: #95a5a6;
            font-size: 0.8em;
        }
        
        .flight-link {
            color: #3498db;
            text-decoration: none;
            font-size: 0.8em;
            display: inline-block;
            margin-top: 4px;
        }
        
        .flight-link:hover {
            text-decoration: underline;
        }
        
        .declared-task {
            background: linear-gradient(90deg, #f39c12, #e67e22);
            color: white;
            font-size: 0.7em;
            padding: 2px 6px;
            border-radius: 10px;
            margin-left: 5px;
        }
        
        .medal {
            display: inline-block;
            margin-right: 5px;
        }
        
        .gold { color: #f1c40f; }
        .silver { color: #95a5a6; }
        .bronze { color: #cd7f32; }

        .scoring-toggle {
            margin: 20px 0;
            display: flex;
            gap: 10px;
            justify-content: center;
            align-items: center;
            padding: 0 20px;
            flex-wrap: wrap;
        }

        .primary-toggle-row, .secondary-toggle-row {
            display: flex;
            gap: 10px;
            justify-content: center;
            align-items: center;
            flex-wrap: wrap;
        }

        .secondary-toggle-row {
            margin-top: 6px;
            font-size: 0.85em;
        }

        .secondary-toggle-label {
            font-weight: 600;
            color: rgba(0, 0, 0, 0.6);
            margin-right: 6px;
        }

        .toggle-btn {
            padding: 8px 16px;
            border: 1px solid #ced4da;
            background: #fff;
            color: #2c3e50;
            border-radius: 20px;
            cursor: pointer;
            transition: all 0.2s ease;
            font-size: 0.9em;
            font-weight: 500;
        }

        .toggle-btn:hover { background: #e9ecef; }
        
        .toggle-btn.active {
            background: #2c5aa0;
            color: #fff;
            border-color: #2c5aa0;
        }

        .toggle-btn.secondary {
            padding: 4px 10px;
            font-size: 0.85em;
        }

        .filter-btn {
            padding: 8px 16px;
            border: 1px solid #ffc107;
            background: #fff9db;
            color: #856404;
            border-radius: 6px;
            cursor: pointer;
            transition: all 0.2s ease;
            font-size: 0.9em;
            font-weight: 500;
        }

        .filter-btn:hover { background: #fff3cd; }
        
        .filter-btn.active {
            background: #ffc107;
            color: #212529;
        }

        .footer {
            background: #2c3e50;
            color: white;
            text-align: center;
            padding: 20px;
            font-size: 0.9em;
        }

        /* Verification styles */
        .verification-badge {
            font-size: 0.65em;
            padding: 1px 4px;
            border-radius: 2px;
            margin-top: 2px;
            font-weight: normal;
            display: block;
            opacity: 0.8;
            background-color: #28a745;
            color: white;
        }

        .verification-status {
            font-size: 0.65em;
            padding: 1px 4px;
            border-radius: 2px;
            font-weight: normal;
            opacity: 0.8;
            display: block;
            margin-top: 2px;
        }
        .verification-status.verified { background-color: #28a745; color: white; }
        .verification-status.unverified { background-color: #dc3545; color: white; }

        .unverified-row { background-color: rgba(128, 128, 128, 0.05); }
        .verified-row { background-color: #fff; }

        /* Trophy styles */
        .trophy-section {
            margin: 20px auto;
            max-width: 1200px;
            background: #f8f9fa;
            border-radius: 8px;
            overflow: hidden;
            border: 1px solid #dee2e6;
        }

        .trophy-header {
            background: #e9ecef;
            padding: 15px 20px;
            cursor: pointer;
            user-select: none;
        }

        .trophy-header h3 {
            margin: 0;
            color: #2c3e50;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .trophy-content {
            padding: 20px;
        }

        .trophy-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 20px;
        }

        .trophy-item {
            background: white;
            border: 1px solid #dee2e6;
            border-radius: 6px;
            padding: 15px;
            border-left: 4px solid #ffd700;
        }

        .trophy-item h4 {
            margin: 0 0 8px 0;
            color: #d4af37;
        }

        .winner {
            margin: 8px 0;
            padding: 8px 0;
            border-bottom: 1px solid #eee;
        }

        @media (max-width: 768px) {
            .header h1 { font-size: 1.5em; }
            .stats { gap: 15px; }
            .stat-number { font-size: 1.5em; }
            
            .leaderboard th, .leaderboard td {
                padding: 8px 5px;
            }
            
            .pilot-name { min-width: 100px; max-width: 140px; overflow: hidden; text-overflow: ellipsis; }
            .flight-cell { min-width: 140px; }
        }
        `;
    }

    render() {
        const leaderboardList = this.getLeaderboardData();
        const filteredList = this.applyUnder200Filter(leaderboardList);
        const stats = this.calculateStats(filteredList);

        this.shadowRoot.innerHTML = `
            <style>${this.getStyles()}</style>
            <div class="container">
                <div class="header">
                    <div class="header-content">
                        <div class="header-text">
                            <h1>🏆 Soaring Association of Canada Leaderboard</h1>
                            <p>${this.getScoringDescription()}</p>
                        </div>
                    </div>
                    <div class="stats">
                        <div class="stat">
                            <span class="stat-number">${stats.pilotCount}</span>
                            <span class="stat-label">Pilots</span>
                        </div>
                        <div class="stat">
                            <span class="stat-number">${stats.flightCount}</span>
                            <span class="stat-label">Flights</span>
                        </div>
                        <div class="stat">
                            <span class="stat-number">${stats.totalKms.toLocaleString()}</span>
                            <span class="stat-label">Total Km</span>
                        </div>
                        <div class="stat">
                            <span class="stat-number">${this.data.meta.totalTasksDeclared}</span>
                            <span class="stat-label">Tasks Declared</span>
                        </div>
                        <div class="stat">
                            <span class="stat-number">${this.data.meta.totalTasksCompleted}</span>
                            <span class="stat-label">Tasks Completed</span>
                        </div>
                    </div>
                    
                    <div class="scoring-toggle">
                        <div class="primary-toggle-row">
                            <button class="toggle-btn ${this.currentMode === 'mixed' ? 'active' : ''}" data-mode="mixed">Combined Scoring</button>
                            <button class="toggle-btn ${this.currentMode === 'free' ? 'active' : ''}" data-mode="free">Free Contest</button>
                            <button class="filter-btn ${this.under200Enabled ? 'active' : ''}" id="under200Btn">⚬ < 200 hrs PIC</button>
                        </div>
                    </div>
                    <div class="scoring-toggle">
                        <div class="secondary-toggle-row">
                            <span class="secondary-toggle-label">Other WeGlide contests:</span>
                            <button class="toggle-btn secondary ${this.currentMode === 'sprint' ? 'active' : ''}" data-mode="sprint">Sprint</button>
                            <button class="toggle-btn secondary ${this.currentMode === 'triangle' ? 'active' : ''}" data-mode="triangle">Triangle</button>
                            <button class="toggle-btn secondary ${this.currentMode === 'out_return' ? 'active' : ''}" data-mode="out_return">Out &amp; Return</button>
                            <button class="toggle-btn secondary ${this.currentMode === 'out' ? 'active' : ''}" data-mode="out">Out</button>
                        </div>
                    </div>
                    
                    <div class="trophy-section">
                        <div class="trophy-header" id="trophyHeader">
                            <h3>🏆 Trophy Standings <span class="toggle-arrow">▶</span></h3>
                        </div>
                        <div class="trophy-content" id="trophyContent" style="display: none;">
                            <p style="font-size: 0.85em; color: #666; margin: 0 0 15px 0; text-align: center;">(Unofficial year-to-date standings)</p>
                            ${this.renderTrophies()}
                        </div>
                    </div>
                </div>
                
                <div class="leaderboard">
                    <table>
                        <thead>
                            <tr>
                                <th>Rank</th>
                                <th>Pilot</th>
                                <th>Total Points</th>
                                <th>Flight 1</th>
                                <th>Flight 2</th>
                                <th>Flight 3</th>
                                ${this.getMaxFlights() > 3 ? '<th>Flight 4</th><th>Flight 5</th>' : ''}
                            </tr>
                        </thead>
                        <tbody>
                            ${this.renderRows(filteredList)}
                        </tbody>
                    </table>
                </div>
                
                <div class="footer">
                    <p>Data from WeGlide API • ${this.data.meta.seasonLabel}</p>
                </div>
            </div>
        `;
    }

    getLeaderboardData() {
        switch (this.currentMode) {
            case 'mixed': return this.data.mixedLeaderboard; // Now mixedLeaderboard directly
            case 'free': return this.data.freeLeaderboard;
            case 'sprint': return this.data.sprintLeaderboard;
            case 'triangle': return this.data.triangleLeaderboard;
            case 'out_return': return this.data.outReturnLeaderboard;
            case 'out': return this.data.outLeaderboard;
            case 'silverCGull': return this.data.silverCgullLeaderboard;
            default: return this.data.mixedLeaderboard;
        }
    }

    getMaxFlights() {
        return (['sprint', 'triangle', 'out_return', 'out'].includes(this.currentMode)) ? 3 : 5;
    }

    getScoringDescription() {
        if (this.currentMode === 'mixed') return `Best 5 flights per pilot • Higher of Task or Free scoring • ${this.data.meta.seasonLabel}`;
        if (this.currentMode === 'free') return `Best 5 flights per pilot • Free scoring only • ${this.data.meta.freeSeasonLabel}`;
        return `Top ${this.getMaxFlights()} flights per pilot • WeGlide ${this.currentMode} scoring • ${this.data.meta.seasonLabel}`;
    }

    applyUnder200Filter(list) {
        if (!this.under200Enabled) return list;
        // Ensure pilotDurations exists and has data
        if (!this.data.pilotDurations) return list;
        
        return list.filter(p => {
            const duration = this.data.pilotDurations[p.pilotId];
            return typeof duration === 'number' && duration < (200 * 3600);
        });
    }

    calculateStats(list) {
        const pilotCount = list.length;
        const flightCount = list.reduce((sum, p) => sum + (p.flightCount || 0), 0);
        const totalKms = Math.round(list.reduce((sum, p) => sum + (p.totalDistance || 0), 0));
        return { pilotCount, flightCount, totalKms };
    }

    renderRows(list) {
        if (!list || list.length === 0) return '<tr><td colspan="8" style="text-align:center;padding:20px;">No pilots found</td></tr>';
        
        const maxFlights = this.getMaxFlights();
        
        return list.map((pilot, index) => {
            let rankDisplay = index + 1;
            if (index === 0) rankDisplay = '<span class="medal gold">🥇</span>' + rankDisplay;
            else if (index === 1) rankDisplay = '<span class="medal silver">🥈</span>' + rankDisplay;
            else if (index === 2) rankDisplay = '<span class="medal bronze">🥉</span>' + rankDisplay;

            let pilotNameHtml = `<a href="https://www.weglide.org/user/${pilot.pilotId}" target="_blank" class="pilot-link">${pilot.pilot}</a>`;
            
            // Add verification badge if under 200 mode
            if (this.under200Enabled) {
                const verification = this.data.pilotVerifications?.picHoursVerifications?.[pilot.pilotId];
                if (verification && verification.dataSource === 'user-entered') {
                    pilotNameHtml += '<span class="verification-badge verified">✓ <200hrs PIC Verified</span>';
                } else {
                    pilotNameHtml += '<span class="verification-status unverified">⚠ Unverified</span>';
                }
            }

            const flights = pilot.bestFlights.slice(0, maxFlights);
            const flightCells = flights.map(f => this.createFlightCell(f)).join('');
            const emptyCells = Array(maxFlights - flights.length).fill('<td class="flight-cell">-</td>').join('');

            return `
                <tr class="${this.under200Enabled && (!this.data.pilotVerifications?.picHoursVerifications?.[pilot.pilotId]?.dataSource === 'user-entered') ? 'unverified-row' : ''}">
                    <td class="rank">${rankDisplay}</td>
                    <td class="pilot-name">${pilotNameHtml}</td>
                    <td class="total-points">${pilot.totalPoints.toFixed(1)}</td>
                    ${flightCells}
                    ${emptyCells}
                </tr>
            `;
        }).join('');
    }

    createFlightCell(flight) {
        const declaredBadge = flight.declared ? '<span class="declared-task">TASK</span>' : '';
        const flightUrl = `https://www.weglide.org/flight/${flight.id}`;
        const dateStr = new Date(flight.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

        return `
            <td class="flight-cell">
                <div class="flight-details">
                    <div class="flight-points">${flight.points.toFixed(1)} pts${declaredBadge}</div>
                    <div class="flight-distance">${flight.distance.toFixed(1)} km</div>
                    <div class="flight-speed">${flight.speed.toFixed(1)} km/h</div>
                    <div class="flight-date">${dateStr}</div>
                    <div class="flight-location">${flight.takeoff} • <a href="${flightUrl}" target="_blank" class="flight-link">View</a></div>
                </div>
            </td>
        `;
    }

    renderTrophies() {
        // Re-implement trophy rendering logic here or simplify for MVP
        // For MVP, let's just show a placeholder or simple list if data is available
        // We'd need to port the calculation logic or pre-calculate trophies in JSON
        return '<p style="text-align:center; color:#888;">Trophy calculation logic to be ported to Web Component.</p>';
    }

    addEventListeners() {
        this.shadowRoot.querySelectorAll('.toggle-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                this.currentMode = e.target.dataset.mode;
                this.render();
                this.addEventListeners(); // Re-bind after re-render
            });
        });

        const under200Btn = this.shadowRoot.getElementById('under200Btn');
        if (under200Btn) {
            under200Btn.addEventListener('click', () => {
                this.under200Enabled = !this.under200Enabled;
                this.render();
                this.addEventListeners();
            });
        }

        const trophyHeader = this.shadowRoot.getElementById('trophyHeader');
        if (trophyHeader) {
            trophyHeader.addEventListener('click', () => {
                const content = this.shadowRoot.getElementById('trophyContent');
                const arrow = this.shadowRoot.querySelector('.toggle-arrow');
                if (content.style.display === 'none') {
                    content.style.display = 'block';
                    arrow.textContent = '▼';
                } else {
                    content.style.display = 'none';
                    arrow.textContent = '▶';
                }
            });
        }
    }
}

customElements.define('sac-leaderboard', SACLeaderboard);
