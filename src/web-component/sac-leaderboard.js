class SACLeaderboard extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        this.data = null;
        this.currentMode = 'sacDsc'; // Default to SAC-DSC
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
        
        .sac-logo {
            width: 120px;
            height: 120px;
            flex-shrink: 0;
        }
        
        .header-text {
            flex: 1;
            text-align: center;
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
        
        @media (max-width: 768px) {
            .header {
                padding: 20px 15px;
            }
            
            .header-content {
                flex-direction: column;
                gap: 15px;
                text-align: center;
            }
            
            .sac-logo {
                width: 80px;
                height: 80px;
            }
            
            .header h1 {
                font-size: 1.8em;
            }
            
            .stats {
                gap: 15px;
                margin-top: 15px;
            }
            
            .stat {
                min-width: 80px;
            }
            
            .container {
                margin: 0;
                border-radius: 0;
            }
            
            :host {
                padding: 0;
            }
            
            .leaderboard {
                border-radius: 0;
            }
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
        
        .loading {
            text-align: center;
            padding: 40px;
            color: #7f8c8d;
        }
        
        .error {
            background: #e74c3c;
            color: white;
            padding: 15px;
            margin: 20px;
            border-radius: 6px;
        }
        
        .footer {
            background: #2c3e50;
            color: white;
            text-align: center;
            padding: 20px;
            font-size: 0.9em;
        }
        
        .medal {
            display: inline-block;
            margin-right: 5px;
        }
        
        .gold { color: #f1c40f; }
        .silver { color: #95a5a6; }
        .bronze { color: #cd7f32; }
        
        @media (max-width: 768px) {
            .stats {
                flex-direction: column;
                gap: 15px;
            }
            
            .flight-cell {
                min-width: 150px;
                font-size: 0.8em;
            }
            /* Widen pilot column on mobile to show more characters */
            .pilot-name {
                min-width: 120px;
                max-width: 180px;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }
            .pilot-name .pilot-link {
                display: inline-block;
                max-width: 100%;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }
            
            .leaderboard th,
            .leaderboard td {
                padding: 8px 6px;
            }
            /* Tighter points column on mobile */
            .total-points {
                min-width: 70px;
            }
        }

        /* Mobile scroll hint text */
        .scroll-hint {
            display: none;
            text-align: center;
            font-size: 0.9em;
            color: #6c757d;
            padding: 8px 10px;
        }
        @media (max-width: 768px) {
            .scroll-hint { display: block; }
        }

        /* Scoring toggle buttons */
        .scoring-toggle {
            margin: 20px 0;
            display: flex;
            gap: 10px;
            justify-content: center;
            align-items: center;
            padding: 0 20px;
            flex-wrap: wrap;
        }

        .primary-toggle-row,
        .secondary-toggle-row {
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
            color: rgba(255, 255, 255, 0.85);
            margin-right: 6px;
        }

        .toggle-btn.secondary {
            padding: 4px 10px;
            font-size: 0.85em;
            border-width: 1px;
            opacity: 0.85;
            color: rgba(255, 255, 255, 0.9);
            border-color: rgba(255, 255, 255, 0.5);
        }

        .toggle-btn.secondary.active {
            opacity: 1;
            border-color: rgba(255, 255, 255, 0.85);
        }

        /* Find button */
        .find-btn {
            padding: 8px 16px;
            background: linear-gradient(135deg, #28a745, #20c997);
            color: white;
            border: none;
            border-radius: 8px;
            cursor: pointer;
            font-size: 14px;
            font-weight: 500;
            transition: all 0.3s ease;
            box-shadow: 0 2px 4px rgba(40, 167, 69, 0.3);
        }

        .find-btn:hover {
            background: linear-gradient(135deg, #218838, #1ea080);
            box-shadow: 0 3px 6px rgba(40, 167, 69, 0.4);
            transform: translateY(-1px);
        }

        /* Floating search overlay */
        .search-overlay {
            position: fixed;
            top: 20px;
            right: 20px;
            z-index: 10000;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
        }

        .search-widget {
            background: white;
            border-radius: 8px;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
            border: 1px solid #e0e0e0;
            padding: 12px;
            display: flex;
            align-items: center;
            gap: 8px;
            min-width: 300px;
        }

        #searchInput {
            flex: 1;
            padding: 8px 12px;
            border: 1px solid #ddd;
            border-radius: 6px;
            font-size: 14px;
            outline: none;
        }

        #searchInput:focus {
            border-color: #007bff;
            box-shadow: 0 0 0 2px rgba(0, 123, 255, 0.2);
        }

        #nextBtn {
            padding: 8px 12px;
            background: #007bff;
            color: white;
            border: none;
            border-radius: 6px;
            cursor: pointer;
            font-size: 14px;
            font-weight: 500;
        }

        #nextBtn:hover:not(:disabled) {
            background: #0056b3;
        }

        #nextBtn:disabled {
            background: #ccc;
            cursor: not-allowed;
        }

        #closeBtn {
            padding: 8px 10px;
            background: #dc3545;
            color: white;
            border: none;
            border-radius: 6px;
            cursor: pointer;
            font-size: 16px;
            font-weight: bold;
            line-height: 1;
        }

        #closeBtn:hover {
            background: #c82333;
        }

        #searchStatus {
            position: absolute;
            top: -25px;
            right: 0;
            background: rgba(0, 0, 0, 0.8);
            color: white;
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 12px;
            white-space: nowrap;
        }

        /* Search highlight */
        .search-highlight {
            background: #ffeb3b !important;
            font-weight: bold;
            border-radius: 3px;
            padding: 2px 4px;
        }

        .search-current {
            background: #ff5722 !important;
            color: white;
        }

        /* Pilot profile tooltips */
        .pilot-tooltip {
            background: white;
            border: 1px solid #ddd;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            padding: 0;
            min-width: 300px;
            max-width: 400px;
            font-size: 13px;
            line-height: 1.4;
            position: relative;
        }

        .pilot-tooltip-close {
            position: absolute;
            top: 10px;
            right: 12px;
            border: none;
            background: transparent;
            color: #888;
            font-size: 18px;
            cursor: pointer;
            padding: 0;
            line-height: 1;
        }

        .pilot-tooltip-close:hover {
            color: #333;
        }

        .pilot-tooltip-header {
            background: #f8f9fa;
            padding: 12px 15px;
            border-bottom: 1px solid #dee2e6;
            border-radius: 8px 8px 0 0;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .pilot-tooltip-header h4 {
            margin: 0;
            font-size: 14px;
            font-weight: 600;
            color: #333;
        }

        .weglide-profile-link {
            font-size: 11px;
            color: #007bff;
            text-decoration: none;
            font-weight: 500;
        }

        .weglide-profile-link:hover {
            text-decoration: underline;
        }

        .pilot-stats-section {
            padding: 12px 15px;
        }

        .pilot-stats-section:not(:last-child) {
            border-bottom: 1px solid #f1f3f4;
        }

        .pilot-stats-section h5 {
            margin: 0 0 8px 0;
            font-size: 12px;
            font-weight: 600;
            color: #666;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }

        .pilot-stats-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 6px 12px;
        }

        .pilot-stat {
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .pilot-stat .stat-label {
            font-size: 11px;
            color: #666;
            font-weight: 500;
        }

        .pilot-stat .stat-value {
            font-size: 12px;
            font-weight: 600;
            color: #333;
        }

        /* Mobile responsive pilot tooltips */
        @media (max-width: 768px) {
            .pilot-tooltip {
                min-width: 280px;
                max-width: 320px;
                font-size: 12px;
            }

            .pilot-stats-grid {
                grid-template-columns: 1fr;
                gap: 6px;
            }

            .pilot-tooltip-header {
                padding: 10px 12px;
            }

            .pilot-stats-section {
                padding: 10px 12px;
            }
        }

        .pilot-highlight {
            background: #ffeb3b !important;
            font-weight: bold;
            border-radius: 3px;
            padding: 2px 4px;
        }

        .pilot-current {
            background: #ff5722 !important;
            color: white !important;
        }

        .toggle-btn {
            padding: 8px 16px;
            border: 2px solid rgba(255,255,255,0.3);
            background: rgba(255,255,255,0.1);
            color: white;
            border-radius: 20px;
            cursor: pointer;
            transition: all 0.3s ease;
            font-size: 0.9em;
            font-weight: 500;
        }

        .toggle-btn:hover {
            background: rgba(255,255,255,0.2);
            border-color: rgba(255,255,255,0.5);
        }

        .toggle-btn.active {
            background: rgba(255,255,255,0.9);
            color: #2c5aa0;
            border-color: rgba(255,255,255,0.9);
        }

        /* Filter button - visually distinct from scoring buttons */
        .filter-btn {
            padding: 8px 16px;
            border: 2px solid rgba(255,193,7,0.5);
            background: rgba(255,193,7,0.1);
            color: #ffc107;
            border-radius: 6px;
            cursor: pointer;
            transition: all 0.3s ease;
            font-size: 0.9em;
            font-weight: 500;
            position: relative;
        }

        .filter-btn::before {
            content: "🔍";
            margin-right: 6px;
            font-size: 0.8em;
        }

        .filter-btn:hover {
            background: rgba(255,193,7,0.2);
            border-color: rgba(255,193,7,0.7);
        }

        .filter-btn.active {
            background: rgba(255,193,7,0.9);
            color: #333;
            border-color: rgba(255,193,7,0.9);
        }

        /* Award badges */
        .award-badge {
            font-size: 0.85em;
            margin-left: 6px;
            opacity: 0.7;
            display: inline;
            white-space: nowrap;
        }

        .award-badge.glider {
            color: #4a90e2;
        }

        .award-badge.motor-glider {
            color: #f39c12;
        }

        /* Aircraft info styling */
        .aircraft-info {
            font-size: 0.85em;
            opacity: 0.8;
            margin: 0 8px;
        }

        .flight-aircraft {
            font-size: 0.8em;
            color: #888;
            font-style: italic;
        }


        /* Close button for mobile */
        .tooltip-close-btn {
            position: absolute;
            top: 10px;
            right: 10px;
            background: rgba(0, 0, 0, 0.7);
            color: white;
            border: none;
            border-radius: 50%;
            width: 30px;
            height: 30px;
            cursor: pointer;
            font-size: 18px;
            line-height: 1;
            display: none;
            align-items: center;
            justify-content: center;
            z-index: 10001;
        }

        .tooltip-close-btn:hover {
            background: rgba(0, 0, 0, 0.9);
        }

        /* Mobile responsive tooltip */
        @media (max-width: 768px) {
            .flight-preview {
                width: 95vw !important;
                height: 95vh !important;
                max-width: none !important;
                max-height: none !important;
                left: 50% !important;
                top: 50% !important;
                transform: translate(-50%, -50%) !important;
                border-radius: 8px;
                overflow-y: auto;
            }

            .tooltip-close-btn {
                display: flex;
            }

            .flight-tooltip-content {
                padding: 15px;
                padding-top: 50px;
            }
        }

        /* Flight preview tooltip */
        .flight-preview {
            position: fixed;
            z-index: 10000;
            background: #1a1a1a;
            color: white;
            border: 1px solid #333;
            border-radius: 8px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.4);
            padding: 0;
            max-width: 600px;
            max-height: 80vh;
            overflow-y: auto;
            pointer-events: none;
            opacity: 0;
            transition: opacity 0.2s ease;
        }

        .flight-tooltip-header {
            background: #2c5aa0;
            padding: 10px 12px;
            border-radius: 8px 8px 0 0;
            display: flex;
            justify-content: space-between;
            align-items: center;
            font-size: 0.9em;
        }

        .flight-type {
            font-size: 0.8em;
            padding: 2px 6px;
            border-radius: 4px;
            font-weight: normal;
        }

        .flight-type.declared {
            background: rgba(76, 175, 80, 0.9);
            color: white;
            font-weight: 600;
            border: 1px solid rgba(76, 175, 80, 1);
        }

        .flight-type.declared-incomplete {
            background: rgba(255, 152, 0, 0.9);
            color: white;
            font-weight: 600;
            border: 1px solid rgba(255, 152, 0, 1);
        }

        .flight-type.free {
            background: rgba(158, 158, 158, 0.9);
            color: white;
            font-weight: 600;
            border: 1px solid rgba(158, 158, 158, 1);
        }

        .flight-tooltip-content {
            padding: 10px 12px;
        }

        .task-score-section {
            margin-top: 16px;
            background: rgba(44, 90, 160, 0.15);
            border: 1px solid rgba(44, 90, 160, 0.3);
            border-radius: 8px;
            padding: 12px;
        }

        .task-score-header {
            font-weight: 600;
            font-size: 0.95em;
            margin-bottom: 8px;
            color: #f1f5ff;
        }

        .task-score-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
            gap: 8px 12px;
            margin-bottom: 10px;
        }

        .task-score-item {
            display: flex;
            flex-direction: column;
            background: rgba(0, 0, 0, 0.15);
            border-radius: 6px;
            padding: 8px;
        }

        .task-score-label {
            font-size: 0.75em;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            color: rgba(255, 255, 255, 0.6);
        }

        .task-score-value {
            font-size: 0.95em;
            font-weight: 600;
            color: #ffffff;
        }

        .task-score-table {
            border-top: 1px solid rgba(255, 255, 255, 0.1);
            padding-top: 10px;
            display: grid;
            gap: 6px;
        }

        .task-score-row {
            display: grid;
            grid-template-columns: 1fr auto 24px;
            align-items: center;
            font-size: 0.9em;
        }

        .score-label {
            color: rgba(255, 255, 255, 0.8);
        }

        .score-value {
            font-weight: 600;
            text-align: right;
        }

        .score-check {
            text-align: center;
            font-weight: 700;
            color: rgba(255, 255, 255, 0.4);
        }

        .score-check.active {
            color: #4caf50;
        }

        .score-check.score-cross {
            color: #f44336;
        }

        .tooltip-row {
            display: flex;
            justify-content: space-between;
            margin-bottom: 4px;
            font-size: 0.85em;
        }

        .tooltip-row:last-child {
            margin-bottom: 0;
        }

        .flight-tooltip-link {
            margin-top: 8px;
            padding-top: 8px;
            border-top: 1px solid #333;
        }

        .flight-tooltip-link a {
            color: #64b5f6;
            text-decoration: none;
            font-size: 0.8em;
        }

        .flight-tooltip-link a:hover {
            text-decoration: underline;
        }

        /* Detailed stats styling */
        .stats-section {
            padding-top: 8px;
            margin-top: 8px;
        }

        .stats-header {
            font-weight: bold;
            font-size: 0.85em;
            margin-bottom: 6px;
            color: #ccc;
        }

        .stats-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 4px 8px;
        }

        .stats-grid-3col {
            display: grid;
            grid-template-columns: 1fr 1fr 1fr;
            gap: 4px 8px;
        }

        .stat-item {
            display: flex;
            justify-content: space-between;
            font-size: 0.8em;
        }

        .stat-label {
            color: #aaa;
        }

        .stat-value {
            color: white;
            font-weight: 500;
        }

        /* Flight image styling */
        .flight-image-section {
            padding: 10px 12px;
            text-align: center;
            border-bottom: 1px solid #333;
        }

        .flight-preview-img {
            max-width: 100%;
            max-height: 200px;
            border-radius: 4px;
            opacity: 0;
            transition: opacity 0.3s ease;
        }

        .flight-cell {
            cursor: pointer;
            position: relative;
        }

        .flight-cell:hover {
            background-color: rgba(255,255,255,0.05);
        }

        /* Pilot and WeGlide links */
        .pilot-link {
            color: inherit;
            text-decoration: none;
        }

        .pilot-link:hover {
            text-decoration: underline;
            color: #0066cc;
        }

        .weglide-link {
            font-size: 0.8em;
            color: #666;
            text-decoration: none;
        }

        .weglide-link:hover {
            color: #0066cc;
            text-decoration: underline;
        }

        /* Smaller flight details */
        .flight-details {
            font-size: 0.85em;
            line-height: 1.3;
        }

        .flight-location {
            font-size: 0.8em;
            color: #666;
        }

        /* Trophy section styling */
        .trophy-section {
            margin: 20px auto;
            max-width: 1200px;
            background: rgba(255,255,255,0.05);
            border-radius: 8px;
            overflow: hidden;
        }

        .trophy-header {
            background: rgba(255,255,255,0.1);
            padding: 15px 20px;
            cursor: pointer;
            user-select: none;
            transition: background 0.3s ease;
        }

        .trophy-header:hover {
            background: rgba(255,255,255,0.15);
        }

        .trophy-header h3 {
            margin: 0;
            color: white;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .toggle-arrow {
            transition: transform 0.3s ease;
            font-size: 0.8em;
        }

        .trophy-content {
            padding: 20px;
            border-top: 1px solid rgba(255,255,255,0.1);
        }

        .silver-cgull-section {
            margin-top: 20px;
            padding-top: 15px;
            border-top: 1px solid #444;
            text-align: center;
        }

        /* Scoring tooltips */
        .scoring-tooltip {
            text-decoration: underline;
            text-decoration-style: dotted;
            cursor: help;
            position: relative;
            touch-action: manipulation;
        }

        .custom-tooltip {
            position: absolute;
            background: #000000;
            color: #ffffff;
            padding: 16px 20px;
            border-radius: 8px;
            font-size: 14px;
            line-height: 1.5;
            min-width: 300px;
            max-width: 450px;
            box-shadow: 0 6px 20px rgba(0,0,0,1);
            z-index: 10000;
            border: 3px solid #ffffff;
            font-weight: 400;
            pointer-events: auto;
            white-space: pre-line;
        }

        .custom-tooltip .tooltip-content {
            margin-bottom: 0;
            padding-right: 20px;
        }

        .custom-tooltip .tooltip-close {
            position: absolute;
            top: 8px;
            right: 8px;
            background: transparent;
            border: none;
            color: #ffffff;
            font-size: 18px;
            font-weight: bold;
            cursor: pointer;
            padding: 4px 8px;
            border-radius: 4px;
            line-height: 1;
            opacity: 0.7;
            transition: opacity 0.2s;
            display: none;
        }

        .custom-tooltip .tooltip-close:hover {
            opacity: 1;
            background: rgba(255, 255, 255, 0.1);
        }

        .custom-tooltip::before {
            content: '';
            position: absolute;
            top: -11px;
            left: 50%;
            transform: translateX(-50%);
            border-left: 8px solid transparent;
            border-right: 8px solid transparent;
            border-bottom: 8px solid #000000;
        }

        .custom-tooltip.tooltip-above::before {
            top: auto;
            bottom: -11px;
            border-bottom: none;
            border-top: 8px solid #000000;
        }

        /* Mobile-specific styles */
        @media (max-width: 768px) {
            .custom-tooltip {
                min-width: 280px;
                max-width: calc(100vw - 40px);
                font-size: 13px;
                padding: 14px 16px 14px 16px;
            }

            .custom-tooltip .tooltip-close {
                display: block;
            }

            .scoring-tooltip {
                padding: 2px 0;
            }
        }

        @media (max-width: 480px) {
            .custom-tooltip {
                min-width: 260px;
                max-width: calc(100vw - 20px);
                font-size: 12px;
                padding: 12px 14px 12px 14px;
            }
        }

        /* PIC Hours Verification System */
        .unverified-row {
            background-color: rgba(128, 128, 128, 0.1) !important;
            opacity: 0.8;
        }

        .verified-row {
            background-color: rgba(255, 255, 255, 0.95);
        }

        .verification-badge {
            font-size: 0.65em;
            padding: 1px 4px;
            border-radius: 2px;
            margin-top: 2px;
            font-weight: normal;
            display: block;
            opacity: 0.8;
        }

        .verification-badge.verified {
            background-color: #28a745;
            color: white;
        }

        .verify-btn {
            font-size: 0.65em;
            padding: 2px 6px;
            margin-top: 2px;
            border: none;
            border-radius: 2px;
            cursor: pointer;
            transition: background-color 0.2s;
            font-weight: normal;
        }

        .verify-btn.unverified {
            background-color: #dc3545;
            color: white;
        }

        .verify-btn.unverified:hover {
            background-color: #c82333;
        }

        .verify-btn.small {
            font-size: 0.6em;
            padding: 1px 4px;
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

        .verification-status.verified {
            background-color: #28a745;
            color: white;
        }

        .unverified-leaders {
            margin-top: 8px;
            padding: 6px 8px;
            background: rgba(255, 255, 255, 0.02);
            border-radius: 3px;
            border-left: 2px solid rgba(220, 53, 69, 0.6);
            opacity: 0.85;
        }

        .unverified-pilot {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 5px 0;
            border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        }

        .unverified-pilot:last-child {
            border-bottom: none;
        }

        /* Verification Form Overlay */
        .verification-overlay {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background-color: rgba(0, 0, 0, 0.7);
            z-index: 10000;
            display: flex;
            justify-content: center;
            align-items: center;
        }

        .verification-form {
            background: white;
            padding: 30px;
            border-radius: 10px;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
            max-width: 500px;
            width: 90%;
            text-align: center;
        }

        .verification-form h3 {
            margin-top: 0;
            color: #333;
        }

        .verification-form p {
            color: #666;
            line-height: 1.5;
            margin: 15px 0;
        }

        .verification-form input[type="number"] {
            width: 100px;
            padding: 8px;
            font-size: 16px;
            border: 2px solid #ddd;
            border-radius: 5px;
            text-align: center;
            margin: 10px;
        }

        .verification-form .form-buttons {
            margin-top: 20px;
        }

        .verification-form button {
            padding: 10px 20px;
            margin: 5px;
            border: none;
            border-radius: 5px;
            cursor: pointer;
            font-size: 14px;
            font-weight: bold;
        }

        .verification-form .submit-btn {
            background-color: #28a745;
            color: white;
        }

        .verification-form .submit-btn:hover {
            background-color: #218838;
        }

        .verification-form .cancel-btn {
            background-color: #6c757d;
            color: white;
        }

        .verification-form .cancel-btn:hover {
            background-color: #5a6268;
        }

        .trophy-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(350px, 1fr));
            gap: 20px;
        }

        .trophy-item {
            background: rgba(255,255,255,0.08);
            border-radius: 6px;
            padding: 15px;
            border-left: 4px solid #ffd700;
        }

        .trophy-item h4 {
            margin: 0 0 8px 0;
            color: #ffd700;
            font-size: 1.1em;
        }

        .trophy-desc {
            color: #ccc;
            font-size: 0.9em;
            margin: 0 0 12px 0;
            font-style: italic;
        }

        .winner {
            margin: 8px 0;
            padding: 8px 0;
            border-bottom: 1px solid rgba(255,255,255,0.1);
        }

        .winner:last-child {
            border-bottom: none;
        }

        .winner strong {
            color: white;
            margin-right: 8px;
        }

        .trophy-score {
            color: #4CAF50;
            font-weight: bold;
            margin-left: 8px;
        }

        .flight-details {
            margin: 4px 0;
            font-size: 0.9em;
        }

        .flight-details .task-badge {
            margin-right: 12px;
            color: white;
        }

        .flight-details span {
            margin-right: 12px;
        }

        .flight-distance {
            color: #64b5f6 !important;
        }

        .flight-speed {
            color: #ff9800 !important;
        }

        .task-name {
            color: #9c27b0 !important;
            font-style: italic;
        }

        .flight-link {
            color: #64b5f6;
            text-decoration: none;
            font-size: 0.85em;
            margin-left: 8px;
        }

        .flight-link:hover {
            text-decoration: underline;
        }

        .calculation-note {
            color: #aaa;
            font-size: 0.65em;
            margin: 4px 0 0 0;
            font-style: italic;
            opacity: 0.8;
        }

        .no-winner {
            color: #888;
            font-style: italic;
            margin: 8px 0;
        }

        .combined-winner {
            border-left: 3px solid #4CAF50;
            padding-left: 8px;
        }

        .free-winner {
            border-left: 3px solid #2196F3;
            padding-left: 8px;
        }

        .flight-winner {
            border-left: 3px solid #ffd700;
            padding-left: 8px;
        }

        /* Mobile responsive */
        @media (max-width: 768px) {
            .trophy-grid {
                grid-template-columns: 1fr;
                gap: 15px;
            }

            .trophy-item {
                padding: 12px;
            }

            .trophy-header {
                padding: 12px 15px;
            }

            .trophy-content {
                padding: 15px;
            }
        }

        /* Task stats section styling */
        .task-stats-section {
            margin: 10px auto;
            max-width: 800px;
            background: rgba(255,255,255,0.95);
            border: 1px solid rgba(255,255,255,0.2);
            border-radius: 6px;
            overflow: hidden;
            font-size: 0.85em;
        }

        .task-stats-header {
            background: rgba(255,255,255,0.1);
            padding: 8px 12px;
            cursor: pointer;
            user-select: none;
            border-bottom: 1px solid rgba(255,255,255,0.1);
        }

        .task-stats-header:hover {
            background: rgba(255,255,255,0.15);
        }

        .task-stats-header h5 {
            margin: 0;
            font-size: 0.9em;
            color: #2c3e50;
            display: flex;
            justify-content: space-between;
            align-items: center;
            font-weight: 500;
        }

        .task-stats-content {
            padding: 10px 12px;
            background: rgba(255,255,255,0.98);
        }

        /* Table wrapper for horizontal scrolling on mobile */
        .task-stats-table-wrapper {
            overflow-x: auto;
            -webkit-overflow-scrolling: touch;
            margin: 0;
            border-radius: 4px;
            border: 1px solid #dee2e6;
        }

        .task-stats-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 0.8em;
            min-width: 650px; /* Ensure minimum width to prevent crushing */
            border: none; /* Remove border since wrapper has it */
        }

        /* Mobile responsiveness */
        @media (max-width: 768px) {
            .task-stats-table {
                font-size: 0.7em;
                min-width: 600px; /* Slightly smaller on mobile */
            }

            .task-stats-content {
                padding: 8px 10px;
            }

            .task-stats-table-wrapper {
                /* Add scrollbar hint on mobile */
                border-left: 3px solid #007bff;
            }

            .task-stats-table-wrapper::after {
                content: "← Scroll for more →";
                display: block;
                text-align: center;
                font-size: 0.65em;
                color: #6c757d;
                padding: 4px;
                background: #f8f9fa;
                border-top: 1px solid #dee2e6;
                font-style: italic;
            }
        }

        .task-stats-table th {
            background: #f8f9fa;
            padding: 6px 8px;
            text-align: left;
            border-bottom: 1px solid #dee2e6;
            font-weight: 600;
            color: #495057;
        }

        .task-stats-table td {
            padding: 4px 8px;
            border-bottom: 1px solid #f1f3f4;
            color: #333;
        }

        .task-stats-table .task-code {
            font-family: monospace;
            font-weight: bold;
            color: #0056b3;
        }

        .task-stats-table .task-count {
            text-align: center;
            font-weight: 600;
        }

        .task-stats-table .task-finished {
            text-align: center;
            font-weight: 600;
            color: #28a745;
        }

        .task-stats-table .task-igc {
            text-align: center;
            font-weight: 600;
            color: #6c757d;
        }

        .task-stats-table .task-weglide {
            text-align: center;
            font-weight: 600;
            color: #007bff;
        }

        .task-description {
            color: #666;
        }

        .mock-notice {
            font-size: 0.85em;
            color: rgba(255, 255, 255, 0.85);
            text-align: center;
            margin: 12px 0 0;
        }

        .mock-notice {
            font-size: 0.85em;
            color: rgba(255, 255, 255, 0.8);
        }

        #leaderboardTable.three-flight-mode th:nth-child(7),
        #leaderboardTable.three-flight-mode th:nth-child(8),
        #leaderboardTable.three-flight-mode td:nth-child(7),
        #leaderboardTable.three-flight-mode td:nth-child(8) {
            display: none;
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
                            <button class="toggle-btn ${this.currentMode === 'sacDsc' ? 'active' : ''}" data-mode="sacDsc">SAC-DSC</button>
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
            case 'sacDsc': return this.data.sacDscLeaderboard; 
            case 'mixed': return this.data.mixedLeaderboard;
            case 'free': return this.data.freeLeaderboard;
            case 'sprint': return this.data.sprintLeaderboard;
            case 'triangle': return this.data.triangleLeaderboard;
            case 'out_return': return this.data.outReturnLeaderboard;
            case 'out': return this.data.outLeaderboard;
            case 'silverCGull': return this.data.silverCgullLeaderboard;
            default: return this.data.sacDscLeaderboard;
        }
    }

    getMaxFlights() {
        return (['sprint', 'triangle', 'out_return', 'out'].includes(this.currentMode)) ? 3 : 5;
    }

    getScoringDescription() {
        if (this.currentMode === 'sacDsc') return `Best 5 flights per pilot • SAC-DSC scoring • ${this.data.meta.seasonLabel}`;
        if (this.currentMode === 'mixed') return `Best 5 flights per pilot • Higher of Task or Free scoring • ${this.data.meta.seasonLabel}`;
        if (this.currentMode === 'free') return `Best 5 flights per pilot • Free scoring only • ${this.data.meta.freeSeasonLabel}`;
        return `Top ${this.getMaxFlights()} flights per pilot • WeGlide ${this.currentMode} scoring • ${this.data.meta.seasonLabel}`;
    }

    applyUnder200Filter(list) {
        if (!this.under200Enabled) return list;
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
        // MVP: simple list if complex logic isn't ported
        return '<p style="text-align:center; color:#888;">Detailed trophy logic pending web component port.</p>';
    }

    addEventListeners() {
        this.shadowRoot.querySelectorAll('.toggle-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                this.currentMode = e.target.dataset.mode;
                this.render();
                this.addEventListeners();
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