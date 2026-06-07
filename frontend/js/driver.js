/* ===== ERide — Driver Logic ===== */

const DriverApp = {
    state: 'offline', // offline | online | active | completed
    isOnline: false,
    currentLat: null,
    currentLng: null,
    locationWatchId: null,
    locationSendInterval: null,
    activeRide: null,   // { ride_id, rider_name, rider_phone, pickup_lat, pickup_lng, pickup_name, dest_lat, dest_lng, dest_name }
    pendingRequests: {}, // ride_id -> { data, timer, element }
    mapInstance: null,
    _activeMap: null,
    _activeMarkers: {},
    _activeRoute: null,
    activeTab: 'rides',
    demandChartInstance: null,

    /* ---- Initialization ---- */
    init() {
        if (!App.requireAuth('driver')) return;

        // Set user name
        const nameEl = document.getElementById('user-name');
        if (nameEl) nameEl.textContent = App.user.name || 'Driver';

        this.getLocation();
        this.initOfflineMap();

        // Connect WebSocket
        App.connectWS((type, data) => this.onWSMessage(type, data));

        // Enforce UPI setup prompt immediately on load if missing
        if (!App.user.upi_id) {
            document.getElementById('upi-prompt-modal').classList.remove('hidden');
        }
    },

    /* ---- Tabs Switcher ---- */
    switchTab(tab) {
        this.activeTab = tab;
        
        // Update tab buttons
        document.querySelectorAll('.dash-tab').forEach(btn => {
            if (btn.getAttribute('data-tab') === tab) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });
        
        // Update content sections
        document.querySelectorAll('.tab-content-section').forEach(sec => {
            if (sec.id === `tab-content-${tab}`) {
                sec.classList.remove('hidden');
            } else {
                sec.classList.add('hidden');
            }
        });
        
        // Trigger tab specific loads
        if (tab === 'scheduled') {
            this.loadScheduledRides();
        } else if (tab === 'stats') {
            this.loadDashboardStats();
            this.loadDemandAnalytics();
            this.loadForecastHotspots();
        } else if (tab === 'rides') {
            // Re-invalidate map sizes
            setTimeout(() => {
                if (this.state === 'online' && this._onlineMap) this._onlineMap.invalidateSize();
                if (this.state === 'active' && this._activeMap) this._activeMap.invalidateSize();
                if (this.state === 'offline' && this._offlineMap) this._offlineMap.invalidateSize();
            }, 100);
        }
    },

    /* ---- Map ---- */
    initOfflineMap() {
        const mapEl = document.getElementById('offline-map');
        if (mapEl && !mapEl._leaflet_id) {
            this._offlineMap = L.map('offline-map', {
                center: CAMPUS_CENTER,
                zoom: 16,
                zoomControl: false,
                attributionControl: false,
                dragging: false,
                scrollWheelZoom: false,
            });
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(this._offlineMap);
        }
    },

    initOnlineMap() {
        const mapEl = document.getElementById('online-map');
        if (mapEl && !mapEl._leaflet_id) {
            this._onlineMap = L.map('online-map', {
                center: [this.currentLat || CAMPUS_CENTER[0], this.currentLng || CAMPUS_CENTER[1]],
                zoom: 16,
                zoomControl: false,
                attributionControl: false,
            });
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(this._onlineMap);
            L.control.zoom({ position: 'topright' }).addTo(this._onlineMap);

            // Add Standard / Satellite toggle control
            const tilesStandard = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 });
            const tilesSatellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19 });
            const self = this;
            
            const toggleBtn = L.control({ position: 'topleft' });
            toggleBtn.onAdd = function() {
                const div = L.DomUtil.create('div', 'map-toggle-control');
                div.innerHTML = '🗺️ Map View';
                div.style.padding = '6px 10px';
                div.style.cursor = 'pointer';
                div.style.fontWeight = '600';
                div.style.fontSize = '0.7rem';
                div.style.borderRadius = '6px';
                div.style.border = '1px solid rgba(255, 255, 255, 0.12)';
                div.style.background = 'rgba(18, 18, 42, 0.85)';
                div.style.color = '#ffffff';
                
                div.onclick = function(e) {
                    e.stopPropagation();
                    if (self._onlineMap.hasLayer(tilesStandard)) {
                        self._onlineMap.removeLayer(tilesStandard);
                        tilesSatellite.addTo(self._onlineMap);
                        div.innerHTML = '🛰️ Satellite';
                    } else {
                        self._onlineMap.removeLayer(tilesSatellite);
                        tilesStandard.addTo(self._onlineMap);
                        div.innerHTML = '🗺️ Map View';
                    }
                };
                return div;
            };
            toggleBtn.addTo(this._onlineMap);
        }
        // Add/update driver marker
        if (this._onlineMap && this.currentLat && this.currentLng) {
            if (this._onlineMarker) {
                this._onlineMarker.setLatLng([this.currentLat, this.currentLng]);
            } else {
                this._onlineMarker = L.marker([this.currentLat, this.currentLng], {
                    icon: CampusMap.createRickshawIcon(),
                }).addTo(this._onlineMap).bindPopup('You');
            }
            this._onlineMap.setView([this.currentLat, this.currentLng], 16);
        }
    },

    initActiveMap() {
        const mapEl = document.getElementById('active-map');
        if (mapEl && !mapEl._leaflet_id) {
            this._activeMap = L.map('active-map', {
                center: [this.currentLat || CAMPUS_CENTER[0], this.currentLng || CAMPUS_CENTER[1]],
                zoom: 15,
                zoomControl: false,
                attributionControl: false,
            });
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(this._activeMap);

            // Add Standard / Satellite toggle control
            const tilesStandard = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 });
            const tilesSatellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19 });
            const self = this;
            
            const toggleBtn = L.control({ position: 'topleft' });
            toggleBtn.onAdd = function() {
                const div = L.DomUtil.create('div', 'map-toggle-control');
                div.innerHTML = '🗺️ Map View';
                div.style.padding = '6px 10px';
                div.style.cursor = 'pointer';
                div.style.fontWeight = '600';
                div.style.fontSize = '0.7rem';
                div.style.borderRadius = '6px';
                div.style.border = '1px solid rgba(255, 255, 255, 0.12)';
                div.style.background = 'rgba(18, 18, 42, 0.85)';
                div.style.color = '#ffffff';
                
                div.onclick = function(e) {
                    e.stopPropagation();
                    if (self._activeMap.hasLayer(tilesStandard)) {
                        self._activeMap.removeLayer(tilesStandard);
                        tilesSatellite.addTo(self._activeMap);
                        div.innerHTML = '🛰️ Satellite';
                    } else {
                        self._activeMap.removeLayer(tilesSatellite);
                        tilesStandard.addTo(self._activeMap);
                        div.innerHTML = '🗺️ Map View';
                    }
                };
                return div;
            };
            toggleBtn.addTo(this._activeMap);
        }
        this.updateActiveMap();
    },

    updateActiveMap() {
        if (!this._activeMap || !this.activeRide) return;

        // Clear
        Object.values(this._activeMarkers).forEach(m => this._activeMap.removeLayer(m));
        this._activeMarkers = {};
        if (this._activeRoute) {
            this._activeMap.removeLayer(this._activeRoute);
        }

        const ride = this.activeRide;

        // Driver marker (green)
        if (this.currentLat && this.currentLng) {
            this._activeMarkers.driver = L.marker([this.currentLat, this.currentLng], {
                icon: CampusMap.createRickshawIcon(),
            }).addTo(this._activeMap).bindPopup('You');
        }

        // Pickup marker (blue)
        if (ride.pickup_lat && ride.pickup_lng) {
            this._activeMarkers.pickup = L.marker([ride.pickup_lat, ride.pickup_lng], {
                icon: CampusMap.createPickupIcon(),
            }).addTo(this._activeMap).bindPopup(`Pickup: ${ride.pickup_name || 'Rider'}`);
        }

        // Destination marker (red)
        if (ride.dest_lat && ride.dest_lng) {
            this._activeMarkers.dest = L.marker([ride.dest_lat, ride.dest_lng], {
                icon: CampusMap.createDestIcon(),
            }).addTo(this._activeMap).bindPopup(`Dest: ${ride.dest_name || 'Destination'}`);
        }

        // Route line: Dijkstra optimized
        if (this.currentLat && this.currentLng && ride.pickup_lat && ride.pickup_lng && ride.dest_lat && ride.dest_lng) {
            const points = CampusMap.getRoutePoints(this.currentLat, this.currentLng, ride.pickup_lat, ride.pickup_lng);
            const destPoints = CampusMap.getRoutePoints(ride.pickup_lat, ride.pickup_lng, ride.dest_lat, ride.dest_lng);
            const totalRoute = points.concat(destPoints.slice(1));

            this._activeRoute = L.polyline(totalRoute, {
                color: '#00ff88',
                weight: 4,
                opacity: 0.8,
                dashArray: '8, 8',
                lineJoin: 'round',
            }).addTo(this._activeMap);

            this._activeMap.fitBounds(totalRoute, { padding: [50, 50], maxZoom: 17 });
        }
    },

    _offlineMap: null,
    _onlineMap: null,
    _onlineMarker: null,

    /* ---- Geolocation ---- */
    getLocation() {
        if (!navigator.geolocation) {
            this.currentLat = CAMPUS_CENTER[0];
            this.currentLng = CAMPUS_CENTER[1];
            return;
        }

        navigator.geolocation.getCurrentPosition(
            (pos) => {
                this.currentLat = pos.coords.latitude;
                this.currentLng = pos.coords.longitude;
            },
            () => {
                this.currentLat = CAMPUS_CENTER[0];
                this.currentLng = CAMPUS_CENTER[1];
            },
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
        );
    },

    updateLocation(lat, lng) {
        this.currentLat = lat;
        this.currentLng = lng;
        if (this._onlineMarker && this._onlineMap) this._onlineMarker.setLatLng([lat, lng]);
        if (this.state === 'active' && this._activeMap && this._activeMarkers.driver) this._activeMarkers.driver.setLatLng([lat, lng]);
    },

    startLocationTracking() {
        if (this.locationInterval) clearInterval(this.locationInterval);

        const updateLocation = () => {
            if (!navigator.geolocation) return;
            navigator.geolocation.getCurrentPosition(
                (pos) => this.updateLocation(pos.coords.latitude, pos.coords.longitude),
                (err) => console.warn('Location error:', err),
                { enableHighAccuracy: true, timeout: 5000 }
            );
        };

        updateLocation();
        this.locationInterval = setInterval(updateLocation, 5000);

        // Send location updates every 5 seconds
        this.locationSendInterval = setInterval(() => {
            if (this.currentLat && this.currentLng && this.isOnline) {
                App.sendWS('LOCATION_UPDATE', {
                    lat: this.currentLat,
                    lng: this.currentLng,
                });
            }
        }, 5000);
    },

    stopLocationTracking() {
        if (this.locationWatchId !== null) {
            navigator.geolocation.clearWatch(this.locationWatchId);
            this.locationWatchId = null;
        }
        if (this.locationSendInterval) {
            clearInterval(this.locationSendInterval);
            this.locationSendInterval = null;
        }
        if (this.locationInterval) {
            clearInterval(this.locationInterval);
            this.locationInterval = null;
        }
    },

    /* ---- Online/Offline Toggle ---- */
    toggleOnline() {
        if (!App.user.upi_id) {
            document.getElementById('upi-prompt-modal').classList.remove('hidden');
            App.showToast('Please set your UPI ID first to receive cashless payments!', 'warning');
            return;
        }

        this.isOnline = !this.isOnline;
        const toggle = document.getElementById('online-toggle');
        const label = document.getElementById('toggle-label');

        if (this.isOnline) {
            toggle.classList.add('active');
            label.textContent = 'Online';
            this.setState('online');
            this.startLocationTracking();
            App.showToast('You are now online! 🟢', 'success');
        } else {
            toggle.classList.remove('active');
            label.textContent = 'Offline';
            this.setState('offline');
            this.stopLocationTracking();
            this.clearPendingRequests();
            App.showToast('You are now offline', 'info');
        }
    },

    /* ---- Save UPI Setup Prompt ---- */
    async saveUpiPrompt(e) {
        e.preventDefault();
        const upiId = document.getElementById('prompt-upi').value.trim();
        if (!upiId) return;

        const qrFileInput = document.getElementById('prompt-qr-file');
        let qrBase64 = null;
        if (qrFileInput && qrFileInput.files.length > 0) {
            try {
                qrBase64 = await getBase64(qrFileInput.files[0]);
            } catch (err) {
                console.error("Failed to parse QR code file:", err);
                App.showToast("Could not read QR image file", "error");
            }
        }

        const btn = document.getElementById('upi-prompt-btn');
        btn.disabled = true;
        btn.innerHTML = '<div class="spinner spinner-sm"></div><span>Saving...</span>';

        try {
            const data = await App.api('/api/auth/profile', {
                method: 'PUT',
                body: {
                    name: App.user.name,
                    phone: App.user.phone,
                    vehicle_number: App.user.vehicle_number || '',
                    license_number: App.user.license_number || '',
                    upi_id: upiId,
                    qr_base64: qrBase64
                }
            });

            App.user = data.user;
            localStorage.setItem('eride_user', JSON.stringify(data.user));

            document.getElementById('upi-prompt-modal').classList.add('hidden');
            App.showToast('UPI ID configured successfully! 👍', 'success');

            // Auto toggle online
            if (!this.isOnline) {
                this.toggleOnline();
            }
        } catch (err) {
            App.showToast(err.message, 'error');
        } finally {
            btn.disabled = false;
            btn.innerHTML = 'Save & Go Online';
        }
    },

    /* ---- State Management ---- */
    setState(newState) {
        this.state = newState;

        ['offline', 'online', 'active', 'completed'].forEach(s => {
            document.getElementById(`state-${s}`).classList.add('hidden');
        });

        document.getElementById(`state-${newState}`).classList.remove('hidden');

        switch (newState) {
            case 'online':
                setTimeout(() => this.initOnlineMap(), 200);
                break;
            case 'active':
                setTimeout(() => this.initActiveMap(), 200);
                break;
            case 'completed':
                // Removed auto-dismiss timer so driver has time to read ratings and click "Back to Online Mode"
                break;
        }
    },

    /* ---- Ride Request Cards ---- */
    addRideRequestCard(data) {
        const container = document.getElementById('ride-requests');
        const noRides = document.getElementById('no-rides-msg');
        if (noRides) noRides.classList.add('hidden');

        const rideId = data.ride_id;

        if (this.pendingRequests[rideId]) return;

        const card = document.createElement('div');
        card.className = 'ride-card';
        card.id = `ride-card-${rideId}`;

        let timerSeconds = 30;

        card.innerHTML = `
            <div class="ride-header">
                <h3>🙋 ${data.rider_name || 'Rider'}</h3>
                <span class="ride-timer" id="timer-${rideId}">${timerSeconds}s</span>
            </div>
            <div class="ride-info">
                <div class="info-row">
                    <div class="info-icon pickup">📍</div>
                    <div>
                        <div class="info-label">Pickup</div>
                        <div class="info-value">${data.pickup_name || 'Unknown'}</div>
                    </div>
                </div>
                <div class="route-divider"><div class="route-line"></div></div>
                <div class="info-row">
                    <div class="info-icon dest">🏁</div>
                    <div>
                        <div class="info-label">Destination</div>
                        <div class="info-value">${data.dest_name || 'Unknown'}</div>
                    </div>
                </div>
            </div>
            <div class="ride-meta">
                <div class="meta-item">
                    <span class="meta-value">${data.distance_km ? data.distance_km.toFixed(1) : '—'}</span>
                    <span class="meta-label">KM</span>
                </div>
                <div class="meta-item">
                    <span class="meta-value">${data.eta_minutes || '—'}</span>
                    <span class="meta-label">MIN ETA</span>
                </div>
            </div>
            <div style="display: flex; gap: 10px;">
                <button class="btn btn-outline btn-lg" style="flex: 1; border-color: rgba(255, 255, 255, 0.2); color: var(--text-secondary);" onclick="DriverApp.rejectRide('${rideId}')">
                    ✕ Reject
                </button>
                <button class="btn btn-primary btn-lg" style="flex: 2;" onclick="DriverApp.acceptRide('${rideId}')">
                    ⚡ Accept
                </button>
            </div>
        `;

        container.appendChild(card);

        const timer = setInterval(() => {
            timerSeconds--;
            const timerEl = document.getElementById(`timer-${rideId}`);
            if (timerEl) {
                timerEl.textContent = `${timerSeconds}s`;
                if (timerSeconds <= 5) timerEl.style.color = 'var(--danger)';
            }
            if (timerSeconds <= 0) {
                this.removeRideRequestCard(rideId);
            }
        }, 1000);

        this.pendingRequests[rideId] = { data, timer, element: card };
    },

    removeRideRequestCard(rideId) {
        const req = this.pendingRequests[rideId];
        if (!req) return;

        clearInterval(req.timer);
        if (req.element && req.element.parentNode) {
            req.element.style.animation = 'fadeIn 0.3s ease-out reverse forwards';
            setTimeout(() => {
                if (req.element.parentNode) req.element.parentNode.removeChild(req.element);
                if (Object.keys(this.pendingRequests).length === 0) {
                    const noRides = document.getElementById('no-rides-msg');
                    if (noRides) noRides.classList.remove('hidden');
                }
            }, 300);
        }
        delete this.pendingRequests[rideId];
    },

    clearPendingRequests() {
        Object.keys(this.pendingRequests).forEach(rideId => {
            this.removeRideRequestCard(rideId);
        });
    },

    /* ---- Reject Ride ---- */
    rejectRide(rideId) {
        this.removeRideRequestCard(rideId);
    },

    /* ---- Accept Ride ---- */
    acceptRide(rideId) {
        const req = this.pendingRequests[rideId];
        if (!req) return;

        App.sendWS('RIDE_ACCEPTED', { ride_id: rideId });
        App.showToast('Ride accepted! Heading to pickup...', 'success');

        this.activeRide = {
            ride_id: rideId,
            rider_name: req.data.rider_name,
            rider_phone: req.data.rider_phone || '',
            pickup_lat: req.data.pickup_lat,
            pickup_lng: req.data.pickup_lng,
            pickup_name: req.data.pickup_name,
            dest_lat: req.data.dest_lat,
            dest_lng: req.data.dest_lng,
            dest_name: req.data.dest_name,
            status: 'accepted'
        };

        this.clearPendingRequests();

        document.getElementById('rider-name').textContent = req.data.rider_name || 'Rider';
        const phoneEl = document.getElementById('rider-phone');
        phoneEl.textContent = App.formatPhone(req.data.rider_phone || '');
        phoneEl.href = `tel:${req.data.rider_phone || ''}`;

        document.getElementById('active-pickup').textContent = req.data.pickup_name || 'Pickup';
        document.getElementById('active-dest').textContent = req.data.dest_name || 'Destination';

        document.getElementById('start-ride-btn').classList.remove('hidden');
        document.getElementById('complete-btn').classList.add('hidden');

        const badge = document.getElementById('active-status-badge');
        if (badge) {
            badge.innerHTML = '<span>Active Ride — En Route to Pickup</span>';
            badge.style.background = 'var(--accent)';
        }

        this.setState('active');
    },

    /* ---- Start Ride ---- */
    startRide() {
        if (!this.activeRide) return;
        App.sendWS('RIDE_STARTED', { ride_id: this.activeRide.ride_id });
    },

    /* ---- Complete Ride ---- */
    completeRide() {
        if (!this.activeRide) return;
        App.sendWS('RIDE_COMPLETED', { ride_id: this.activeRide.ride_id });
        App.showToast('Ride completed! 🎉', 'success');
        this.setState('completed');
    },

    /* ---- Scheduled Bookings Tab ---- */
    async loadScheduledRides() {
        const loading = document.getElementById('scheduled-loading');
        const empty = document.getElementById('scheduled-empty');
        const deck = document.getElementById('scheduled-deck-list');

        loading.classList.remove('hidden');
        empty.classList.add('hidden');
        deck.innerHTML = '';

        try {
            const data = await App.api('/api/rides/scheduled/available');
            const rides = data.rides || [];

            loading.classList.add('hidden');
            if (rides.length === 0) {
                empty.classList.remove('hidden');
                return;
            }

            rides.forEach(ride => {
                const card = document.createElement('div');
                card.className = 'glass-card scheduled-card mb-2';

                const time = new Date(ride.scheduled_time).toLocaleString('en-IN', {
                    day: 'numeric', month: 'short',
                    hour: '2-digit', minute: '2-digit'
                });

                card.innerHTML = `
                    <div class="scheduled-header">
                        <span class="scheduled-time">📅 ${time}</span>
                        <span class="status-badge warning">Scheduled</span>
                    </div>
                    <div class="ride-info mt-2">
                        <div class="info-row">
                            <span class="info-icon pickup">📍</span>
                            <span class="info-value">${ride.pickup_name}</span>
                        </div>
                        <div class="route-divider" style="margin:2px 0;"><div class="route-line" style="height:10px;"></div></div>
                        <div class="info-row">
                            <span class="info-icon dest">🏁</span>
                            <span class="info-value">${ride.dest_name}</span>
                        </div>
                    </div>
                    <button class="btn btn-primary btn-block mt-3" onclick="DriverApp.claimSchedule('${ride.id}')">
                        ⚡ Claim Booking
                    </button>
                `;
                deck.appendChild(card);
            });
        } catch (err) {
            loading.classList.add('hidden');
            App.showToast('Failed to load bookings: ' + err.message, 'error');
        }
    },

    async claimSchedule(rideId) {
        try {
            const data = await App.api(`/api/rides/scheduled/${rideId}/claim`, {
                method: 'POST'
            });
            App.showToast('Booking claimed successfully! 🛺', 'success');

            const ride = data.ride;
            this.activeRide = {
                ride_id: ride.id,
                rider_name: 'Rider',
                rider_phone: '',
                pickup_lat: ride.pickup_lat,
                pickup_lng: ride.pickup_lng,
                pickup_name: ride.pickup_name,
                dest_lat: ride.dest_lat,
                dest_lng: ride.dest_lng,
                dest_name: ride.dest_name,
                status: 'accepted'
            };

            if (!this.isOnline) {
                this.toggleOnline();
            }

            document.getElementById('rider-name').textContent = 'Rider';
            document.getElementById('rider-phone').textContent = 'Call via App';
            document.getElementById('rider-phone').href = 'tel:';
            document.getElementById('active-pickup').textContent = ride.pickup_name;
            document.getElementById('active-dest').textContent = ride.dest_name;

            document.getElementById('start-ride-btn').classList.remove('hidden');
            document.getElementById('complete-btn').classList.add('hidden');

            const badge = document.getElementById('active-status-badge');
            if (badge) {
                badge.innerHTML = '<span>Active Ride — En Route to Pickup</span>';
                badge.style.background = 'var(--accent)';
            }

            this.setState('active');
            this.switchTab('rides');
        } catch (err) {
            App.showToast('Failed to claim booking: ' + err.message, 'error');
        }
    },

    /* ---- Performance Analytics Dashboard ---- */
    async loadDashboardStats() {
        try {
            const data = await App.api('/api/rides/stats/driver');

            document.getElementById('stats-total-rides').textContent = data.completed_rides;
            document.getElementById('stats-avg-rating').textContent = data.average_rating.toFixed(1);
            document.getElementById('stats-active-rides').textContent = data.active_rides;

            const wall = document.getElementById('feedback-wall');
            wall.innerHTML = '';

            const feedbacks = data.feedbacks || [];
            if (feedbacks.length === 0) {
                wall.innerHTML = '<div class="text-center text-muted py-3">No feedbacks received yet</div>';
            } else {
                feedbacks.forEach(f => {
                    const item = document.createElement('div');
                    item.className = 'glass-card feedback-item mb-2';
                    const starsStr = '⭐'.repeat(f.rating);
                    const date = new Date(f.created_at).toLocaleDateString('en-IN', {
                        day: 'numeric', month: 'short'
                    });
                    item.innerHTML = `
                        <div class="feedback-header" style="display:flex;justify-content:space-between;font-size:0.8rem;color:var(--text-secondary);">
                            <span class="feedback-stars">${starsStr}</span>
                            <span class="feedback-date">${date}</span>
                        </div>
                        <p class="feedback-text mt-1" style="font-size:0.85rem;font-style:italic;">"${f.feedback}"</p>
                    `;
                    wall.appendChild(item);
                });
            }
        } catch (err) {
            console.error('Stats loading failed:', err);
        }
    },

    async loadDemandAnalytics() {
        try {
            const data = await App.api('/api/rides/analytics/demand');
            this.renderDemandChart(data.hourly_demand || []);
        } catch (err) {
            console.error('Demand analytics loading failed:', err);
        }
    },

    renderDemandChart(hourlyData) {
        const ctx = document.getElementById('demandChart');
        if (!ctx) return;

        if (this.demandChartInstance) {
            this.demandChartInstance.destroy();
        }

        const labels = Array.from({ length: 24 }, (_, i) => {
            const ampm = i >= 12 ? 'PM' : 'AM';
            const hour = i % 12 === 0 ? 12 : i % 12;
            return `${hour} ${ampm}`;
        });

        this.demandChartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Completed Rides',
                    data: hourlyData,
                    borderColor: '#00ff88',
                    backgroundColor: 'rgba(0, 255, 136, 0.1)',
                    borderWidth: 2,
                    tension: 0.4,
                    fill: true,
                    pointBackgroundColor: '#00ff88',
                    pointHoverRadius: 6
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false }
                },
                scales: {
                    x: {
                        grid: { display: false },
                        ticks: { color: 'rgba(255, 255, 255, 0.5)', font: { size: 9 } }
                    },
                    y: {
                        grid: { color: 'rgba(255, 255, 255, 0.08)' },
                        ticks: { color: 'rgba(255, 255, 255, 0.5)', font: { size: 9 }, stepSize: 1 }
                    }
                }
            }
        });
    },

    async loadForecastHotspots() {
        const list = document.getElementById('forecast-list');
        if (!list) return;

        list.innerHTML = '<div class="text-center py-2"><div class="spinner spinner-sm"></div></div>';

        try {
            const data = await App.api('/api/rides/analytics/forecast');
            const predictions = data.predictions || [];

            list.innerHTML = '';

            predictions.forEach(p => {
                const item = document.createElement('div');
                item.className = 'forecast-item glass-card mb-2';
                
                const badgeClass = p.probability > 75 ? 'danger' : p.probability > 45 ? 'warning' : 'success';
                
                item.innerHTML = `
                    <div class="forecast-header" style="display:flex;justify-content:space-between;align-items:center;">
                        <span class="forecast-location" style="font-weight:600;font-size:0.85rem;">📍 ${p.location}</span>
                        <span class="status-badge ${badgeClass}" style="font-size:0.7rem;padding:2px 8px;">${p.probability}% Prob</span>
                    </div>
                    <div class="forecast-reason mt-1" style="font-size:0.75rem;color:var(--text-secondary);">${p.reason}</div>
                `;
                list.appendChild(item);
            });
        } catch (err) {
            list.innerHTML = '<div class="text-center text-muted py-2">Forecast unavailable</div>';
        }
    },

    /* ---- Profile updates ---- */
    async handleProfileUpdate(e) {
        e.preventDefault();
        const name = document.getElementById('profile-name').value.trim();
        const phone = document.getElementById('profile-phone').value.trim();
        const vehicle = document.getElementById('profile-vehicle').value.trim();
        const license = document.getElementById('profile-license').value.trim();
        const upi = document.getElementById('profile-upi').value.trim();
        const password = document.getElementById('profile-password').value;

        const qrFileInput = document.getElementById('profile-qr-file');
        let qrBase64 = App.user.qr_base64 || null;
        if (qrFileInput && qrFileInput.files.length > 0) {
            try {
                qrBase64 = await getBase64(qrFileInput.files[0]);
            } catch (err) {
                console.error("Failed to parse QR code file:", err);
                App.showToast("Could not read QR image file", "error");
            }
        }

        if (!name || !phone || !vehicle || !license || !upi) {
            App.showToast('All fields are required', 'warning');
            return;
        }

        const btn = document.getElementById('profile-save-btn');
        btn.disabled = true;
        btn.innerHTML = '<div class="spinner spinner-sm"></div><span>Saving...</span>';

        try {
            const data = await App.api('/api/auth/profile', {
                method: 'PUT',
                body: {
                    name,
                    phone,
                    vehicle_number: vehicle,
                    license_number: license,
                    upi_id: upi,
                    qr_base64: qrBase64,
                    ...(password ? { password } : {})
                }
            });

            App.user = data.user;
            localStorage.setItem('eride_user', JSON.stringify(data.user));

            App.showToast('Profile updated! 🎉', 'success');
            toggleProfileModal();
        } catch (err) {
            App.showToast(err.message, 'error');
        } finally {
            btn.disabled = false;
            btn.innerHTML = 'Save Changes';
        }
    },

    /* ---- WebSocket Messages ---- */
    onWSMessage(type, data) {
        switch (type) {
            case 'RIDE_REQUEST':
                this.onRideRequest(data);
                break;
            case 'RIDE_ACCEPTED':
                this.onRideConfirmed(data);
                break;
            case 'RIDE_STARTED':
                this.onRideStarted(data);
                break;
            case 'RIDE_RATED':
                this.onRideRated(data);
                break;
            case 'RIDE_CANCELLED':
                this.onRideCancelled(data);
                break;
        }
    },

    onRideRequest(data) {
        if (this.state !== 'online') return;

        App.playSound('request');
        this.addRideRequestCard(data);
        App.showToast(`New ride request from ${data.rider_name || 'a rider'}!`, 'info');
    },

    onRideConfirmed(data) {
        App.playSound('accepted');
        document.getElementById('start-ride-btn').classList.remove('hidden');
        document.getElementById('complete-btn').classList.add('hidden');

        const badge = document.getElementById('active-status-badge');
        if (badge) {
            badge.innerHTML = '<span>Active Ride — En Route to Pickup</span>';
            badge.style.background = 'var(--accent)';
        }
    },

    onRideStarted(data) {
        App.playSound('accepted');
        App.showToast('Ride started! Heading to destination.', 'info');

        const badge = document.getElementById('active-status-badge');
        if (badge) {
            badge.innerHTML = '<span>Active Ride — Heading to Destination</span>';
            badge.style.background = 'linear-gradient(135deg, #6c5ce7 0%, #a29bfe 100%)';
        }

        document.getElementById('start-ride-btn').classList.add('hidden');
        document.getElementById('complete-btn').classList.remove('hidden');

        if (this.activeRide) {
            this.activeRide.status = 'in_progress';
            this.updateActiveMap();
        }
    },

    onRideRated(data) {
        App.playSound('completed');

        const ratingStars = '⭐'.repeat(data.rating);
        const toastMsg = `Rider rated your ride: ${ratingStars} ${data.feedback ? '"' + data.feedback + '"' : ''}`;
        App.showToast(toastMsg, 'success');

        // Update completed state UI
        const titleEl = document.getElementById('completed-title');
        const subtitleEl = document.getElementById('completed-subtitle');
        const ratingArea = document.getElementById('completed-rating-area');
        const feedbackArea = document.getElementById('completed-feedback-area');

        if (titleEl) titleEl.textContent = 'Ride Done & Rated!';
        if (subtitleEl) subtitleEl.textContent = 'Ride done, rated, thanks!';
        if (ratingArea) ratingArea.textContent = `Rating: ${ratingStars}`;
        if (feedbackArea) feedbackArea.textContent = data.feedback ? `"${data.feedback}"` : '';

        // Live refresh statistics tab if active
        if (this.activeTab === 'stats') {
            this.loadDashboardStats();
        }
    },

    goBackToOnline() {
        if (this._completedTimeout) {
            clearTimeout(this._completedTimeout);
            this._completedTimeout = null;
        }
        this.activeRide = null;
        this._activeMap = null;
        this._activeMarkers = {};
        this._activeRoute = null;

        // Reset completed UI text for next rides
        const titleEl = document.getElementById('completed-title');
        const subtitleEl = document.getElementById('completed-subtitle');
        const ratingArea = document.getElementById('completed-rating-area');
        const feedbackArea = document.getElementById('completed-feedback-area');

        if (titleEl) titleEl.textContent = 'Ride Completed!';
        if (subtitleEl) subtitleEl.textContent = 'Ride done! Thanks!';
        if (ratingArea) ratingArea.textContent = '';
        if (feedbackArea) feedbackArea.textContent = '';

        if (this.isOnline) {
            this.setState('online');
        } else {
            this.setState('offline');
        }
    },

    onRideCancelled(data) {
        const rideId = data.ride_id;
        const reason = data.reason || 'Ride was cancelled';

        if (this.pendingRequests[rideId]) {
            this.removeRideRequestCard(rideId);
            App.showToast(reason, 'warning');
        }

        if (this.activeRide && this.activeRide.ride_id === rideId) {
            this.activeRide = null;
            App.showToast(reason, 'warning');
            if (this.isOnline) {
                this.setState('online');
            } else {
                this.setState('offline');
            }
        }
    },

    /* ---- Logout ---- */
    logout() {
        this.stopLocationTracking();
        App.logout();
    },
};

/* ---- File Base64 Helper ---- */
function getBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve(reader.result);
        reader.onerror = error => reject(error);
    });
}

/* ---- Bootstrap ---- */
document.addEventListener('DOMContentLoaded', () => {
    DriverApp.init();
});
