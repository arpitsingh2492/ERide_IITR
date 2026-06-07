/* ===== ERide — Rider Logic ===== */

const LANDMARK_DETAILS = {
    'Main Gate (Thomason Gate)': { emoji: '🏛️', desc: 'The historic entrance of IIT Roorkee, built in 1847. Main gateway to Roorkee city.' },
    'Roorkee Railway Station': { emoji: '🚂', desc: 'Nearest railway connectivity, located 3.5 km from the main gate.' },
    'MGCL Library': { emoji: '📚', desc: 'Mahatma Gandhi Central Library, one of India’s premier academic libraries.' },
    'Rajendra Bhawan': { emoji: '🏢', desc: 'Boys hostel named after Dr. Rajendra Prasad, located near the library.' },
    'Cautley Bhawan': { emoji: '🏢', desc: 'Boys hostel named after Sir Proby Cautley, founder of the Ganges Canal.' },
    'Govind Bhawan': { emoji: '🏢', desc: 'Boys hostel named after Pt. Govind Ballabh Pant, located near ECE department.' },
    'Kasturba Bhawan': { emoji: '🏢', desc: 'Girls hostel named after Kasturba Gandhi, located near the main gate.' },
    'Sarojini Bhawan': { emoji: '🏢', desc: 'Girls hostel named after Sarojini Naidu, located next to Kasturba Bhawan.' },
    'Azad Bhawan': { emoji: '🏢', desc: 'Boys hostel named after Chandra Shekhar Azad, located near the playground.' },
    'Jawahar Bhawan': { emoji: '🏢', desc: 'Boys hostel named after Pandit Jawaharlal Nehru, adjacent to Govind Bhawan.' },
    'Ravindra Bhawan': { emoji: '🏢', desc: 'Boys hostel named after Rabindranath Tagore, located near the Health Centre.' },
    'Ganga Bhawan': { emoji: '🏢', desc: 'Boys hostel named after the Holy Ganges River, near Cautley Bhawan.' },
    'Department of CSE': { emoji: '💻', desc: 'Department of Computer Science & Engineering, near convocation hall.' },
    'Department of ECE': { emoji: '⚡', desc: 'Department of Electronics & Communication Engineering, adjacent to CSE.' },
    'Convocation Hall': { emoji: '🎓', desc: 'The magnificent iconic hall where graduating ceremonies are held.' },
    'SAC (Student Activity Center)': { emoji: '🏸', desc: 'Hub for indoor sports, cultural societies, and student activity offices.' },
    'Nesci / CCD': { emoji: '☕', desc: 'Student hangout zone featuring Nescafe canteen and Cafe Coffee Day outlet.' },
    'Olive Garden': { emoji: '🍕', desc: 'Popular campus food court offering multi-cuisine snacks and dinners.' },
    'SBI Bank': { emoji: '🏦', desc: 'State Bank of India campus branch, providing banking services and ATMs.' },
    'Hospital (Health Centre)': { emoji: '🏥', desc: 'Campus health centre providing 24/7 medical services to residents.' }
};

const RiderApp = {
    state: 'idle', // idle | waiting | confirmed
    currentLat: null,
    currentLng: null,
    selectedDest: null,
    currentRideId: null,
    driverName: null,
    driverPhone: null,
    driverLat: null,
    driverLng: null,
    currentRating: 0,
    mapInstance: null,
    _onlineDriverMarkers: {},

    /* ---- Initialization ---- */
    init() {
        if (!App.requireAuth('rider')) return;

        // Set user name
        document.getElementById('user-name').textContent = App.user.name || 'Rider';

        this.getLocation();
        this.initMap();
        this.populateDestinations();

        // Connect WebSocket
        App.connectWS((type, data) => this.onWSMessage(type, data));

        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            const selector = document.getElementById('dest-selector');
            if (selector && !selector.contains(e.target)) {
                document.getElementById('dest-dropdown').classList.remove('visible');
            }
        });
    },

    /* ---- Map ---- */
    initMap() {
        this.mapInstance = CampusMap.init('rider-map');
    },

    /* ---- Geolocation ---- */
    getLocation() {
        if (!navigator.geolocation) {
            this.setLocation(CAMPUS_CENTER[0], CAMPUS_CENTER[1]);
            document.getElementById('location-text').textContent = 'IIT Roorkee Campus';
            return;
        }

        navigator.geolocation.getCurrentPosition(
            (pos) => {
                this.setLocation(pos.coords.latitude, pos.coords.longitude);
                this.findNearestLocation(pos.coords.latitude, pos.coords.longitude);
            },
            (err) => {
                console.warn('Geolocation error:', err);
                this.setLocation(CAMPUS_CENTER[0], CAMPUS_CENTER[1]);
                document.getElementById('location-text').textContent = 'IIT Roorkee Campus';
                App.showToast('Using default campus location', 'info');
            },
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
        );
    },

    setLocation(lat, lng) {
        this.currentLat = lat;
        this.currentLng = lng;

        if (this.mapInstance) {
            CampusMap.addMarker('rider', lat, lng, {
                color: 'blue',
                popup: 'Your Location',
            });
            CampusMap.map.setView([lat, lng], 16);
        }
    },

    findNearestLocation(lat, lng) {
        let nearest = null;
        let minDist = Infinity;

        CAMPUS_LOCATIONS.forEach(loc => {
            const dist = Math.sqrt(
                Math.pow(loc.lat - lat, 2) + Math.pow(loc.lng - lng, 2)
            );
            if (dist < minDist) {
                minDist = dist;
                nearest = loc;
            }
        });

        if (nearest && minDist < 0.005) {
            document.getElementById('location-text').textContent = `Near ${nearest.name}`;
        } else {
            document.getElementById('location-text').textContent = 'IIT Roorkee Campus';
        }
    },

    /* ---- Destinations ---- */
    populateDestinations() {
        const dropdown = document.getElementById('dest-dropdown');
        dropdown.innerHTML = '';

        CAMPUS_LOCATIONS.forEach((loc) => {
            const option = document.createElement('div');
            option.className = 'dest-option';
            option.innerHTML = `<span class="dest-icon">📍</span><span>${loc.name}</span>`;
            option.addEventListener('click', () => this.selectDestination(loc));
            dropdown.appendChild(option);
        });
    },

    selectDestination(loc) {
        this.selectedDest = loc;

        // Update UI
        document.getElementById('dest-search').value = '';
        document.getElementById('dest-dropdown').classList.remove('visible');
        document.getElementById('selected-dest-display').classList.remove('hidden');
        document.getElementById('selected-dest-text').textContent = loc.name;
        
        document.getElementById('request-btn').disabled = false;
        document.getElementById('schedule-btn').disabled = false;

        // Show landmark preview
        const info = LANDMARK_DETAILS[loc.name];
        if (info) {
            document.getElementById('landmark-banner-emoji').textContent = info.emoji;
            document.getElementById('landmark-title').textContent = loc.name;
            document.getElementById('landmark-desc').textContent = info.desc;
            document.getElementById('landmark-preview-card').classList.remove('hidden');
        }

        // Show destination marker on map
        CampusMap.addMarker('destination', loc.lat, loc.lng, {
            icon: CampusMap.createDestIcon(),
            popup: loc.name,
        });

        // Draw optimized Dijkstra road route
        if (this.currentLat && this.currentLng) {
            CampusMap.drawRoute(this.currentLat, this.currentLng, loc.lat, loc.lng);
            CampusMap.fitBounds([
                [this.currentLat, this.currentLng],
                [loc.lat, loc.lng],
            ]);
        }
    },

    /* ---- Ride Request ---- */
    requestRide() {
        if (!this.selectedDest) {
            App.showToast('Please select a destination', 'warning');
            return;
        }

        if (!this.currentLat || !this.currentLng) {
            App.showToast('Unable to detect your location', 'error');
            return;
        }

        // Find nearest campus location name for pickup
        let pickupName = 'Current Location';
        let minDist = Infinity;
        CAMPUS_LOCATIONS.forEach(loc => {
            const dist = Math.sqrt(
                Math.pow(loc.lat - this.currentLat, 2) + Math.pow(loc.lng - this.currentLng, 2)
            );
            if (dist < minDist) {
                minDist = dist;
                pickupName = loc.name;
            }
        });

        // Send WS message
        App.sendWS('RIDE_REQUEST', {
            pickup_lat: this.currentLat,
            pickup_lng: this.currentLng,
            pickup_name: pickupName,
            dest_lat: this.selectedDest.lat,
            dest_lng: this.selectedDest.lng,
            dest_name: this.selectedDest.name,
        });

        this.setState('waiting');
        App.showToast('Searching for available e-rickshaws...', 'info');
    },

    cancelRide() {
        App.sendWS('RIDE_CANCELLED', { ride_id: this.currentRideId || '' });
        this.setState('idle');
        App.showToast('Ride request cancelled', 'info');
    },

    /* ---- Scheduling ---- */
    async scheduleRide() {
        const datetimeVal = document.getElementById('schedule-datetime').value;
        if (!datetimeVal) {
            App.showToast('Please select a date and time', 'warning');
            return;
        }

        if (!this.selectedDest) {
            App.showToast('Please select a destination first', 'warning');
            return;
        }

        const scheduledTime = new Date(datetimeVal).toISOString();

        let pickupName = 'Current Location';
        let minDist = Infinity;
        CAMPUS_LOCATIONS.forEach(loc => {
            const dist = Math.sqrt(
                Math.pow(loc.lat - this.currentLat, 2) + Math.pow(loc.lng - this.currentLng, 2)
            );
            if (dist < minDist) {
                minDist = dist;
                pickupName = loc.name;
            }
        });

        try {
            await App.api('/api/rides/schedule', {
                method: 'POST',
                body: {
                    pickup_lat: this.currentLat,
                    pickup_lng: this.currentLng,
                    pickup_name: pickupName,
                    dest_lat: this.selectedDest.lat,
                    dest_lng: this.selectedDest.lng,
                    dest_name: this.selectedDest.name,
                    scheduled_time: scheduledTime
                }
            });

            App.showToast('Ride scheduled successfully! 📅', 'success');
            toggleScheduleModal();
            this.reset();
            setTimeout(() => {
                window.location.href = 'history.html';
            }, 1000);
        } catch (err) {
            App.showToast(err.message, 'error');
        }
    },

    /* ---- State Management ---- */
    setState(newState) {
        this.state = newState;

        // Hide all states
        document.getElementById('state-idle').classList.add('hidden');
        document.getElementById('state-waiting').classList.add('hidden');
        document.getElementById('state-confirmed').classList.add('hidden');
        document.getElementById('state-completed').classList.add('hidden');

        // Show target state
        document.getElementById(`state-${newState}`).classList.remove('hidden');

        // State-specific setup
        switch (newState) {
            case 'idle':
                this.setupIdleState();
                break;
            case 'waiting':
                this.setupWaitingState();
                break;
            case 'confirmed':
                this.setupConfirmedState();
                break;
            case 'completed':
                break;
        }
    },

    setupIdleState() {
        setTimeout(() => {
            if (CampusMap.map) {
                CampusMap.map.invalidateSize();
                if (this.currentLat && this.currentLng) {
                    CampusMap.map.setView([this.currentLat, this.currentLng], 16);
                }
            }
        }, 100);
    },

    setupWaitingState() {
        setTimeout(() => {
            const waitingMapEl = document.getElementById('waiting-map');
            if (waitingMapEl && !waitingMapEl._leaflet_id) {
                const wMap = L.map('waiting-map', {
                    center: [this.currentLat || CAMPUS_CENTER[0], this.currentLng || CAMPUS_CENTER[1]],
                    zoom: 16,
                    zoomControl: false,
                    attributionControl: false,
                });
                
                L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(wMap);

                // Standard / Satellite toggle control
                const tilesStandard = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 });
                const tilesSatellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19 });
                
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
                        if (wMap.hasLayer(tilesStandard)) {
                            wMap.removeLayer(tilesStandard);
                            tilesSatellite.addTo(wMap);
                            div.innerHTML = '🛰️ Satellite';
                        } else {
                            wMap.removeLayer(tilesSatellite);
                            tilesStandard.addTo(wMap);
                            div.innerHTML = '🗺️ Map View';
                        }
                    };
                    return div;
                };
                toggleBtn.addTo(wMap);

                if (this.currentLat && this.currentLng) {
                    L.marker([this.currentLat, this.currentLng], {
                        icon: CampusMap.createIcon('blue', '', 14),
                    }).addTo(wMap).bindPopup('Your Location');
                }
                if (this.selectedDest) {
                    L.marker([this.selectedDest.lat, this.selectedDest.lng], {
                        icon: CampusMap.createDestIcon(),
                    }).addTo(wMap).bindPopup(this.selectedDest.name);

                    if (this.currentLat && this.currentLng) {
                        const points = [[this.currentLat, this.currentLng], [this.selectedDest.lat, this.selectedDest.lng]];
                        wMap.fitBounds(points, { padding: [50, 50] });
                    }
                }
            }
        }, 200);
    },

    setupConfirmedState() {
        setTimeout(() => {
            const confMapEl = document.getElementById('confirmed-map');
            if (confMapEl && !confMapEl._leaflet_id) {
                this._confirmedMap = L.map('confirmed-map', {
                    center: [this.currentLat || CAMPUS_CENTER[0], this.currentLng || CAMPUS_CENTER[1]],
                    zoom: 15,
                    zoomControl: false,
                    attributionControl: false,
                });
                
                L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(this._confirmedMap);
                
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
                        if (self._confirmedMap.hasLayer(tilesStandard)) {
                            self._confirmedMap.removeLayer(tilesStandard);
                            tilesSatellite.addTo(self._confirmedMap);
                            div.innerHTML = '🛰️ Satellite';
                        } else {
                            self._confirmedMap.removeLayer(tilesSatellite);
                            tilesStandard.addTo(self._confirmedMap);
                            div.innerHTML = '🗺️ Map View';
                        }
                    };
                    return div;
                };
                toggleBtn.addTo(this._confirmedMap);
            }
            this.updateConfirmedMap();
        }, 200);
    },

    _confirmedMap: null,
    _confirmedMarkers: {},
    _confirmedRoute: null,

    updateConfirmedMap() {
        if (!this._confirmedMap) return;

        // Clear existing markers
        Object.values(this._confirmedMarkers).forEach(m => this._confirmedMap.removeLayer(m));
        this._confirmedMarkers = {};
        if (this._confirmedRoute) {
            this._confirmedMap.removeLayer(this._confirmedRoute);
        }

        // Rider marker (blue)
        if (this.currentLat && this.currentLng) {
            this._confirmedMarkers.rider = L.marker([this.currentLat, this.currentLng], {
                icon: CampusMap.createIcon('blue', '', 14),
            }).addTo(this._confirmedMap).bindPopup('You');
        }

        // Driver marker (green rickshaw)
        if (this.driverLat && this.driverLng) {
            if (this._confirmedMarkers.driver) {
                const marker = this._confirmedMarkers.driver;
                const startLatLng = marker.getLatLng();
                const endLatLng = L.latLng(this.driverLat, this.driverLng);
                const startTime = performance.now();
                const duration = 1000;
                const animate = (currentTime) => {
                    const elapsed = currentTime - startTime;
                    const t = Math.min(elapsed / duration, 1);
                    const ease = 1 - Math.pow(1 - t, 3);
                    marker.setLatLng([
                        startLatLng.lat + (endLatLng.lat - startLatLng.lat) * ease,
                        startLatLng.lng + (endLatLng.lng - startLatLng.lng) * ease,
                    ]);
                    if (t < 1) requestAnimationFrame(animate);
                };
                requestAnimationFrame(animate);
            } else {
                this._confirmedMarkers.driver = L.marker([this.driverLat, this.driverLng], {
                    icon: CampusMap.createRickshawIcon(),
                }).addTo(this._confirmedMap).bindPopup('Your Driver');
            }
        }

        // Destination marker (red)
        if (this.selectedDest) {
            this._confirmedMarkers.dest = L.marker([this.selectedDest.lat, this.selectedDest.lng], {
                icon: CampusMap.createDestIcon(),
            }).addTo(this._confirmedMap).bindPopup(this.selectedDest.name);
        }

        // Route line: Dijkstra optimized path
        if (this.driverLat && this.driverLng && this.currentLat && this.currentLng && this.selectedDest) {
            const points = CampusMap.getRoutePoints(this.driverLat, this.driverLng, this.currentLat, this.currentLng);
            
            // Add destination to route
            const destPoints = CampusMap.getRoutePoints(this.currentLat, this.currentLng, this.selectedDest.lat, this.selectedDest.lng);
            const totalRoute = points.concat(destPoints.slice(1));

            this._confirmedRoute = L.polyline(totalRoute, {
                color: '#00ff88',
                weight: 4,
                opacity: 0.8,
                dashArray: '8, 8',
                lineJoin: 'round',
            }).addTo(this._confirmedMap);

            this._confirmedMap.fitBounds(totalRoute, { padding: [50, 50], maxZoom: 17 });
        }
    },

    /* ---- WebSocket Messages ---- */
    onWSMessage(type, data) {
        switch (type) {
            case 'DRIVER_LOCATIONS':
                this.onDriverLocations(data);
                break;
            case 'RIDE_ACCEPTED':
                this.onRideAccepted(data);
                break;
            case 'RIDE_STARTED':
                this.onRideStarted(data);
                break;
            case 'LOCATION_UPDATE':
                this.onLocationUpdate(data);
                break;
            case 'RIDE_COMPLETED':
                this.onRideCompleted(data);
                break;
            case 'RIDE_CANCELLED':
                this.onRideCancelled(data);
                break;
        }
    },

    onDriverLocations(data) {
        const drivers = data.drivers || [];
        const countEl = document.getElementById('drivers-count');
        const dotEl = document.getElementById('drivers-dot');

        if (countEl) {
            countEl.textContent = `${drivers.length} E-Rickshaw${drivers.length !== 1 ? 's' : ''} available nearby`;
            if (dotEl) {
                dotEl.style.background = drivers.length > 0 ? 'var(--accent)' : 'var(--danger)';
                dotEl.style.boxShadow = drivers.length > 0 ? '0 0 8px var(--accent)' : '0 0 8px var(--danger)';
            }
        }

        const onlineIds = drivers.map(d => `driver_${d.driver_id}`);
        Object.keys(this._onlineDriverMarkers || {}).forEach(id => {
            if (!onlineIds.includes(id)) {
                if (CampusMap.map) CampusMap.map.removeLayer(this._onlineDriverMarkers[id]);
                delete this._onlineDriverMarkers[id];
            }
        });

        if (!this._onlineDriverMarkers) this._onlineDriverMarkers = {};

        drivers.forEach(driver => {
            // Hide on main map if active confirmed driver
            if (this.state === 'confirmed' && this.currentRideId && this.driverPhone) {
                return;
            }

            const markerId = `driver_${driver.driver_id}`;
            if (this._onlineDriverMarkers[markerId]) {
                const marker = this._onlineDriverMarkers[markerId];
                const startLatLng = marker.getLatLng();
                const endLatLng = L.latLng(driver.lat, driver.lng);
                const startTime = performance.now();
                const duration = 1000;
                const animate = (currentTime) => {
                    const elapsed = currentTime - startTime;
                    const t = Math.min(elapsed / duration, 1);
                    const ease = 1 - Math.pow(1 - t, 3);
                    marker.setLatLng([
                        startLatLng.lat + (endLatLng.lat - startLatLng.lat) * ease,
                        startLatLng.lng + (endLatLng.lng - startLatLng.lng) * ease,
                    ]);
                    if (t < 1) requestAnimationFrame(animate);
                };
                requestAnimationFrame(animate);
            } else if (CampusMap.map) {
                const marker = L.marker([driver.lat, driver.lng], {
                    icon: CampusMap.createRickshawIcon(),
                }).addTo(CampusMap.map).bindPopup(`Online E-Rickshaw`);
                this._onlineDriverMarkers[markerId] = marker;
            }
        });
    },

    onRideAccepted(data) {
        this.currentRideId = data.ride_id;
        this.driverLat = data.driver_lat;
        this.driverLng = data.driver_lng;
        this.driverName = data.driver_name;
        this.driverPhone = data.driver_phone;
        this.driverUpi = data.upi_id || (data.driver_phone ? `${data.driver_phone}@upi` : 'driver@upi');
        this.driverQrBase64 = data.qr_base64 || '';

        // Clear other driver markers
        Object.values(this._onlineDriverMarkers || {}).forEach(m => {
            if (CampusMap.map) CampusMap.map.removeLayer(m);
        });
        this._onlineDriverMarkers = {};

        // Update driver info UI
        document.getElementById('driver-name').textContent = data.driver_name || 'Your Driver';
        
        const vehicleBadge = document.getElementById('vehicle-badge');
        if (data.vehicle_number) {
            vehicleBadge.textContent = '🛺 ' + data.vehicle_number;
            vehicleBadge.classList.remove('hidden');
        } else {
            vehicleBadge.classList.add('hidden');
        }

        const phoneEl = document.getElementById('driver-phone');
        const phone = data.driver_phone || '';
        try {
            phoneEl.textContent = App.formatPhone(phone);
        } catch (e) {
            phoneEl.textContent = phone;
        }
        phoneEl.href = `tel:${phone}`;

        // Reset badge/label defaults
        const badge = document.getElementById('ride-status-badge');
        if (badge) {
            badge.textContent = 'En Route';
            badge.style.background = 'var(--accent)';
        }
        const label = document.getElementById('eta-label');
        if (label) label.textContent = 'Minutes Away';
        const cancelBtn = document.getElementById('confirmed-cancel-btn');
        if (cancelBtn) cancelBtn.style.display = 'block';

        // Update ETA
        if (data.eta_minutes !== undefined) {
            document.getElementById('eta-number').textContent = data.eta_minutes;
        }

        App.playSound('accepted');
        App.showToast('Driver found! 🎉', 'success');
        this.setState('confirmed');
    },

    onRideStarted(data) {
        this.setState('confirmed');
        
        App.playSound('started');
        const badge = document.getElementById('ride-status-badge');
        if (badge) {
            badge.textContent = 'In Progress';
            badge.style.background = 'linear-gradient(135deg, #6c5ce7 0%, #a29bfe 100%)';
        }
        const label = document.getElementById('eta-label');
        if (label) label.textContent = 'Minutes to Destination';
        const sublabel = document.getElementById('eta-sublabel');
        if (sublabel) sublabel.textContent = 'Heading to your destination';
        
        // Hide cancel button
        const cancelBtn = document.getElementById('confirmed-cancel-btn');
        if (cancelBtn) cancelBtn.style.display = 'none';

        App.playSound('accepted');
        App.showToast('Your ride is now in progress! 🛺', 'info');
        this.updateConfirmedMap();
    },

    onLocationUpdate(data) {
        if (this.state !== 'confirmed') return;

        this.driverLat = data.lat;
        this.driverLng = data.lng;

        // Update ETA
        if (data.eta_minutes !== undefined) {
            document.getElementById('eta-number').textContent = data.eta_minutes;
            const badge = document.getElementById('ride-status-badge');
            
            if (badge && badge.textContent === 'In Progress') {
                document.getElementById('eta-sublabel').textContent = data.eta_minutes <= 1 ? 'Almost at destination!' : 'Heading to destination';
            } else {
                document.getElementById('eta-sublabel').textContent = data.eta_minutes <= 1 ? 'Almost there!' : 'Your driver is on the way';
            }
        }

        // Update driver marker
        if (this._confirmedMap && this._confirmedMarkers.driver) {
            const marker = this._confirmedMarkers.driver;
            const startLatLng = marker.getLatLng();
            const endLatLng = L.latLng(data.lat, data.lng);
            const startTime = performance.now();
            const duration = 1000;
            const animate = (currentTime) => {
                const elapsed = currentTime - startTime;
                const t = Math.min(elapsed / duration, 1);
                const ease = 1 - Math.pow(1 - t, 3);
                marker.setLatLng([
                    startLatLng.lat + (endLatLng.lat - startLatLng.lat) * ease,
                    startLatLng.lng + (endLatLng.lng - startLatLng.lng) * ease,
                ]);
                if (t < 1) requestAnimationFrame(animate);
            };
            requestAnimationFrame(animate);
        } else {
            this.updateConfirmedMap();
        }
    },

    onRideCompleted(data) {
        App.playSound('completed');
        
        // Mock summary distance/time based on start/end positions
        const distance = (Math.random() * 1.5 + 0.6).toFixed(1);
        const mins = Math.floor(Math.random() * 4 + 3);
        
        document.getElementById('summary-distance').textContent = `${distance} km`;
        document.getElementById('summary-time').textContent = `${mins} min`;
        
        // Inject driver details into cashless payments modal
        const upiAddress = this.driverUpi || 'paytmqr@paytm';
        const upiName = encodeURIComponent(this.driverName || 'ERide Driver');
        
        const qrImg = document.getElementById('payment-qr-img');
        const qrPlaceholder = document.getElementById('payment-qr-placeholder');
        if (qrImg) {
            if (this.driverQrBase64) {
                qrImg.src = this.driverQrBase64;
            } else {
                qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent("upi://pay?pa=" + upiAddress + "&pn=" + upiName + "&cu=INR")}`;
            }
            qrImg.style.display = 'block';
        }
        if (qrPlaceholder) {
            qrPlaceholder.style.display = 'none';
        }
        
        document.getElementById('payment-driver-name').textContent = `Driver: ${this.driverName || 'E-Rickshaw Partner'}`;
        document.getElementById('payment-driver-phone').textContent = `UPI ID: ${upiAddress}`;

        // Reset rating star selection
        this.setRating(0);
        document.getElementById('rating-feedback').value = '';
        
        this.setState('completed');
        App.showToast('Ride completed! Have a great day 🎉', 'success');
    },

    onRideCancelled(data) {
        const reason = data.reason || 'Ride was cancelled';
        App.showToast(reason, 'warning');
        this.reset();
    },

    /* ---- Ratings & Feedback submission ---- */
    setRating(val) {
        this.currentRating = val;
        const stars = document.querySelectorAll('#rating-stars .star');
        stars.forEach((s, idx) => {
            if (idx < val) {
                s.classList.add('active');
            } else {
                s.classList.remove('active');
            }
        });
    },

    async submitFeedback() {
        if (!this.currentRating) {
            App.showToast('Please select a star rating first', 'warning');
            return;
        }

        const feedback = document.getElementById('rating-feedback').value.trim();
        const btn = document.getElementById('feedback-submit-btn');
        btn.disabled = true;
        btn.innerHTML = '<div class="spinner spinner-sm"></div><span>Submitting...</span>';

        try {
            await App.api(`/api/rides/${this.currentRideId}/rate`, {
                method: 'POST',
                body: {
                    rating: this.currentRating,
                    feedback: feedback
                }
            });

            App.showToast('Feedback submitted! Thank you. ❤️', 'success');
            this.reset();
        } catch (err) {
            App.showToast(err.message, 'error');
        } finally {
            btn.disabled = false;
            btn.innerHTML = 'Submit & Done';
        }
    },

    /* ---- Profile Updates ---- */
    async handleProfileUpdate(e) {
        e.preventDefault();
        const name = document.getElementById('profile-name').value.trim();
        const phone = document.getElementById('profile-phone').value.trim();
        const password = document.getElementById('profile-password').value;

        if (!name || !phone) {
            App.showToast('Name and Phone are required', 'warning');
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
                    ...(password ? { password } : {})
                }
            });

            // Update local storage
            App.user = data.user;
            localStorage.setItem('eride_user', JSON.stringify(data.user));
            
            document.getElementById('user-name').textContent = data.user.name;
            App.showToast('Profile updated! 🎉', 'success');
            toggleProfileModal();
        } catch (err) {
            App.showToast(err.message, 'error');
        } finally {
            btn.disabled = false;
            btn.innerHTML = 'Save Changes';
        }
    },

    /* ---- Reset ---- */
    reset() {
        this.state = 'idle';
        this.selectedDest = null;
        this.currentRideId = null;
        this.driverLat = null;
        this.driverLng = null;
        this.driverName = null;
        this.driverPhone = null;
        this._confirmedMap = null;
        this._confirmedMarkers = {};
        this._confirmedRoute = null;

        // Reset UI
        document.getElementById('selected-dest-display').classList.add('hidden');
        document.getElementById('landmark-preview-card').classList.add('hidden');
        document.getElementById('request-btn').disabled = true;
        document.getElementById('schedule-btn').disabled = true;
        document.getElementById('dest-search').value = '';

        // Clear markers and route on main map
        CampusMap.removeMarker('destination');
        CampusMap.clearRoute();

        // Trigger online driver update request via WS
        App.connectWS((type, data) => this.onWSMessage(type, data));

        this.setState('idle');
    },

    /* ---- Logout ---- */
    logout() {
        App.logout();
    },
};

/* ---- Destination Search Helpers (global for inline handlers) ---- */
function showDestDropdown() {
    const dropdown = document.getElementById('dest-dropdown');
    dropdown.classList.add('visible');
    filterDest();
}

function filterDest() {
    const query = document.getElementById('dest-search').value.toLowerCase().trim();
    const dropdown = document.getElementById('dest-dropdown');

    dropdown.innerHTML = '';

    const filtered = CAMPUS_LOCATIONS.filter(loc =>
        loc.name.toLowerCase().includes(query)
    );

    if (filtered.length === 0) {
        dropdown.innerHTML = '<div class="dest-option" style="color:var(--text-secondary);cursor:default;">No results found</div>';
        return;
    }

    filtered.forEach(loc => {
        const option = document.createElement('div');
        option.className = 'dest-option';
        option.innerHTML = `<span class="dest-icon">📍</span><span>${loc.name}</span>`;
        option.addEventListener('click', (e) => {
            e.stopPropagation();
            RiderApp.selectDestination(loc);
        });
        dropdown.appendChild(option);
    });
}

function clearDestination() {
    RiderApp.selectedDest = null;
    document.getElementById('selected-dest-display').classList.add('hidden');
    document.getElementById('landmark-preview-card').classList.add('hidden');
    
    document.getElementById('request-btn').disabled = true;
    document.getElementById('schedule-btn').disabled = true;
    document.getElementById('dest-search').value = '';

    CampusMap.removeMarker('destination');
    CampusMap.clearRoute();
    if (RiderApp.currentLat && RiderApp.currentLng) {
        CampusMap.map.setView([RiderApp.currentLat, RiderApp.currentLng], 16);
    }
}

/* ---- Bootstrap ---- */
document.addEventListener('DOMContentLoaded', () => {
    RiderApp.init();
});
