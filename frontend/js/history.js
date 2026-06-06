const HistoryApp = {
    async init() {
        if (!App.isLoggedIn()) {
            window.location.href = 'index.html';
            return;
        }
        await this.loadHistory();
    },

    async loadHistory() {
        try {
            const data = await App.api('/api/rides/history');
            const rides = data.rides || data || [];
            
            document.getElementById('history-loading').classList.add('hidden');
            
            if (!rides.length) {
                document.getElementById('history-empty').classList.remove('hidden');
                return;
            }

            const list = document.getElementById('history-list');
            rides.forEach(ride => {
                const card = document.createElement('div');
                card.className = 'glass-card history-card';
                
                // Set status representation
                let statusClass = 'warning';
                let statusIcon = '⏳';
                if (ride.status === 'completed') {
                    statusClass = 'success';
                    statusIcon = '✅';
                } else if (ride.status === 'cancelled') {
                    statusClass = 'danger';
                    statusIcon = '❌';
                } else if (ride.status === 'in_progress') {
                    statusClass = 'online';
                    statusIcon = '🛺';
                } else if (ride.status === 'scheduled') {
                    statusClass = 'warning';
                    statusIcon = '📅';
                }
                
                const date = new Date(ride.created_at).toLocaleDateString('en-IN', {
                    day: 'numeric', month: 'short', year: 'numeric',
                    hour: '2-digit', minute: '2-digit'
                });

                // Generate rating and comment HTML block if present
                let ratingHtml = '';
                if (ride.rating) {
                    const stars = '⭐'.repeat(ride.rating);
                    const comment = ride.feedback ? `<p class="history-comment">"${ride.feedback}"</p>` : '';
                    ratingHtml = `
                        <div class="history-feedback-block mt-2 pt-2" style="border-top:1px dashed var(--glass-border);">
                            <span class="history-stars">${stars}</span>
                            ${comment}
                        </div>
                    `;
                }

                // Generate scheduling details if present
                let scheduleHtml = '';
                if (ride.scheduled_time) {
                    const schTime = new Date(ride.scheduled_time).toLocaleString('en-IN', {
                        day: 'numeric', month: 'short',
                        hour: '2-digit', minute: '2-digit'
                    });
                    const driverStatus = ride.driver_id ? 'Driver assigned' : 'Awaiting driver';
                    scheduleHtml = `
                        <div class="history-schedule-block mt-1 mb-2" style="font-size: 0.8rem; color: var(--accent);">
                            <span>📅 Scheduled for: <strong>${schTime}</strong> (${driverStatus})</span>
                        </div>
                    `;
                }

                card.innerHTML = `
                    <div class="history-header">
                        <span class="history-date">${date}</span>
                        <span class="status-badge ${statusClass}">${statusIcon} ${ride.status}</span>
                    </div>
                    ${scheduleHtml}
                    <div class="history-route">
                        <div class="route-point">
                            <div class="route-dot pickup"></div>
                            <span>${ride.pickup_name || 'Pickup'}</span>
                        </div>
                        <div class="route-line-v"></div>
                        <div class="route-point">
                            <div class="route-dot dest"></div>
                            <span>${ride.dest_name || 'Destination'}</span>
                        </div>
                    </div>
                    ${ratingHtml}
                `;
                list.appendChild(card);
            });
        } catch (err) {
            document.getElementById('history-loading').classList.add('hidden');
            App.showToast('Failed to load history: ' + err.message, 'error');
        }
    }
};

document.addEventListener('DOMContentLoaded', () => HistoryApp.init());
