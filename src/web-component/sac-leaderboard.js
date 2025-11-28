class SACLeaderboard extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
    }

    connectedCallback() {
        this.render();
        window.addEventListener('message', this.handleResize.bind(this));
    }

    disconnectedCallback() {
        window.removeEventListener('message', this.handleResize.bind(this));
    }

    handleResize(event) {
        if (event.data && event.data.type === 'sac-resize') {
            const iframe = this.shadowRoot.querySelector('iframe');
            if (iframe) {
                // console.log('Resizing iframe to:', event.data.height);
                iframe.style.height = `${event.data.height}px`;
            }
        }
    }

    render() {
        this.shadowRoot.innerHTML = `
            <style>
                :host {
                    display: block;
                    width: 100%;
                }
                iframe {
                    width: 100%;
                    border: none;
                    overflow: hidden; 
                    min-height: 600px; /* Initial height */
                    transition: height 0.2s ease;
                }
            </style>
            <iframe 
                src="https://sac-leaderboard.vercel.app/sac-dsc" 
                scrolling="no"
                title="SAC Leaderboard"
            ></iframe>
        `;
    }
}

customElements.define('sac-leaderboard', SACLeaderboard);