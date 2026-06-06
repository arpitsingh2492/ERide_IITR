# ERide — Real-Time IIT Roorkee Campus Mobility & Ride Management Platform

ERide is a full-stack, real-time e-rickshaw ride-hailing and dispatch system tailored for the **IIT Roorkee** campus environment. Built for passengers (riders) and e-rickshaw operators (drivers), the platform coordinates ride requests, availabilities, route planning, scheduling, cashless payments, and performance analytics.

---

## 🚀 Key Features

### 1. User Authentication & Profile Management
- Secure user registration and JWT-based authentication.
- Dedicated account roles: **Rider** and **Driver**.
- Driver registration requires verification information (**Driving License Number**) and **Vehicle Number**.
- **Profile Edit Panel** allows passengers and drivers to update credentials and configurations dynamically.

### 2. Live Map & Real-Time Driver Availability
- Visualizes online drivers in real-time as green `🛺` markers on the rider map using WebSocket coordinate broadcasts.
- Active driver count badge displayed on the Rider dashboard before booking.
- Toggles between **Standard Map View** and **Satellite View** (using Esri World Imagery tiles).

### 3. Dijkstra's Algorithm Route Optimization
- Campus roads mapped as a coordinate network graph.
- Calculates and draws the optimized shortest road route between pickup and destination landmarks using **Dijkstra's Algorithm** instead of drawing straight geometric lines.

### 4. Complete Ride Lifecycle Sync
- Synchronized ride states: `Requested` ➔ `Accepted` ➔ `In Progress` ➔ `Completed` ➔ `Cancelled`.
- Stateful **First-Accept-Wins** matchmaking logic managed on WebSockets.
- Drivers go through two-stage ride completion: **Start Ride** (passenger picked up) and **Complete Ride** (reached destination).
- Sound effects and vibration alerts trigger on ride matching events.

### 5. Ride Scheduling (Future Bookings)
- Riders can schedule rides for future lecture classes, club rehearsals, or train timings.
- Drivers browse open scheduled bookings under a dedicated **Scheduled tab** and claim jobs.

### 6. Cashless Payments & Star Ratings
- Simulated **UPI QR Code payment scanner overlay** at completion with driver metadata, resolving cashless transaction needs without violating pricing/fare constraints.
- **Custom QR Code Upload**: Drivers can upload their custom UPI QR scanner image (converted to base64 and stored in SQLite). The rider's payment dialog dynamically renders this custom QR code instead of the default placeholder.
- Star ratings (1-5 stars) and optional written comments submitted by riders and saved to database history logs.

### 7. Driver Performance Analytics & Real-Time Sync
- **Summary Cards**: Displays total rides completed, average star rating, and active bookings.
- **Real-Time Ratings Sync**: The driver's completed screen updates in real-time to say **"Ride Done & Rated! Thanks!"** with the stars and text review as soon as the rider submits feedback, without requiring any page refreshes.
- **Charts**: Visualizes peak campus demand hours and completed rides trends using Chart.js.
- **ML Hotspot Demand Forecast**: Lists predicted high-probability ride zones on campus by combining historical logs with rules based on student schedules.

### 8. Progressive Web App (PWA)
- Installable as a native app on mobile home screens.
- Caches assets locally using service workers for instant, offline-capable loading.

---

## 🛠️ Technology Stack

- **Backend**: Python 3.10+, FastAPI (Asynchronous framework), Uvicorn (ASGI web server).
- **Database**: SQLite (SQL engine) managed asynchronously via `aiosqlite`.
- **Authentication**: JWT (JSON Web Tokens via PyJWT), Bcrypt (Password hashing).
- **Real-Time Communication**: WebSockets (State synchronization & broadcasts).
- **Frontend**: HTML5, Vanilla JavaScript (ES6), CSS3 (Glassmorphism & animations).
- **Mapping**: Leaflet.js, OpenStreetMap tiles, Esri World Imagery (Satellite).
- **Analytics Visualization**: Chart.js.

---

## 📂 Project Structure

```
d:/ERide/
├── backend/
│   ├── auth.py              # JWT authentication & profile REST routes
│   ├── database.py          # SQLite schema, CRUD operations & aggregations
│   ├── eta.py               # Haversine distance & travel time calculator
│   ├── main.py              # FastAPI app & WebSocket handlers
│   ├── models.py            # Pydantic schemas & WebSocket constants
│   ├── requirements.txt     # Python backend dependencies
│   └── routes_ride.py       # REST endpoints for history, ratings & forecasting
├── frontend/
│   ├── css/
│   │   └── styles.css       # Premium dark glassmorphic styling
│   ├── js/
│   │   ├── app.js           # Auth, API requests & PWA manager
│   │   ├── driver.js        # Driver dashboard, scheduled claims & analytics
│   │   ├── map.js           # Leaflet setup & Dijkstra road routing graph
│   │   ├── history.js       # User ride log rendering
│   │   └── rider.js         # Rider requests, UPI scan & rating forms
│   ├── driver.html          # Driver panel HTML layout
│   ├── history.html         # User logs page
│   ├── index.html           # Authentication portal (Splash screen, Login)
│   ├── manifest.json        # PWA details
│   ├── rider.html           # Rider panel HTML layout
│   └── sw.js                # PWA Service Worker caching
├── design_document.md       # Technical design specification
└── README.md                # General project manual
```

---

## ⚙️ Setup & Installation

### Step 1: Install Python Dependencies
1. Open PowerShell or Terminal and navigate to the project directory:
   ```bash
   cd d:\ERide
   ```
2. Install dependencies listed in `backend/requirements.txt`:
   ```bash
   pip install -r backend/requirements.txt
   ```

### Step 2: Running the Application
Launch the FastAPI development server:
```bash
python -m uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
```
- The backend database (`eride.db`) is automatically initialized on the first startup.
- The web server serves the static frontend files directly at `http://localhost:8000`.

---

## 🧪 Testing Guidelines

For local testing from a browser (especially if testing off-campus):
1. Open two browser windows (one in incognito):
   - **Rider Portal**: `http://localhost:8000/index.html` (Register/Login as Rider).
   - **Driver Portal**: `http://localhost:8000/index.html` (Register/Login as Driver).
2. On the **Driver Portal**, toggle the switch in the top-right to go **Online**.
3. Verify that on the **Rider Portal**, the driver's rickshaw `🛺` marker immediately appears on the map.
4. Select a destination (e.g. *MGCL Library*) on the Rider map, watch the optimized Dijkstra road path draw, and click **Request Now**.
5. Accept the ride card on the **Driver Portal**, and check that both screens transition to the active ride stage.
6. Click **Start Ride** on Driver, then **Complete Ride**. Check Rider summary, UPI payment receipt, and star reviews.
