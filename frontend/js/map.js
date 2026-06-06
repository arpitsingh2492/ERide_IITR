/* ===== ERide — Campus Map Module (Leaflet) ===== */

const CAMPUS_LOCATIONS = [
    { name: 'Main Gate (Thomason Gate)', lat: 29.8644, lng: 77.8920 },
    { name: 'Roorkee Railway Station', lat: 29.8543, lng: 77.8880 },
    { name: 'MGCL Library', lat: 29.8660, lng: 77.8963 },
    { name: 'Rajendra Bhawan', lat: 29.8672, lng: 77.8968 },
    { name: 'Cautley Bhawan', lat: 29.8680, lng: 77.8942 },
    { name: 'Govind Bhawan', lat: 29.8683, lng: 77.8990 },
    { name: 'Kasturba Bhawan', lat: 29.8635, lng: 77.8915 },
    { name: 'Sarojini Bhawan', lat: 29.8625, lng: 77.8910 },
    { name: 'Azad Bhawan', lat: 29.8670, lng: 77.8945 },
    { name: 'Jawahar Bhawan', lat: 29.8657, lng: 77.8978 },
    { name: 'Ravindra Bhawan', lat: 29.8665, lng: 77.8935 },
    { name: 'Ganga Bhawan', lat: 29.8690, lng: 77.8955 },
    { name: 'Department of CSE', lat: 29.8648, lng: 77.8960 },
    { name: 'Department of ECE', lat: 29.8652, lng: 77.8955 },
    { name: 'Convocation Hall', lat: 29.8640, lng: 77.8930 },
    { name: 'SAC (Student Activity Center)', lat: 29.8660, lng: 77.8950 },
    { name: 'Nesci / CCD', lat: 29.8645, lng: 77.8945 },
    { name: 'Olive Garden', lat: 29.8638, lng: 77.8935 },
    { name: 'SBI Bank', lat: 29.8642, lng: 77.8928 },
    { name: 'Hospital (Health Centre)', lat: 29.8655, lng: 77.8925 },
];

const CAMPUS_CENTER = [29.8655, 77.8950];

// ===== IIT Roorkee Campus Road Graph Representation =====
const CAMPUS_NEIGHBORS = {
    'Main Gate (Thomason Gate)': ['Roorkee Railway Station', 'Convocation Hall', 'SBI Bank', 'Kasturba Bhawan', 'Sarojini Bhawan'],
    'Roorkee Railway Station': ['Main Gate (Thomason Gate)'],
    'SBI Bank': ['Hospital (Health Centre)', 'Main Gate (Thomason Gate)'],
    'Hospital (Health Centre)': ['SBI Bank', 'Nesci / CCD', 'Ravindra Bhawan'],
    'Nesci / CCD': ['Hospital (Health Centre)', 'Convocation Hall', 'SAC (Student Activity Center)', 'Olive Garden'],
    'Convocation Hall': ['Main Gate (Thomason Gate)', 'Nesci / CCD', 'Olive Garden'],
    'Olive Garden': ['Convocation Hall', 'Nesci / CCD', 'Kasturba Bhawan'],
    'Kasturba Bhawan': ['Olive Garden', 'Sarojini Bhawan', 'Main Gate (Thomason Gate)'],
    'Sarojini Bhawan': ['Kasturba Bhawan', 'Main Gate (Thomason Gate)'],
    'Ravindra Bhawan': ['Hospital (Health Centre)', 'Cautley Bhawan', 'Azad Bhawan'],
    'Azad Bhawan': ['Ravindra Bhawan', 'Cautley Bhawan', 'SAC (Student Activity Center)'],
    'Cautley Bhawan': ['Ravindra Bhawan', 'Azad Bhawan', 'Ganga Bhawan'],
    'Ganga Bhawan': ['Cautley Bhawan', 'SAC (Student Activity Center)', 'Department of ECE'],
    'SAC (Student Activity Center)': ['Nesci / CCD', 'Azad Bhawan', 'Ganga Bhawan', 'Department of ECE', 'Department of CSE', 'MGCL Library'],
    'Department of ECE': ['SAC (Student Activity Center)', 'Ganga Bhawan', 'Department of CSE'],
    'Department of CSE': ['SAC (Student Activity Center)', 'Department of ECE', 'MGCL Library'],
    'MGCL Library': ['SAC (Student Activity Center)', 'Department of CSE', 'Rajendra Bhawan', 'Jawahar Bhawan'],
    'Rajendra Bhawan': ['MGCL Library', 'Jawahar Bhawan', 'Govind Bhawan'],
    'Jawahar Bhawan': ['MGCL Library', 'Rajendra Bhawan', 'Govind Bhawan'],
    'Govind Bhawan': ['Rajendra Bhawan', 'Jawahar Bhawan']
};

/**
 * Helper: Calculate Haversine distance in meters
 */
function getHaversineDistance(lat1, lng1, lat2, lng2) {
    const R = 6371000; // Earth's radius in meters
    const phi1 = lat1 * Math.PI / 180;
    const phi2 = lat2 * Math.PI / 180;
    const deltaPhi = (lat2 - lat1) * Math.PI / 180;
    const deltaLambda = (lng2 - lng1) * Math.PI / 180;

    const a = Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
              Math.cos(phi1) * Math.cos(phi2) *
              Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

/**
 * Helper: Dijkstra's Shortest Path Algorithm
 */
function solveDijkstra(startName, endName) {
    const distances = {};
    const prev = {};
    const queue = new Set();

    CAMPUS_LOCATIONS.forEach(loc => {
        distances[loc.name] = Infinity;
        prev[loc.name] = null;
        queue.add(loc.name);
    });

    distances[startName] = 0;

    while (queue.size > 0) {
        let u = null;
        queue.forEach(node => {
            if (u === null || distances[node] < distances[u]) {
                u = node;
            }
        });

        if (u === endName || distances[u] === Infinity) {
            break;
        }

        queue.delete(u);

        const neighbors = CAMPUS_NEIGHBORS[u] || [];
        neighbors.forEach(v => {
            if (!queue.has(v)) return;

            const locA = CAMPUS_LOCATIONS.find(l => l.name === u);
            const locB = CAMPUS_LOCATIONS.find(l => l.name === v);
            const weight = getHaversineDistance(locA.lat, locA.lng, locB.lat, locB.lng);

            const alt = distances[u] + weight;
            if (alt < distances[v]) {
                distances[v] = alt;
                prev[v] = u;
            }
        });
    }

    const path = [];
    let curr = endName;
    while (curr !== null) {
        path.unshift(curr);
        curr = prev[curr];
    }
    return path;
}

/**
 * Helper: Find nearest landmark to coordinates
 */
function getNearestLandmark(lat, lng) {
    let closest = null;
    let minDist = Infinity;
    CAMPUS_LOCATIONS.forEach(loc => {
        const dist = getHaversineDistance(lat, lng, loc.lat, loc.lng);
        if (dist < minDist) {
            minDist = dist;
            closest = loc;
        }
    });
    return closest ? closest.name : null;
}


const CampusMap = {
    map: null,
    markers: {},
    routeLine: null,
    tilesStandard: null,
    tilesSatellite: null,

    /**
     * Initialize Leaflet map with Satellite view controls
     */
    init(containerId, options = {}) {
        const center = options.center || CAMPUS_CENTER;
        const zoom = options.zoom || 16;

        const map = L.map(containerId, {
            center: center,
            zoom: zoom,
            zoomControl: false,
            attributionControl: false,
        });

        // Add zoom control top-right
        L.control.zoom({ position: 'topright' }).addTo(map);

        // Tile definitions
        this.tilesStandard = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '© OpenStreetMap',
        });

        this.tilesSatellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
            maxZoom: 19,
            attribution: 'Tiles &copy; Esri &mdash; GIS Community',
        });

        // Add default Standard Map
        this.tilesStandard.addTo(map);

        // Dynamic glass-toggle button for satellite view
        const self = this;
        const toggleBtn = L.control({ position: 'topleft' });
        toggleBtn.onAdd = function() {
            const div = L.DomUtil.create('div', 'map-toggle-control');
            div.innerHTML = '🗺️ Map View';
            div.style.padding = '8px 12px';
            div.style.cursor = 'pointer';
            div.style.fontWeight = '600';
            div.style.fontSize = '0.75rem';
            div.style.borderRadius = '8px';
            div.style.border = '1px solid rgba(255, 255, 255, 0.12)';
            div.style.background = 'rgba(18, 18, 42, 0.85)';
            div.style.backdropFilter = 'blur(10px)';
            div.style.color = '#ffffff';
            div.style.transition = 'all 0.2s ease';
            div.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)';

            div.onclick = function(e) {
                e.stopPropagation();
                if (map.hasLayer(self.tilesStandard)) {
                    map.removeLayer(self.tilesStandard);
                    self.tilesSatellite.addTo(map);
                    div.innerHTML = '🛰️ Satellite';
                    div.style.border = '1px solid #00ff88';
                    div.style.color = '#00ff88';
                } else {
                    map.removeLayer(self.tilesSatellite);
                    self.tilesStandard.addTo(map);
                    div.innerHTML = '🗺️ Map View';
                    div.style.border = '1px solid rgba(255, 255, 255, 0.12)';
                    div.style.color = '#ffffff';
                }
            };
            return div;
        };
        toggleBtn.addTo(map);

        // Attribution
        L.control.attribution({ position: 'bottomright', prefix: false })
            .addAttribution('ERide')
            .addTo(map);

        this.map = map;
        return map;
    },

    /**
     * Add a marker to the map
     */
    addMarker(id, lat, lng, options = {}) {
        if (this.markers[id]) {
            this.map.removeLayer(this.markers[id]);
        }

        const icon = options.icon || this.createIcon(options.color || 'blue', options.label || '', options.size || 14);

        const marker = L.marker([lat, lng], {
            icon: icon,
            draggable: options.draggable || false,
        }).addTo(this.map);

        if (options.popup) {
            marker.bindPopup(options.popup);
        }

        this.markers[id] = marker;
        return marker;
    },

    /**
     * Smoothly animate marker to new position
     */
    updateMarker(id, lat, lng) {
        const marker = this.markers[id];
        if (!marker) return;

        const startLatLng = marker.getLatLng();
        const endLatLng = L.latLng(lat, lng);
        const duration = 1000;
        const startTime = performance.now();

        const animate = (currentTime) => {
            const elapsed = currentTime - startTime;
            const t = Math.min(elapsed / duration, 1);
            const ease = 1 - Math.pow(1 - t, 3); // ease-out cubic

            const currentLat = startLatLng.lat + (endLatLng.lat - startLatLng.lat) * ease;
            const currentLng = startLatLng.lng + (endLatLng.lng - startLatLng.lng) * ease;

            marker.setLatLng([currentLat, currentLng]);

            if (t < 1) {
                requestAnimationFrame(animate);
            }
        };

        requestAnimationFrame(animate);
    },

    /**
     * Remove a marker by id
     */
    removeMarker(id) {
        if (this.markers[id]) {
            this.map.removeLayer(this.markers[id]);
            delete this.markers[id];
        }
    },

    /**
     * Clear all markers
     */
    clearMarkers() {
        for (const id in this.markers) {
            this.map.removeLayer(this.markers[id]);
        }
        this.markers = {};
    },

    /**
     * Dijkstra-Optimized Routing calculation
     */
    getRoutePoints(fromLat, fromLng, toLat, toLng) {
        const startNode = getNearestLandmark(fromLat, fromLng);
        const endNode = getNearestLandmark(toLat, toLng);

        if (!startNode || !endNode || startNode === endNode) {
            return [[fromLat, fromLng], [toLat, toLng]];
        }

        const pathNames = solveDijkstra(startNode, endNode);
        const coords = pathNames.map(name => {
            const loc = CAMPUS_LOCATIONS.find(l => l.name === name);
            return [loc.lat, loc.lng];
        });

        // Snaps endpoints to actual coordinates
        coords.unshift([fromLat, fromLng]);
        coords.push([toLat, toLng]);
        return coords;
    },

    /**
     * Draw optimized road route between two coordinates
     */
    drawRoute(fromLat, fromLng, toLat, toLng) {
        this.clearRoute();

        // Compute Dijkstra Optimized path points
        const points = this.getRoutePoints(fromLat, fromLng, toLat, toLng);

        this.routeLine = L.polyline(points, {
            color: '#00ff88',
            weight: 4,
            opacity: 0.8,
            dashArray: '8, 8',
            lineCap: 'round',
            lineJoin: 'round',
        }).addTo(this.map);

        return this.routeLine;
    },

    /**
     * Draw multi-route polyline
     */
    drawMultiRoute(points) {
        this.clearRoute();

        this.routeLine = L.polyline(points, {
            color: '#00ff88',
            weight: 4,
            opacity: 0.8,
            dashArray: '8, 8',
            lineCap: 'round',
            lineJoin: 'round',
        }).addTo(this.map);

        return this.routeLine;
    },

    /**
     * Clear route line
     */
    clearRoute() {
        if (this.routeLine) {
            this.map.removeLayer(this.routeLine);
            this.routeLine = null;
        }
    },

    /**
     * Fit map to show all given points with padding
     */
    fitBounds(points) {
        if (!points || points.length === 0) return;
        const bounds = L.latLngBounds(points.map(p => [p[0] || p.lat, p[1] || p.lng]));
        this.map.fitBounds(bounds, { padding: [50, 50], maxZoom: 17 });
    },

    /**
     * Create a circular colored div icon
     */
    createIcon(color, label = '', size = 14) {
        const sizeStr = `${size * 2}px`;
        return L.divIcon({
            className: '',
            html: `<div class="custom-marker ${color}" style="width:${sizeStr};height:${sizeStr};">${label}</div>`,
            iconSize: [size * 2, size * 2],
            iconAnchor: [size, size],
            popupAnchor: [0, -size],
        });
    },

    /**
     * Create e-rickshaw icon (🛺 on green circle)
     */
    createRickshawIcon() {
        return L.divIcon({
            className: '',
            html: `<div class="custom-marker rickshaw" style="width:36px;height:36px;box-shadow: 0 0 10px #00ff88;">🛺</div>`,
            iconSize: [36, 36],
            iconAnchor: [18, 18],
            popupAnchor: [0, -18],
        });
    },

    /**
     * Create a pickup icon
     */
    createPickupIcon() {
        return L.divIcon({
            className: '',
            html: `<div class="custom-marker blue" style="width:30px;height:30px;font-size:1.1rem;box-shadow:0 0 10px #00b4d8;">📍</div>`,
            iconSize: [30, 30],
            iconAnchor: [15, 15],
            popupAnchor: [0, -15],
        });
    },

    /**
     * Create a destination icon
     */
    createDestIcon() {
        return L.divIcon({
            className: '',
            html: `<div class="custom-marker red" style="width:30px;height:30px;font-size:1.1rem;box-shadow:0 0 10px #ff4757;">🏁</div>`,
            iconSize: [30, 30],
            iconAnchor: [15, 15],
            popupAnchor: [0, -15],
        });
    },
};
