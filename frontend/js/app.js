/* ===== ERide — Shared Application Module ===== */

const API_BASE = window.location.origin;
const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const WS_BASE = `${wsProtocol}//${window.location.host}`;

const App = {
    token: localStorage.getItem('eride_token'),
    user: JSON.parse(localStorage.getItem('eride_user') || 'null'),
    ws: null,
    _wsReconnectTimer: null,
    _wsOnMessage: null,
    _wsManualClose: false,

    /* ---- Auth ---- */
    setAuth(token, user) {
        this.token = token;
        this.user = user;
        localStorage.setItem('eride_token', token);
        localStorage.setItem('eride_user', JSON.stringify(user));
    },

    clearAuth() {
        this.token = null;
        this.user = null;
        localStorage.removeItem('eride_token');
        localStorage.removeItem('eride_user');
    },

    isLoggedIn() {
        return !!this.token;
    },

    logout() {
        this.disconnectWS();
        this.clearAuth();
        window.location.href = 'index.html';
    },

    requireAuth(role) {
        if (!this.isLoggedIn()) {
            window.location.href = 'index.html';
            return false;
        }
        if (role && this.user && this.user.role !== role) {
            window.location.href = this.user.role === 'rider' ? 'rider.html' : 'driver.html';
            return false;
        }
        return true;
    },

    /* ---- API ---- */
    async api(endpoint, options = {}) {
        const url = `${API_BASE}${endpoint}`;
        const headers = {
            'Content-Type': 'application/json',
            ...(options.headers || {}),
        };
        if (this.token) {
            headers['Authorization'] = `Bearer ${this.token}`;
        }

        try {
            const res = await fetch(url, {
                method: options.method || 'GET',
                headers,
                body: options.body ? JSON.stringify(options.body) : undefined,
            });

            const data = await res.json().catch(() => null);

            if (!res.ok) {
                const errMsg = (data && (data.detail || data.message || data.error)) || `Request failed (${res.status})`;
                throw new Error(errMsg);
            }

            return data;
        } catch (err) {
            if (err.message === 'Failed to fetch') {
                throw new Error('Unable to connect to server. Please try again.');
            }
            throw err;
        }
    },

    /* ---- WebSocket ---- */
    connectWS(onMessage) {
        this._wsOnMessage = onMessage;
        this._wsManualClose = false;

        if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
            this.ws.close();
        }

        const wsUrl = `${WS_BASE}/ws/${this.token}`;
        console.log('[WS] Connecting to', wsUrl);

        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
            console.log('[WS] Connected');
            this.showToast('Connected to server', 'success');
            if (this._wsReconnectTimer) {
                clearTimeout(this._wsReconnectTimer);
                this._wsReconnectTimer = null;
            }
            // Start heartbeat
            this._wsPingTimer = setInterval(() => {
                if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                    this.ws.send(JSON.stringify({ type: 'ping' }));
                }
            }, 30000);
        };

        this.ws.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data);
                if (msg.type === 'pong') return; // Ignore pong responses
                console.log('[WS] Received:', msg.type, msg.data);
                if (this._wsOnMessage) {
                    this._wsOnMessage(msg.type, msg.data || {});
                }
            } catch (e) {
                console.error('[WS] Failed to parse message:', e);
            }
        };

        this.ws.onclose = (event) => {
            console.log('[WS] Closed', event.code, event.reason);
            if (this._wsPingTimer) {
                clearInterval(this._wsPingTimer);
                this._wsPingTimer = null;
            }
            if (!this._wsManualClose) {
                this.showToast('Connection lost. Reconnecting...', 'warning');
                this._wsReconnectTimer = setTimeout(() => {
                    console.log('[WS] Attempting reconnect...');
                    this.connectWS(this._wsOnMessage);
                }, 3000);
            }
        };

        this.ws.onerror = (error) => {
            console.error('[WS] Error:', error);
        };
    },

    disconnectWS() {
        this._wsManualClose = true;
        if (this._wsReconnectTimer) {
            clearTimeout(this._wsReconnectTimer);
            this._wsReconnectTimer = null;
        }
        if (this._wsPingTimer) {
            clearInterval(this._wsPingTimer);
            this._wsPingTimer = null;
        }
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    },

    sendWS(type, data = {}) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            const msg = JSON.stringify({ type, data });
            console.log('[WS] Sending:', type, data);
            this.ws.send(msg);
        } else {
            console.warn('[WS] Cannot send — not connected');
            this.showToast('Not connected to server', 'error');
        }
    },

    /* ---- Toast Notifications ---- */
    showToast(message, type = 'info') {
        let container = document.getElementById('toast-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'toast-container';
            container.className = 'toast-container';
            document.body.appendChild(container);
        }

        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.innerHTML = `
            <span class="toast-icon"></span>
            <span class="toast-message">${message}</span>
        `;

        container.appendChild(toast);

        // Auto-remove after 4 seconds
        setTimeout(() => {
            toast.classList.add('removing');
            setTimeout(() => {
                if (toast.parentNode) toast.parentNode.removeChild(toast);
            }, 300);
        }, 4000);
    },

    /* ---- Helpers ---- */
    formatPhone(phone) {
        if (!phone) return '';
        const cleaned = phone.replace(/\D/g, '');
        if (cleaned.length === 10) {
            return `+91 ${cleaned.slice(0, 5)} ${cleaned.slice(5)}`;
        }
        return phone;
    },

    /* ---- Sound Notifications ---- */
    _audioCtx: null,
    
    playSound(type) {
        try {
            if (!this._audioCtx) this._audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            const ctx = this._audioCtx;
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            
            if (type === 'request') {
                osc.frequency.setValueAtTime(880, ctx.currentTime);
                osc.frequency.setValueAtTime(1100, ctx.currentTime + 0.15);
                gain.gain.setValueAtTime(0.3, ctx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4);
                osc.start(ctx.currentTime);
                osc.stop(ctx.currentTime + 0.4);
            } else if (type === 'accepted') {
                osc.frequency.setValueAtTime(523, ctx.currentTime);
                osc.frequency.setValueAtTime(659, ctx.currentTime + 0.1);
                osc.frequency.setValueAtTime(784, ctx.currentTime + 0.2);
                gain.gain.setValueAtTime(0.3, ctx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
                osc.start(ctx.currentTime);
                osc.stop(ctx.currentTime + 0.5);
            } else if (type === 'completed') {
                osc.frequency.setValueAtTime(523, ctx.currentTime);
                osc.frequency.setValueAtTime(784, ctx.currentTime + 0.15);
                osc.frequency.setValueAtTime(1047, ctx.currentTime + 0.3);
                gain.gain.setValueAtTime(0.25, ctx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.6);
                osc.start(ctx.currentTime);
                osc.stop(ctx.currentTime + 0.6);
            }
            if (navigator.vibrate) navigator.vibrate(200);
        } catch(e) { console.warn('Sound failed:', e); }
    },

    /* ---- Splash Screen ---- */
    hideSplash() {
        const splash = document.getElementById('splash-screen');
        if (splash) {
            setTimeout(() => splash.classList.add('hidden'), 800);
            setTimeout(() => { if (splash.parentNode) splash.parentNode.removeChild(splash); }, 1300);
        }
    },

    /* ---- PWA Registration ---- */
    registerSW() {
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('/sw.js').then(() => {
                console.log('[PWA] Service worker registered');
            }).catch(e => console.warn('[PWA] SW registration failed:', e));
        }
    }
};
