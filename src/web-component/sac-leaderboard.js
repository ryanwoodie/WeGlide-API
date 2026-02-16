class SACLeaderboard extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        this.boundHandleMessage = this.handleMessage.bind(this);
    }

    connectedCallback() {
        this.render();
        window.addEventListener('message', this.boundHandleMessage);
    }

    disconnectedCallback() {
        window.removeEventListener('message', this.boundHandleMessage);
    }

    handleMessage(event) {
        const iframe = this.shadowRoot.querySelector('iframe');
        if (!iframe || !event || !event.data) return;

        if (event.data.type === 'sac-resize') {
            iframe.style.height = `${event.data.height}px`;
            return;
        }

        if (event.data.type === 'sac-request-parent-viewport') {
            if (event.source !== iframe.contentWindow) return;

            const rect = iframe.getBoundingClientRect();
            if (typeof event.source.postMessage === 'function') {
                event.source.postMessage({
                    type: 'sac-parent-viewport',
                    requestId: event.data.requestId,
                    parentViewportWidth: window.innerWidth,
                    parentViewportHeight: window.innerHeight,
                    iframeRect: {
                        left: rect.left,
                        top: rect.top,
                        width: rect.width,
                        height: rect.height
                    }
                }, '*');
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
