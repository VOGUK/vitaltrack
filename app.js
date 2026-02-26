// Register Service Worker for PWA/Offline support
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js')
            .then(reg => console.log('Service Worker registered'))
            .catch(err => console.log('Service Worker registration failed', err));
    });
}

const API_URL = 'api.php';
let currentUser = null;
let currentReadings = []; 
let editingReadingId = null;
let historyChartInstance = null;
let pdfChartInstance = null; 
let viewingSharedProfile = null;

// XSS Protection Sanitizer
function escapeHTML(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/[&<>'"]/g, tag => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[tag]));
}

document.addEventListener('DOMContentLoaded', async () => {
    try {
        const res = await fetch(`${API_URL}?action=check_auth`);
        const text = await res.text();
        const authCheck = JSON.parse(text);
        
        if (authCheck.success) {
            currentUser = authCheck.user;
            document.getElementById('loginScreen').classList.add('hidden');
            document.getElementById('mainApp').classList.remove('hidden');
            const savedSharedCode = localStorage.getItem('vitalTrackSharedCode');
            if (savedSharedCode) { loadSharedUser(savedSharedCode); } 
            else { fetchReadings().then(() => navigate('dashboard')); }
        }
    } catch(e) {
        console.error("Auth check issue:", e);
    }
    
    const theme = localStorage.getItem('vt_theme') || 'light';
    document.documentElement.setAttribute('data-theme', theme);
    updateThemeIcon(theme);
});

// --- UI Helpers ---
function showModal(title, message) {
    document.getElementById('modalTitle').innerText = title;
    document.getElementById('modalMessage').innerText = message;
    document.getElementById('customModal').classList.remove('hidden');
}
function closeModal() { document.getElementById('customModal').classList.add('hidden'); }

let confirmAction = null;
function showConfirmModal(title, message, actionCallback) {
    document.getElementById('confirmTitle').innerText = title;
    document.getElementById('confirmMessage').innerText = message;
    confirmAction = actionCallback;
    document.getElementById('confirmModal').classList.remove('hidden');
}
function closeConfirmModal() {
    document.getElementById('confirmModal').classList.add('hidden');
    confirmAction = null;
}
function executeConfirm() {
    if(confirmAction) confirmAction();
    closeConfirmModal();
}

function togglePassword() {
    const passInput = document.getElementById('password'); const icon = document.getElementById('togglePass');
    if (passInput.type === 'password') { passInput.type = 'text'; icon.classList.replace('ph-eye', 'ph-eye-slash'); } 
    else { passInput.type = 'password'; icon.classList.replace('ph-eye-slash', 'ph-eye'); }
}
function toggleTheme() {
    const root = document.documentElement; const newTheme = root.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    root.setAttribute('data-theme', newTheme); localStorage.setItem('vt_theme', newTheme); updateThemeIcon(newTheme);
}
function updateThemeIcon(theme) { document.getElementById('themeIcon').className = theme === 'light' ? 'ph ph-moon' : 'ph ph-sun'; }
function changeTextSize(direction) {
    const root = document.documentElement; let sizes = ['normal', 'large', 'xlarge'];
    let idx = sizes.indexOf(root.getAttribute('data-text-size') || 'normal');
    if (direction === 'up' && idx < 2) idx++; if (direction === 'down' && idx > 0) idx--;
    root.setAttribute('data-text-size', sizes[idx]);
}

function formatDate(dateStr) {
    if(!dateStr) return '';
    const parts = dateStr.split('-');
    if(parts.length !== 3) return dateStr;
    return `${parts[2]}/${parts[1]}/${parts[0]}`; 
}

// --- Status Logic ---
function getBPStatus(sys, dia) {
    if (!sys || !dia) return { text: '-', class: '', border: '' };
    if (sys >= 180 || dia >= 120) return { text: 'Very High', class: 'status-very-high', border: 'border-very-high' };
    if (sys >= 140 || dia >= 90) return { text: 'High', class: 'status-high', border: 'border-high' };
    if (sys <= 90 || dia <= 60) return { text: 'Low', class: 'status-low', border: 'border-low' };
    return { text: 'Good', class: 'status-good', border: 'border-good' };
}
function getPulseStatus(pulse) {
    if (!pulse) return { text: '-', class: '', border: '' };
    if (pulse > 120) return { text: 'Very High', class: 'status-very-high', border: 'border-very-high' };
    if (pulse > 100) return { text: 'High', class: 'status-high', border: 'border-high' };
    if (pulse < 40) return { text: 'Very Low', class: 'status-very-low', border: 'border-very-low' };
    if (pulse < 60) return { text: 'Low', class: 'status-low', border: 'border-low' };
    return { text: 'Good', class: 'status-good', border: 'border-good' };
}
function getOxygenStatus(oxy) {
    if (!oxy) return { text: '-', class: '', border: '' };
    if (oxy >= 95) return { text: 'Good', class: 'status-good', border: 'border-good' };
    if (oxy >= 91) return { text: 'Low', class: 'status-low', border: 'border-low' };
    return { text: 'Very Low', class: 'status-very-low', border: 'border-very-low' };
}

// --- Smart API Caller ---
async function apiCall(action, payload = {}) {
    try {
        const res = await fetch(`${API_URL}?action=${action}`, { 
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload) 
        });
        
        const responseText = await res.text();
        try {
            return JSON.parse(responseText);
        } catch(e) {
            console.error("Server data error:", responseText);
            return { success: false, message: 'Server configuration error. Please ensure api.php has no blank lines at the top.' };
        }
    } catch (e) { 
        return { success: false, message: 'Connection failed. Please check your network.' }; 
    }
}

async function fetchReadings() {
    viewingSharedProfile = null;
    const data = await apiCall('get_readings');
    currentReadings = data.success ? data.data : [];
}

async function login() {
    const user = document.getElementById('username').value; 
    const pass = document.getElementById('password').value;
    const remember = document.getElementById('rememberMe').checked; 
    
    const data = await apiCall('login', { username: user, password: pass, remember: remember });
    
    if (data.success) {
        currentUser = data.user;
        document.getElementById('loginScreen').classList.add('hidden');
        document.getElementById('mainApp').classList.remove('hidden');
        await fetchReadings(); navigate('dashboard');
    } else { 
        showModal('Login Failed', data.message || 'Incorrect username or password.'); 
    }
}

async function logout() {
    await apiCall('logout');
    localStorage.removeItem('vitalTrackSharedCode');
    currentUser = null; viewingSharedProfile = null; currentReadings = [];
    document.getElementById('mainApp').classList.add('hidden'); document.getElementById('loginScreen').classList.remove('hidden');
}

function navigate(view, params = {}) {
    const content = document.getElementById('appContent');
    content.innerHTML = ''; 

    document.querySelectorAll('.nav-center button').forEach(btn => {
        if (btn.getAttribute('onclick').includes(`('${view}'`)) {
            btn.style.backgroundColor = 'rgba(128, 128, 128, 0.2)';
            btn.style.borderRadius = '8px';
            btn.style.setProperty('text-decoration', 'none', 'important');
            btn.style.borderBottom = 'none';
            btn.style.fontWeight = 'bold';
            btn.style.opacity = '1';
        } else {
            btn.style.backgroundColor = 'transparent';
            btn.style.setProperty('text-decoration', 'none', 'important');
            btn.style.borderBottom = 'none';
            btn.style.fontWeight = 'normal';
            btn.style.opacity = '0.7';
        }
    });

    if(viewingSharedProfile && view !== 'settings') {
        const banner = document.createElement('div');
        banner.style.cssText = "background: var(--status-high); color: white; padding: 10px; border-radius: 8px; margin-bottom: 20px; text-align: center; font-weight: bold;";
        banner.innerHTML = `Viewing Shared Data for: ${escapeHTML(viewingSharedProfile.name)} <button onclick="exitSharedMode()" style="margin-left:15px; padding:5px 10px; border-radius:5px; border:none; cursor:pointer;">Exit</button>`;
        content.appendChild(banner);
    }
    if (view === 'dashboard') renderDashboard(content);
    else if (view === 'entry') renderEntry(content, params.editId);
    else if (view === 'history') renderHistory(content);
    else if (view === 'report') renderReport(content);
    else if (view === 'settings') renderSettings(content);
}

async function loadSharedUser(code) {
    if(!code) return;
    const res = await apiCall('get_shared_data', { share_code: code });
    if (res.success) {
        viewingSharedProfile = res.profile;
        currentReadings = res.data;
        localStorage.setItem('vitalTrackSharedCode', code);
        navigate('dashboard');
    } else {
        showModal('Error', res.message || 'Invalid share code.');
        localStorage.removeItem('vitalTrackSharedCode');
    }
}
async function exitSharedMode() {
    localStorage.removeItem('vitalTrackSharedCode');
    await fetchReadings();
    navigate('dashboard');
}

function renderDashboard(container) {
    const now = new Date();
    const twentyFourHoursAgo = new Date(now.getTime() - (24 * 60 * 60 * 1000));
    const sevenDaysAgo = new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000));
    
    const sevenDaysRecent = currentReadings.filter(r => {
        const rDate = new Date(`${r.date}T${r.time}`);
        return rDate >= sevenDaysAgo;
    });

    const twentyFourHoursRecent = currentReadings.filter(r => {
        const rDate = new Date(`${r.date}T${r.time}`);
        return rDate >= twentyFourHoursAgo;
    });
    
    let avgSys = 0, avgDia = 0, avgPulse = 0, avgOxy = 0, bpCount = 0, pCount = 0, oCount = 0;
    
    sevenDaysRecent.forEach(r => {
        if(r.sys && r.dia) { avgSys += parseInt(r.sys); avgDia += parseInt(r.dia); bpCount++; }
        if(r.pulse) { avgPulse += parseInt(r.pulse); pCount++; }
        if(r.oxygen) { avgOxy += parseInt(r.oxygen); oCount++; }
    });
    
    avgSys = bpCount ? Math.round(avgSys/bpCount) : 0;
    avgDia = bpCount ? Math.round(avgDia/bpCount) : 0;
    avgPulse = pCount ? Math.round(avgPulse/pCount) : 0;
    avgOxy = oCount ? Math.round(avgOxy/oCount) : 0;
    
    const bpStat = getBPStatus(avgSys, avgDia); const pulseStat = getPulseStatus(avgPulse); const oxyStat = getOxygenStatus(avgOxy);
    
    const noDataText7Days = `<p style="font-size: 1rem; margin-top: 5px; color: var(--text-muted);">No data in the past seven days</p>`;
    const bpHtml = bpCount ? `<p style="font-size: 1.2rem; margin-top: 5px;">${escapeHTML(avgSys)}/${escapeHTML(avgDia)} <span class="${bpStat.class}">(${bpStat.text})</span></p>` : noDataText7Days;
    const pulseHtml = pCount ? `<p style="font-size: 1.2rem; margin-top: 5px;">${escapeHTML(avgPulse)} bpm <span class="${pulseStat.class}">(${pulseStat.text})</span></p>` : noDataText7Days;
    const oxyHtml = oCount ? `<p style="font-size: 1.2rem; margin-top: 5px;">${escapeHTML(avgOxy)}% <span class="${oxyStat.class}">(${oxyStat.text})</span></p>` : noDataText7Days;
    
    const actionDisabled = viewingSharedProfile ? 'disabled style="opacity:0.5"' : '';
    
    let recentTableHtml = `<div style="overflow-x: auto;"><table class="admin-table" style="font-size:0.9em; margin-bottom: 0;"><thead><tr><th>Date</th><th>BP</th><th>Pulse</th><th>Oxygen</th></tr></thead><tbody>`;
    if (twentyFourHoursRecent.length === 0) { 
        recentTableHtml += `<tr><td colspan="4" style="text-align:center; color:var(--text-muted); padding: 20px;">No data in the past 24 hours</td></tr>`; 
    } else { 
        twentyFourHoursRecent.forEach(r => {
            const bp = getBPStatus(r.sys, r.dia); const pu = getPulseStatus(r.pulse); const ox = getOxygenStatus(r.oxygen);
            recentTableHtml += `<tr><td>${formatDate(r.date)}<br><small>${escapeHTML(r.time)}</small></td><td>${r.sys ? `${escapeHTML(r.sys)}/${escapeHTML(r.dia)} <br><span class="${bp.class}">(${bp.text})</span>` : '-'}</td><td>${r.pulse ? `${escapeHTML(r.pulse)} <br><span class="${pu.class}">(${pu.text})</span>` : '-'}</td><td>${r.oxygen ? `${escapeHTML(r.oxygen)}% <br><span class="${ox.class}">(${ox.text})</span>` : '-'}</td></tr>`;
        }); 
    }
    recentTableHtml += `</tbody></table></div>`;
    
    container.innerHTML += `<div class="dashboard-grid"><div class="card card-full"><h3>Seven Day Averages</h3><div class="dashboard-averages-wrapper"><div class="card ${bpStat.border}" style="flex: 1; min-width: 200px; padding: 20px;"><h4>Blood Pressure</h4>${bpHtml}</div><div class="card ${pulseStat.border}" style="flex: 1; min-width: 200px; padding: 20px;"><h4>Pulse Rate</h4>${pulseHtml}</div><div class="card ${oxyStat.border}" style="flex: 1; min-width: 200px; padding: 20px;"><h4>Oxygen Level</h4>${oxyHtml}</div></div></div><div class="card"><h3>Quick Actions</h3><button class="btn-primary" ${actionDisabled} onclick="navigate('entry')">Record New Entry</button></div><div class="card" style="padding-bottom: 15px;"><h3>Readings From Past 24 Hours</h3>${recentTableHtml}</div></div>`;
}

function renderEntry(container, editId = null) {
    if(viewingSharedProfile) { container.innerHTML = "<h3>Cannot edit shared data.</h3>"; return; }
    editingReadingId = editId;
    let r = { date: new Date().toISOString().split('T')[0], time: new Date().toTimeString().slice(0,5), sys:'', dia:'', pulse:'', oxygen:'', notes:'' };
    if (editId) { const found = currentReadings.find(x => x.id == editId); if(found) r = found; }
    
    container.innerHTML = `
        <div class="card">
            <h3>${editId ? 'Edit Entry' : 'New Entry'}</h3>
            <label>Date</label> <input type="date" id="entryDate" value="${escapeHTML(r.date)}">
            <label>Time</label> <input type="time" id="entryTime" value="${escapeHTML(r.time)}">
            
            <label>Recording Type</label>
            <select id="entryType" onchange="toggleInputs()" style="margin-bottom: 25px;">
                <option value="all">Blood Pressure, Pulse and Oxygen</option>
                <option value="bp_pulse">Blood Pressure and Pulse</option>
                <option value="oxy_pulse">Oxygen and Pulse</option>
            </select>
            
            <button type="button" class="btn-primary" style="background: var(--text-muted); padding: 10px; font-size: 0.9em; margin-bottom: 20px; display: block; width: 100%; box-sizing: border-box;" onclick="document.getElementById('avgPanel').classList.toggle('hidden')">Calculate Average from Three Readings</button>
            
            <div id="avgPanel" class="hidden" style="background: rgba(0,0,0,0.03); border: 1px dashed var(--text-muted); padding: 15px; border-radius: 8px; margin-bottom: 20px;">
                <h4 style="margin-bottom: 5px;">Average Calculator</h4>
                <p style="font-size: 0.85em; color: var(--text-muted); margin-bottom: 15px;">Enter up to 3 test readings. Leave blanks if you took fewer. We will calculate the average and automatically fill the form for you.</p>
                <div style="overflow-x: auto; margin-bottom: 15px;">
                    <table style="width: 100%; text-align: center; font-size: 0.85em; border-spacing: 5px;">
                        <tr><th></th><th>Systolic</th><th>Diastolic</th><th>Pulse</th></tr>
                        <tr><td><b>#1</b></td><td><input type="number" id="a_sys1" style="margin:0; padding:5px;"></td><td><input type="number" id="a_dia1" style="margin:0; padding:5px;"></td><td><input type="number" id="a_pul1" style="margin:0; padding:5px;"></td></tr>
                        <tr><td><b>#2</b></td><td><input type="number" id="a_sys2" style="margin:0; padding:5px;"></td><td><input type="number" id="a_dia2" style="margin:0; padding:5px;"></td><td><input type="number" id="a_pul2" style="margin:0; padding:5px;"></td></tr>
                        <tr><td><b>#3</b></td><td><input type="number" id="a_sys3" style="margin:0; padding:5px;"></td><td><input type="number" id="a_dia3" style="margin:0; padding:5px;"></td><td><input type="number" id="a_pul3" style="margin:0; padding:5px;"></td></tr>
                    </table>
                </div>
                <button type="button" class="btn-primary" style="margin-bottom:0;" onclick="applyAverage()">Use This Average For Reading</button>
            </div>

            <div id="bpInputs">
                <label>Systolic (mmHg)</label> <input type="number" id="sys" value="${escapeHTML(r.sys)}">
                <label>Diastolic (mmHg)</label> <input type="number" id="dia" value="${escapeHTML(r.dia)}">
            </div>
            <div id="pulseInput">
                <label>Pulse (bpm)</label> <input type="number" id="pulse" value="${escapeHTML(r.pulse)}">
            </div>
            <div id="oxyInput">
                <label>Oxygen (%)</label> <input type="number" id="oxy" value="${escapeHTML(r.oxygen)}">
            </div>
            <label>Notes</label>
            <textarea id="notes" rows="3">${escapeHTML(r.notes)}</textarea>
            <button class="btn-primary" onclick="saveEntry()">${editId ? 'Update Reading' : 'Save Reading'}</button>
        </div>
    `;
    
    window.toggleInputs = function() { const type = document.getElementById('entryType').value; document.getElementById('bpInputs').classList.toggle('hidden', type === 'oxy_pulse'); document.getElementById('oxyInput').classList.toggle('hidden', type === 'bp_pulse'); };
    
    window.applyAverage = function() {
        let sys=[], dia=[], pul=[];
        for(let i=1; i<=3; i++) {
            let s = parseInt(document.getElementById('a_sys'+i).value); if(s) sys.push(s);
            let d = parseInt(document.getElementById('a_dia'+i).value); if(d) dia.push(d);
            let p = parseInt(document.getElementById('a_pul'+i).value); if(p) pul.push(p);
        }
        if(sys.length) document.getElementById('sys').value = Math.round(sys.reduce((a,b)=>a+b,0)/sys.length);
        if(dia.length) document.getElementById('dia').value = Math.round(dia.reduce((a,b)=>a+b,0)/dia.length);
        if(pul.length) document.getElementById('pulse').value = Math.round(pul.reduce((a,b)=>a+b,0)/pul.length);
        
        document.getElementById('avgPanel').classList.add('hidden');
        showModal('Calculated', 'The average readings have been calculated and applied to this entry.');
    };
}

async function saveEntry() {
    const payload = { reading_id: editingReadingId, date: document.getElementById('entryDate').value, time: document.getElementById('entryTime').value, period: '', sys: document.getElementById('sys')?.value || null, dia: document.getElementById('dia')?.value || null, pulse: document.getElementById('pulse')?.value || null, oxygen: document.getElementById('oxy')?.value || null, notes: document.getElementById('notes').value };
    const action = editingReadingId ? 'update_reading' : 'save_reading';
    const res = await apiCall(action, payload);
    if(res.success) { 
        editingReadingId = null; await fetchReadings(); navigate('dashboard'); 
    } else {
        showModal('Error', res.message || 'Action failed.');
    }
}

async function deleteEntry(id) {
    showConfirmModal('Delete Reading', 'Are you sure you want to delete this reading?', async () => {
        currentReadings = currentReadings.filter(r => r.id != id);
        if (document.getElementById('historyTableBody')) {
            updateHistoryView();
        }
        const res = await apiCall('delete_reading', { reading_id: id });
        if(res.success) { 
            await fetchReadings(); 
            if (document.getElementById('historyTableBody')) updateHistoryView(); 
        } else {
            await fetchReadings();
            if (document.getElementById('historyTableBody')) updateHistoryView();
            showModal('Error', res.message || 'Action failed.'); 
        }
    });
}

function renderHistory(container) {
    const today = new Date(); const threeMonthsAgo = new Date(); threeMonthsAgo.setMonth(today.getMonth() - 3);
    container.innerHTML += `<div class="card"><h3>Historical Graph</h3><div style="display:flex; gap:10px; margin-bottom: 20px; flex-wrap: wrap;"><div style="flex:1"><label>Start Date</label><input type="date" id="histStart" value="${threeMonthsAgo.toISOString().split('T')[0]}" onchange="updateHistoryView()"></div><div style="flex:1"><label>End Date</label><input type="date" id="histEnd" value="${today.toISOString().split('T')[0]}" onchange="updateHistoryView()"></div></div><canvas id="historyChart" style="width:100%; max-height: 350px;"></canvas></div><div class="card"><h3>Historical Results</h3><div style="overflow-x: auto;"><table class="admin-table"><thead><tr><th>Date</th><th>BP</th><th>Pulse</th><th>Oxygen</th><th>Notes</th>${!viewingSharedProfile ? '<th>Actions</th>' : ''}</tr></thead><tbody id="historyTableBody"></tbody></table></div></div>`;
    updateHistoryView();
}

function updateHistoryView() {
    const startStr = document.getElementById('histStart').value; const endStr = document.getElementById('histEnd').value;
    const filtered = currentReadings.filter(r => { return (!startStr || r.date >= startStr) && (!endStr || r.date <= endStr); }).reverse(); 
    const tbody = document.getElementById('historyTableBody'); tbody.innerHTML = '';
    
    if(filtered.length === 0) tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;">No readings found for this period.</td></tr>`;
    
    [...filtered].reverse().forEach(r => {
        const bp = getBPStatus(r.sys, r.dia); const pu = getPulseStatus(r.pulse); const ox = getOxygenStatus(r.oxygen);
        const actionHtml = !viewingSharedProfile ? `<td><button class="btn-primary" onclick="navigate('entry', {editId: ${escapeHTML(r.id)}})" style="padding: 6px 12px; font-size: 0.9rem; width: auto; margin-right: 5px; margin-bottom: 5px; display: inline-block;">Edit</button><button class="btn-primary" onclick="deleteEntry(${escapeHTML(r.id)})" style="padding: 6px 12px; font-size: 0.9rem; width: auto; margin-bottom: 5px; display: inline-block; background-color: var(--status-very-high); box-shadow: none;">Delete</button></td>` : '';
        tbody.innerHTML += `<tr><td>${formatDate(r.date)}<br><small>${escapeHTML(r.time)}</small></td><td>${r.sys ? `${escapeHTML(r.sys)}/${escapeHTML(r.dia)} <br><span class="${bp.class}">(${bp.text})</span>` : '-'}</td><td>${r.pulse ? `${escapeHTML(r.pulse)} <br><span class="${pu.class}">(${pu.text})</span>` : '-'}</td><td>${r.oxygen ? `${escapeHTML(r.oxygen)}% <br><span class="${ox.class}">(${ox.text})</span>` : '-'}</td><td>${escapeHTML(r.notes) || '-'}</td>${actionHtml}</tr>`;
    });
    
    if(historyChartInstance) historyChartInstance.destroy();
    const ctx = document.getElementById('historyChart').getContext('2d');
    historyChartInstance = new Chart(ctx, { type: 'line', data: { labels: filtered.map(r => formatDate(r.date)), datasets: [{ label: 'Systolic', data: filtered.map(r => r.sys), borderColor: '#ef4444', tension: 0.1, spanGaps: true }, { label: 'Diastolic', data: filtered.map(r => r.dia), borderColor: '#f87171', tension: 0.1, spanGaps: true }, { label: 'Pulse', data: filtered.map(r => r.pulse), borderColor: '#16a34a', tension: 0.1, spanGaps: true }, { label: 'Oxygen', data: filtered.map(r => r.oxygen), borderColor: '#3b82f6', tension: 0.1, spanGaps: true }] }, options: { responsive: true, maintainAspectRatio: false } });
}

function renderReport(container) {
    const today = new Date().toISOString().split('T')[0];
    
    container.innerHTML = `
        <div class="card">
            <h3>Export Reports</h3>
            <div style="display:flex; gap:10px; margin-bottom: 20px;">
                <div style="flex:1"><label>Start Date</label><input type="date" id="repStart"></div>
                <div style="flex:1"><label>End Date</label><input type="date" id="repEnd" value="${today}"></div>
            </div>
            
            <label>Report Sorting</label>
            <select id="repSort" style="margin-bottom: 20px;">
                <option value="desc">Newest First (Descending)</option>
                <option value="asc">Oldest First (Ascending)</option>
            </select>
            
            <label>Include Data in PDF</label>
            <div style="margin-bottom: 25px; display:flex; gap: 15px;">
                <label style="font-weight:normal"><input type="checkbox" id="incBP" checked> Blood Pressure</label>
                <label style="font-weight:normal"><input type="checkbox" id="incPulse" checked> Pulse</label>
                <label style="font-weight:normal"><input type="checkbox" id="incOxy" checked> Oxygen</label>
            </div>
            
            <button class="btn-primary" onclick="triggerEmailReport()">Send PDF to My Email</button>
            <button class="btn-primary" style="background: var(--text-muted);" onclick="generatePDF('share')">Email / Share PDF Report</button>
            <button class="btn-primary" style="background: var(--text-muted);" onclick="generatePDF('download')">Download PDF Report</button>
            <button class="btn-primary" style="background: var(--text-muted);" onclick="generateCSV()">Export to CSV</button>
            <canvas id="pdfHiddenChart" width="800" height="400" class="hidden"></canvas>
        </div>
        
        <div class="card" style="margin-top: 20px;">
            <h3>NHS & WHO Thresholds Guide</h3>
            <p style="font-size: 0.9em; margin-bottom: 15px; color: var(--text-muted);">This guide explains the colour-coding used on the Dashboard and History pages and in your generated PDF reports according to general NHS and WHO health guidelines.</p>
            <div style="overflow-x: auto;">
                <table class="admin-table" style="font-size: 0.85em; text-align: left;">
                    <thead>
                        <tr><th>Status / Color</th><th>Blood Pressure (Sys/Dia)</th><th>Pulse Rate</th><th>Oxygen (SpO2)</th></tr>
                    </thead>
                    <tbody>
                        <tr><td style="color: #991b1b; font-weight: bold;">Very High</td><td>180+ / 120+</td><td>120+ bpm</td><td>-</td></tr>
                        <tr><td style="color: #dc2626; font-weight: bold;">High</td><td>140-179 / 90-119</td><td>101-120 bpm</td><td>-</td></tr>
                        <tr><td style="color: #16a34a; font-weight: bold;">Good</td><td>91-139 / 61-89</td><td>60-100 bpm</td><td>95-100%</td></tr>
                        <tr><td style="color: #dc2626; font-weight: bold;">Low</td><td>90 or less / 60 or less</td><td>40-59 bpm</td><td>91-94%</td></tr>
                        <tr><td style="color: #991b1b; font-weight: bold;">Very Low</td><td>-</td><td>Below 40 bpm</td><td>90% or less</td></tr>
                    </tbody>
                </table>
            </div>
        </div>
    `;
}

window.triggerEmailReport = function() {
    const email = viewingSharedProfile ? viewingSharedProfile.email : currentUser.email;
    
    if (!email) {
        return showModal('Email Required', 'Please add and save an email address in the Profile section on the Settings page first.');
    }
    
    showConfirmModal('Send Email Report', `This will email the PDF report directly to:\n\n${escapeHTML(email)}\n\nNote: As this is an automated message, it may go into your spam or junk folder. Please check there if you don't receive it in your inbox shortly.`, () => {
        generatePDF('email');
    });
};

function generatePDF(action = 'download') {
    const startStr = document.getElementById('repStart').value; const endStr = document.getElementById('repEnd').value;
    const sortOrder = document.getElementById('repSort').value;
    const incBP = document.getElementById('incBP').checked; const incPulse = document.getElementById('incPulse').checked; const incOxy = document.getElementById('incOxy').checked;
    
    if(!incBP && !incPulse && !incOxy) return showModal('Notice', 'Please select at least one data type to include.');
    
    // Default currentReadings comes in from DB as Newest First. filtered is reversed to Oldest First (Ascending) for the Chart.
    const filtered = currentReadings.filter(r => { return (!startStr || r.date >= startStr) && (!endStr || r.date <= endStr); }).reverse();
    if(filtered.length === 0) return showModal('Notice', 'No data found for selected period.');
    
    const targetProfile = viewingSharedProfile || currentUser;
    const patientName = escapeHTML(targetProfile.name) || 'Unknown Patient'; let patientDob = escapeHTML(targetProfile.dob) || 'DD/MM/YYYY';
    if(pdfChartInstance) pdfChartInstance.destroy();
    
    const ctx = document.getElementById('pdfHiddenChart').getContext('2d'); ctx.clearRect(0, 0, 800, 400);
    const chartDatasets = [];
    if(incBP) { chartDatasets.push({ label: 'Systolic', data: filtered.map(r=>r.sys || null), borderColor: '#ef4444', backgroundColor: 'transparent', spanGaps: true }); chartDatasets.push({ label: 'Diastolic', data: filtered.map(r=>r.dia || null), borderColor: '#f87171', backgroundColor: 'transparent', spanGaps: true }); }
    if(incPulse) chartDatasets.push({ label: 'Pulse', data: filtered.map(r=>r.pulse || null), borderColor: '#16a34a', backgroundColor: 'transparent', spanGaps: true });
    if(incOxy) chartDatasets.push({ label: 'Oxygen', data: filtered.map(r=>r.oxygen || null), borderColor: '#3b82f6', backgroundColor: 'transparent', spanGaps: true });
    
    pdfChartInstance = new Chart(ctx, { type: 'line', data: { labels: filtered.map(r => formatDate(r.date)), datasets: chartDatasets }, options: { responsive: false, animation: false } });
    
    setTimeout(() => {
        const chartImg = document.getElementById('pdfHiddenChart').toDataURL("image/png", 1.0); const { jsPDF } = window.jspdf; const doc = new jsPDF();
        doc.setFontSize(16); doc.text("Patient Report", 14, 20); doc.setFontSize(10); doc.text(`Name: ${patientName}`, 14, 30); doc.text(`Date of Birth: ${patientDob}`, 14, 35);
        doc.addImage(chartImg, 'PNG', 14, 45, 180, 80);
        
        const tableHead = [['Date', 'Time']]; 
        if(incBP) tableHead[0].push('Blood Pressure'); 
        if(incPulse) tableHead[0].push('Pulse'); 
        if(incOxy) tableHead[0].push('Oxygen');
        tableHead[0].push('Notes');

        // Prepare the data order based on user selection
        let pdfTableData = [...filtered]; 
        if (sortOrder === 'desc') {
            pdfTableData.reverse(); // Flip it to Newest First if selected
        }

        const tableBody = pdfTableData.map(r => {
            const row = [formatDate(r.date), r.time];
            if(incBP) { const s = getBPStatus(r.sys, r.dia); row.push(r.sys ? `${r.sys}/${r.dia}\n(${s.text})` : '-'); }
            if(incPulse) { const s = getPulseStatus(r.pulse); row.push(r.pulse ? `${r.pulse}\n(${s.text})` : '-'); }
            if(incOxy) { const s = getOxygenStatus(r.oxygen); row.push(r.oxygen ? `${r.oxygen}%\n(${s.text})` : '-'); }
            row.push(r.notes ? r.notes : '-');
            return row;
        });
        
        doc.autoTable({ 
            startY: 135, head: tableHead, body: tableBody, styles: { fontSize: 9, halign: 'center' }, headStyles: { fillColor: [29, 78, 216] }, 
            didParseCell: function(data) { 
                if(data.section === 'body' && data.column.index > 1) { 
                    const rawStr = String(data.cell.raw);
                    if(rawStr.includes('\n(')) {
                        data.cell.customText = rawStr; 
                        const lines = rawStr.split('\n'); 
                        data.cell.text = lines.map(() => ''); 
                    }
                } 
            }, 
            didDrawCell: function(data) { 
                if(data.section === 'body' && data.cell.customText) { 
                    const raw = String(data.cell.customText); 
                    const centerY = data.cell.y + (data.cell.height / 2); 
                    const centerX = data.cell.x + (data.cell.width / 2); 
                    if(raw !== '-') { 
                        const parts = raw.split('\n'); const val = parts[0]; const stat = parts[1] || ''; 
                        doc.setFontSize(9); doc.setFont("helvetica", "normal"); doc.setTextColor(40, 40, 40); doc.text(val, centerX, centerY - 2.5, { align: 'center', baseline: 'middle' }); 
                        if (stat.includes('(Very High)') || stat.includes('(Very Low)')) { doc.setTextColor(153, 27, 27); doc.setFont("helvetica", "bold"); } 
                        else if (stat.includes('(High)') || stat.includes('(Low)')) { doc.setTextColor(220, 38, 38); doc.setFont("helvetica", "bold"); } 
                        else if (stat.includes('(Good)')) { doc.setTextColor(22, 163, 74); doc.setFont("helvetica", "bold"); } 
                        else { doc.setTextColor(40, 40, 40); doc.setFont("helvetica", "normal"); } 
                        if(stat) doc.text(stat, centerX, centerY + 2.5, { align: 'center', baseline: 'middle' }); 
                    } else { 
                        doc.setFontSize(9); doc.setFont("helvetica", "normal"); doc.setTextColor(40, 40, 40); doc.text('-', centerX, centerY, { align: 'center', baseline: 'middle' }); 
                    } 
                } 
            } 
        });
        
        let finalY = doc.lastAutoTable.finalY + 15;
        if (finalY > doc.internal.pageSize.height - 60) { doc.addPage(); finalY = 20; }
        
        doc.setFontSize(12); doc.setTextColor(40, 40, 40); doc.setFont("helvetica", "bold");
        doc.text("NHS & WHO Thresholds Guide", 14, finalY);
        
        doc.autoTable({
            startY: finalY + 5,
            head: [['Status', 'Blood Pressure (Sys/Dia)', 'Pulse Rate', 'Oxygen (SpO2)']],
            body: [
                ['Very High', '180+ / 120+', '120+ bpm', '-'],
                ['High', '140-179 / 90-119', '101-120 bpm', '-'],
                ['Good', '91-139 / 61-89', '60-100 bpm', '95-100%'],
                ['Low', '90 or less / 60 or less', '40-59 bpm', '91-94%'],
                ['Very Low', '-', 'Below 40 bpm', '90% or less']
            ],
            styles: { fontSize: 9, halign: 'center' },
            headStyles: { fillColor: [100, 116, 139] },
            didParseCell: function(data) {
                if (data.section === 'body' && data.column.index === 0) {
                    data.cell.styles.fontStyle = 'bold';
                    if (data.cell.raw === 'Very High' || data.cell.raw === 'Very Low') data.cell.styles.textColor = [153, 27, 27];
                    else if (data.cell.raw === 'High' || data.cell.raw === 'Low') data.cell.styles.textColor = [220, 38, 38];
                    else if (data.cell.raw === 'Good') data.cell.styles.textColor = [22, 163, 74];
                }
            }
        });

        const pageCount = doc.internal.getNumberOfPages(); for (let i = 1; i <= pageCount; i++) { doc.setPage(i); doc.setFontSize(8); doc.setTextColor(100); doc.setFont("helvetica", "normal"); doc.text(`Page ${i}`, 14, doc.internal.pageSize.height - 10); doc.text(`Patient Name: ${patientName} | Date of Birth: ${patientDob}`, doc.internal.pageSize.width - 14, doc.internal.pageSize.height - 10, { align: 'right' }); }
        
        const fileName = `Patient_Report_${patientName.replace(/\s+/g, '_')}.pdf`;
        
        if (action === 'email') {
            const pdfDataUri = doc.output('datauristring');
            showModal('Sending...', 'Please wait while your report is being emailed...');
            
            apiCall('email_report', { pdf_data: pdfDataUri }).then(res => {
                if(res.success) {
                    showModal('Email Sent', 'Your report has been successfully sent. Please check your spam or junk folder if it does not appear in your inbox shortly.');
                } else {
                    showModal('Error', res.message || 'There was an error sending the email.');
                }
            });
        } else if (action === 'share') {
            const pdfBlob = doc.output('blob');
            const file = new File([pdfBlob], fileName, { type: 'application/pdf' });
            
            if (navigator.canShare && navigator.canShare({ files: [file] })) {
                if (currentUser?.email) navigator.clipboard.writeText(currentUser.email).catch(() => {});
                setTimeout(() => {
                    navigator.share({
                        files: [file], title: 'Health Report', text: `Attached is the health report for ${patientName}.`
                    }).catch(e => console.log('Share canceled or failed:', e));
                }, 200); 
            } else {
                showModal('Notice', 'File sharing is not supported on this browser or device. The file will be downloaded instead.');
                doc.save(fileName);
            }
        } else {
            doc.save(fileName);
        }
    }, 500); 
}

function generateCSV() {
    if (currentReadings.length === 0) return showModal('Notice', 'No data to export.');
    let csvContent = "Date,Time,Period,Systolic,Diastolic,Pulse,Oxygen,Notes\n";
    const escapeCSV = (str) => { let clean = escapeHTML(str); if (clean && /^[=\+\-@]/.test(clean)) clean = "'" + clean; return clean; };
    currentReadings.forEach(r => { csvContent += `${formatDate(r.date)},${escapeHTML(r.time)},${escapeHTML(r.period||'')},${escapeHTML(r.sys||'')},${escapeHTML(r.dia||'')},${escapeHTML(r.pulse||'')},${escapeHTML(r.oxygen||'')},"${escapeCSV(r.notes||'')}"\n`; });
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' }); const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = `VitalTrack_Data_${new Date().toISOString().split('T')[0]}.csv`; link.style.display = "none"; document.body.appendChild(link); link.click(); document.body.removeChild(link);
}

async function renderSettings(container) {
    if(viewingSharedProfile) { container.innerHTML = "<h3>Cannot access settings while viewing shared data.</h3>"; return; }
    const savedCode = localStorage.getItem('vitalTrackSharedCode') || '';
    let adminHtml = ''; if (currentUser?.role === 'admin') { adminHtml = `<div class="card"><h3>Admin Panel</h3><div class="admin-grid" style="margin-bottom: 30px;"><div class="admin-form"><h4 style="margin-bottom:15px;">Add New User</h4><input type="text" id="newUsername" placeholder="Username" style="margin-bottom:10px;"><input type="password" id="newPassword" placeholder="Password" style="margin-bottom:10px;"><select id="newRole" style="margin-bottom:10px;"><option value="user">User</option><option value="viewer">Viewer</option><option value="admin">Admin</option></select><button class="btn-primary" style="margin-bottom:0;" onclick="adminAddUser()">Add User</button></div><div class="admin-form"><h4 style="margin-bottom:15px;">Reset User Password</h4><select id="resetUserId" style="margin-bottom:10px;"><option value="">Select User...</option></select><input type="password" id="resetPassword" placeholder="New Password" style="margin-bottom:10px;"><button class="btn-primary" style="background: var(--text-muted); margin-bottom:0;" onclick="adminResetPassword()">Reset Password</button></div></div><h4 style="margin-bottom: 10px;">Manage Existing Users</h4><div style="overflow-x:auto;"><table class="admin-table"><thead><tr><th>User</th><th>Role</th><th>Action</th></tr></thead><tbody id="adminUserList"><tr><td colspan="3">Loading...</td></tr></tbody></table></div></div>`; }
    
    container.innerHTML += `${adminHtml}
        <div class="card">
            <h3>Profile</h3>
            <label>Full Name</label> 
            <input type="text" id="profName" value="${escapeHTML(currentUser?.name || '')}">
            <label>Date of Birth (DD/MM/YYYY)</label> 
            <input type="text" id="profDOB" placeholder="DD/MM/YYYY" value="${escapeHTML(currentUser?.dob || '')}">
            <label>Email Address</label> 
            <input type="text" id="profEmail" placeholder="yourdoctor@email.com" value="${escapeHTML(currentUser?.email || '')}">
            <button class="btn-primary" onclick="saveProfile()">Save Profile</button>
        </div>
        <div class="card">
            <h3>Share Data</h3>
            <label>Your Share Code (Give to someone to view your data)</label>
            <div style="display:flex; gap:10px; margin-bottom: 25px; flex-wrap: wrap;">
                <input type="text" id="myShareCode" value="${escapeHTML(currentUser?.share_code || 'No code generated')}" readonly style="margin-bottom:0; flex: 1; min-width: 150px;">
                <button class="btn-primary" style="width: auto; margin-bottom:0;" onclick="copyShareCode()">Copy Code</button>
                <button class="btn-primary" style="width: auto; margin-bottom:0; background: var(--text-muted);" onclick="genShareCode()">${currentUser?.share_code ? 'Regenerate Code' : 'Generate Code'}</button>
            </div>
            <label>View Another User's Data</label>
            <p style="font-size:0.85em; color:var(--text-muted);">Enter their code to view their dashboard. This will be saved so you don't have to re-enter it.</p>
            <div style="display:flex; gap:10px;">
                <input type="text" id="viewShareCode" placeholder="Enter 10-char code" value="${escapeHTML(savedCode)}" style="margin-bottom:0; text-transform: uppercase;">
                <button class="btn-primary" style="width: auto; margin-bottom:0;" onclick="saveAndLoadSharedCode()">Save & View</button>
            </div>
        </div>
        <div class="card">
            <h3>Backup & Restore</h3>
            <button class="btn-primary" onclick="downloadJSON()">Download JSON Backup</button>
            <input type="file" id="jsonUpload" accept=".json" class="hidden" onchange="uploadJSON(event)">
            <button class="btn-primary" style="background: var(--text-muted);" onclick="document.getElementById('jsonUpload').click()">Upload JSON to Restore</button>
        </div>`;
    if (currentUser?.role === 'admin') loadAdminUsers();
}

async function saveAndLoadSharedCode() { const code = document.getElementById('viewShareCode').value.trim().toUpperCase(); if(code) loadSharedUser(code); }
function copyShareCode() { const code = document.getElementById('myShareCode').value; if (!code || code === 'No code generated') return showModal('Error', 'No code generated yet.'); navigator.clipboard.writeText(code).then(() => { showModal('Success', 'Share code copied to clipboard!'); }); }

async function saveProfile() { 
    const name = document.getElementById('profName').value; 
    const dob = document.getElementById('profDOB').value; 
    const email = document.getElementById('profEmail').value; 
    
    const res = await apiCall('update_profile', { name, dob, email }); 
    if (res.success) { 
        currentUser.name = name; 
        currentUser.dob = dob; 
        currentUser.email = email; 
        showModal('Success', 'Profile updated.'); 
    } else { 
        showModal('Error', res.message || 'Action failed.'); 
    } 
}

async function genShareCode() { 
    const doGen = async () => {
        const res = await apiCall('generate_share_code'); 
        if (res.success) { 
            currentUser.share_code = res.share_code; 
            document.getElementById('myShareCode').value = res.share_code; 
            renderSettings(document.getElementById('appContent')); 
            showModal('Success', 'New share code generated.'); 
        } else {
            showModal('Error', res.message || 'Action failed.');
        }
    };
    if (currentUser?.share_code) {
        showConfirmModal('Revoke Access?', 'Generating a new code will permanently revoke access for anyone using the old code. Do you want to continue?', doGen);
    } else { doGen(); }
}

async function downloadJSON() { const res = await fetch(`${API_URL}?action=backup_data`); const data = await res.json(); if(data.success) { const blob = new Blob([JSON.stringify(data.backup, null, 2)], { type: 'application/json' }); const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = "VitalTrack_Backup.json"; link.click(); } }
function uploadJSON(event) { const file = event.target.files[0]; if (!file) return; const reader = new FileReader(); reader.onload = async (e) => { try { const readings = JSON.parse(e.target.result); const res = await apiCall('restore_data', { readings }); if (res.success) { showModal('Success', 'Data restored successfully.'); fetchReadings(); } } catch(err) { showModal('Error', 'Invalid JSON file.'); } }; reader.readAsText(file); }
async function loadAdminUsers() { const res = await apiCall('admin_action', { task: 'get_users' }); if (res.success) { const tbody = document.getElementById('adminUserList'); const resetDropdown = document.getElementById('resetUserId'); tbody.innerHTML = ''; resetDropdown.innerHTML = '<option value="">Select User...</option>'; res.users.forEach(u => { tbody.innerHTML += `<tr><td><strong>${escapeHTML(u.username)}</strong><br><small style="color:var(--text-muted);">${escapeHTML(u.name || 'No Name')}</small></td><td style="text-transform: capitalize;">${escapeHTML(u.role)}</td><td><button onclick="deleteAdminUser(${escapeHTML(u.id)})" style="padding:8px 12px; background:var(--status-very-high); color:#fff; border:none; border-radius:6px; cursor:pointer;">Delete</button></td></tr>`; resetDropdown.innerHTML += `<option value="${escapeHTML(u.id)}">${escapeHTML(u.username)}</option>`; }); } }
async function adminAddUser() { const user = document.getElementById('newUsername').value; const pass = document.getElementById('newPassword').value; const role = document.getElementById('newRole').value; if(!user || !pass) return showModal('Error', 'Username and password required.'); const res = await apiCall('admin_action', { task: 'add_user', new_username: user, new_password: pass, new_role: role }); if(res.success) { showModal('Success', 'User added.'); document.getElementById('newUsername').value = ''; document.getElementById('newPassword').value = ''; loadAdminUsers(); } else { showModal('Error', res.message || 'Action failed.'); } }
async function adminResetPassword() { const userId = document.getElementById('resetUserId').value; const newPass = document.getElementById('resetPassword').value; if(!userId || !newPass) return showModal('Error', 'Select a user and enter a new password.'); const res = await apiCall('admin_action', { task: 'reset_password', target_user_id: userId, new_password: newPass }); if(res.success) { showModal('Success', 'Password reset.'); document.getElementById('resetPassword').value = ''; } else { showModal('Error', res.message || 'Action failed.'); } }

async function deleteAdminUser(id) { 
    showConfirmModal('Delete User', 'Delete this user and all their data? This cannot be undone.', async () => {
        const res = await apiCall('admin_action', { task: 'delete_user', target_user_id: id }); 
        if(res.success) loadAdminUsers(); 
        else showModal('Error', res.message || 'Action failed.');
    });
}
