const firebaseConfig = {
    apiKey: "AIzaSyCnCb-wFeYsB-dH-YqRn-ZK0KA_1HHCb-M",
    authDomain: "farm-app-bf9eb.firebaseapp.com",
    projectId: "farm-app-bf9eb",
    databaseURL: "https://farm-app-bf9eb-default-rtdb.firebaseio.com/", // ここを追加
    storageBucket: "farm-app-bf9eb.firebasestorage.app",
    messagingSenderId: "1041481730841",
    appId: "1:1041481730841:web:722aa0b890a3b6d5dfd388",
    measurementId: "G-RZFPQHDJY9"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const db = firebase.database();

// State Management
let state = {
    farms: [],
    fields: [],
    logs: [],
    currentView: null,
    isDrawing: false,
    tempPoints: [],
    tempPolygon: null,
    pendingGeoJSON: null
};

// Initialize Map
const map = L.map('map', {
    zoomControl: false
}).setView([35.6895, 139.6917], 15);

const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap'
});

const gsiSatellite = L.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg', {
    attribution: '国土地理院'
});

gsiSatellite.addTo(map);

const baseMaps = {
    "航空写真": gsiSatellite,
    "標準地図": osm
};
L.control.layers(baseMaps, null, { position: 'bottomright' }).addTo(map);

// App Logic
function init() {
    setupEventListeners();
    loadData(); // Firebaseのリスナー開始
    lucide.createIcons();
}

function loadData() {
    console.log("Connecting to Firebase...");

    // まずローカルのデータを一旦読み込んで表示（レスポンス改善）
    const savedFarms = localStorage.getItem('fm_farms');
    const savedFields = localStorage.getItem('fm_fields');
    const savedLogs = localStorage.getItem('fm_logs');
    if (savedFarms) state.farms = JSON.parse(savedFarms);
    if (savedFields) state.fields = JSON.parse(savedFields);
    if (savedLogs) state.logs = JSON.parse(savedLogs);
    renderAll();

    // 接続状態の監視
    db.ref('.info/connected').on('value', (snap) => {
        if (snap.val() === true) {
            console.log("Firebase Connected!");
        } else {
            console.log("Firebase Disconnected. Waiting...");
        }
    });

    // データのリアルタイム同期
    db.ref('farmData').on('value', (snapshot) => {
        const data = snapshot.val();
        if (data) {
            state.farms = data.farms || [];
            state.fields = data.fields || [];
            state.logs = data.logs || [];
            renderAll();
        } else {
            migrateLocalData();
        }
    }, (error) => {
        console.error("Firebase Sync Error:", error);
        alert("データベース同期に失敗しました。URL設定またはルールを確認してください。\n" + error.message);
    });
}

function migrateLocalData() {
    console.log("Migrating local data to cloud...");
    const savedFarms = localStorage.getItem('fm_farms');
    const savedFields = localStorage.getItem('fm_fields');
    const savedLogs = localStorage.getItem('fm_logs');

    if (savedFarms || savedFields || savedLogs) {
        state.farms = savedFarms ? JSON.parse(savedFarms) : [];
        state.fields = savedFields ? JSON.parse(savedFields) : [];
        state.logs = savedLogs ? JSON.parse(savedLogs) : [];

        // クラウドへ保存
        saveData();

        // 移行が完了したら、重複を防ぐためにLocalStorageを消去（任意）
        // localStorage.clear();
        console.log("Migration complete.");
    }
}

function saveData() {
    const dataToSave = {
        farms: state.farms,
        fields: state.fields,
        logs: state.logs
    };

    // Firebase（クラウド）へ保存
    db.ref('farmData').set(dataToSave).then(() => {
        console.log("Cloud Save Success");
    }).catch(err => {
        console.error("Firebase Save Error:", err);
        alert("クラウド保存失敗: " + err.message);
    });

    // バックアップ用 LocalStorage
    localStorage.setItem('fm_farms', JSON.stringify(state.farms));
    localStorage.setItem('fm_fields', JSON.stringify(state.fields));
    localStorage.setItem('fm_logs', JSON.stringify(state.logs));
}

function setupEventListeners() {
    // Nav Tabs - 階層下のアイコンなどのクリックも考慮
    document.body.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-view]');
        if (btn) {
            switchView(btn.dataset.view);
        }
    });

    // UI Toggle Logic - Left (Sidebar)
    document.getElementById('btn-sidebar-toggle').addEventListener('click', () => {
        const app = document.getElementById('app');
        app.classList.toggle('sidebar-minimized');
        const icon = document.querySelector('#btn-sidebar-toggle i');
        icon.setAttribute('data-lucide', app.classList.contains('sidebar-minimized') ? 'menu' : 'x');
        lucide.createIcons();
    });

    // UI Toggle Logic - Right (Tools/Map Controls)
    document.getElementById('btn-tools-toggle').addEventListener('click', () => {
        const app = document.getElementById('app');
        // 情報パネルが開いている場合はまず閉じる
        if (state.currentView) {
            switchView(null);
        }
        app.classList.toggle('tools-minimized');
        const icon = document.querySelector('#btn-tools-toggle i');
        if (icon) icon.setAttribute('data-lucide', app.classList.contains('tools-minimized') ? 'settings' : 'x');
        lucide.createIcons();
    });

    // Map Drawing
    document.getElementById('btn-draw').addEventListener('click', toggleDrawing);
    map.on('click', onMapClick);

    // Map Registration Button
    document.getElementById('btn-add-log-map').addEventListener('click', () => showModal('operation'));

    // Regular Registration Button
    document.getElementById('btn-add-log').addEventListener('click', () => showModal('operation'));

    document.querySelectorAll('.btn-close-modal').forEach(btn => btn.addEventListener('click', hideModal));
    document.getElementById('form-operation').addEventListener('submit', handleLogSubmit);

    // Export History button
    const btnExport = document.getElementById('btn-export-history');
    if (btnExport) btnExport.addEventListener('click', exportHistoryCSV);

    document.getElementById('btn-import-trigger').addEventListener('click', () => document.getElementById('input-geojson').click());
    document.getElementById('input-geojson').addEventListener('change', handleGeoJSONImport);
    document.getElementById('btn-confirm-import').addEventListener('click', confirmImport);

    document.getElementById('btn-locate').addEventListener('click', () => map.locate({ setView: true, maxZoom: 16 }));

    document.getElementById('btn-add-farm').addEventListener('click', () => {
        const name = prompt("農場名を入力してください:");
        if (name) {
            state.farms.push({ id: 'farm_' + Date.now(), name: name });
            saveData();
            renderFarmsList();
        }
    });

    document.getElementById('check-all-fields').addEventListener('change', (e) => {
        const checks = document.querySelectorAll('.field-check');
        checks.forEach(c => c.checked = e.target.checked);
        toggleBulkDeleteBtn();
    });

    document.getElementById('btn-bulk-delete').addEventListener('click', bulkDeleteFields);

    // Zoom Label Logic
    map.on('zoomend', () => {
        const mapEl = document.getElementById('map');
        if (map.getZoom() >= 17) {
            mapEl.classList.add('zoom-high');
        } else {
            mapEl.classList.remove('zoom-high');
        }
    });
}

function switchView(viewName) {
    const isAlreadyActive = state.currentView === viewName;
    const app = document.getElementById('app');
    const controls = document.querySelector('.map-controls');

    // すべてのパネルを一旦隠す
    document.querySelectorAll('.view:not(#view-map)').forEach(v => v.classList.remove('active'));
    document.querySelectorAll('[data-view]').forEach(btn => btn.classList.remove('active'));

    if (isAlreadyActive || !viewName) {
        state.currentView = null;
        // パネルを閉じる際はツールボタンを復活させる（最小化されていなければ）
        if (controls) controls.classList.remove('controls-hidden');
        // tools-minimized を戻すか検討（ユーザーが最後に閉じた状態を維持するのが望ましいが、一旦そのまま）
    } else {
        state.currentView = viewName;
        const targetView = document.getElementById(`view-${viewName}`);
        if (targetView) targetView.classList.add('active');
        document.querySelectorAll(`[data-view="${viewName}"]`).forEach(btn => btn.classList.add('active'));

        // 情報パネルを表示する際は、描画・インポートボタン一式（controls）を一時的に隠して重なりを防ぐ
        // ただし、右側の歯車ボタン自体の状態（tools-minimized）は変更しない
        if (controls) controls.classList.add('controls-hidden');

        // データ描画
        if (viewName === 'farms') renderFarmsList();
        else if (viewName === 'fields') renderFieldsList();
        else if (viewName === 'history') renderHistory();
    }

    setTimeout(() => map.invalidateSize(), 150);
    lucide.createIcons();
}

// Map Logic
function toggleDrawing() {
    state.isDrawing = !state.isDrawing;
    const btn = document.getElementById('btn-draw');
    if (state.isDrawing) {
        btn.classList.add('drawing');
        btn.querySelector('span').innerText = '完了';
        state.tempPoints = [];
    } else {
        btn.classList.remove('drawing');
        btn.querySelector('span').innerText = '描画開始';
        finishDrawing();
    }
}

function onMapClick(e) {
    // パネルが開いている場合は閉じる
    if (state.currentView) {
        switchView(state.currentView);
        return;
    }

    if (!state.isDrawing) return;
    const latlng = [e.latlng.lat, e.latlng.lng];
    state.tempPoints.push(latlng);
    if (state.tempPolygon) map.removeLayer(state.tempPolygon);
    state.tempPolygon = L.polygon(state.tempPoints, { color: '#f29f05' }).addTo(map);
}

function finishDrawing() {
    if (state.tempPoints.length < 3) {
        if (state.tempPolygon) map.removeLayer(state.tempPolygon);
        return;
    }

    const name = prompt("圃場の名前を入力してください:");
    if (!name) {
        if (state.tempPolygon) map.removeLayer(state.tempPolygon);
        return;
    }
    const crop = prompt("植え付け作物を入力してください (例: コシヒカリ):") || '未設定';

    const farmId = state.farms.length > 0 ? state.farms[0].id : null;
    const area = calculateArea(state.tempPoints);

    const newField = {
        id: 'f_' + Date.now(),
        name: name,
        crop: crop,
        area: area,
        farmId: farmId,
        polygon: state.tempPoints,
        color: '#4c8c4a'
    };
    state.fields.push(newField);
    saveData();
    renderAll();

    if (state.tempPolygon) {
        map.removeLayer(state.tempPolygon);
        state.tempPolygon = null;
    }
}

function calculateArea(latlngs) {
    if (latlngs.length < 3) return 0;
    let area = 0;
    const R = 6378137;
    const points = latlngs.map(ll => {
        const x = R * ll[1] * Math.PI / 180 * Math.cos(latlngs[0][0] * Math.PI / 180);
        const y = R * ll[0] * Math.PI / 180;
        return { x, y };
    });
    for (let i = 0; i < points.length; i++) {
        const j = (i + 1) % points.length;
        area += points[i].x * points[j].y;
        area -= points[j].x * points[i].y;
    }
    const m2 = Math.abs(area) / 2;
    return Math.round((m2 / 100) * 10) / 10;
}

function renderFieldsOnMap() {
    map.eachLayer(layer => {
        if (layer instanceof L.Polygon && layer !== state.tempPolygon) map.removeLayer(layer);
    });

    state.fields.forEach(field => {
        const poly = L.polygon(field.polygon, {
            color: field.color,
            fillOpacity: 0.4,
            weight: 2
        }).addTo(map);

        const labelContent = `
            <div class="field-label-wrapper">
                <div class="label-name">${field.name}</div>
                <div class="label-crop">${field.crop || '未設定'}</div>
            </div>
        `;
        poly.bindTooltip(labelContent, { permanent: true, direction: 'center', className: 'field-label' });

        const popupContent = `
            <div class="map-popup">
                <h3>${field.name}</h3>
                <p><strong>面積:</strong> ${field.area} a</p>
                <p><strong>作物:</strong> ${field.crop}</p>
                <p><strong>所属:</strong> ${state.farms.find(f => f.id === field.farmId)?.name || '未割当'}</p>
                <button class="btn-primary" style="padding: 0.3rem 0.6rem; margin-top: 0.5rem; width: 100%; font-size: 0.8rem;" onclick="openLogModalForField('${field.id}')">
                    <i data-lucide="plus-circle" style="width:12px"></i> 作業登録
                </button>
            </div>
        `;
        poly.bindPopup(popupContent);
        poly.on('popupopen', () => lucide.createIcons());
    });
    updateFieldSelects();
}

function openLogModalForField(fieldId) {
    showModal('operation');
    document.getElementById('select-field').value = fieldId;
}

function updateFieldSelects() {
    const select = document.getElementById('select-field');
    const currentVal = select.value;
    select.innerHTML = '<option value="">選択してください</option>';
    state.fields.forEach(f => {
        const opt = document.createElement('option');
        opt.value = f.id;
        opt.innerText = f.name;
        select.appendChild(opt);
    });
    if (state.fields.find(f => f.id === currentVal)) {
        select.value = currentVal;
    }
}

// Import
function handleGeoJSONImport(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
        try {
            state.pendingGeoJSON = JSON.parse(event.target.result);
            updateImportFarmSelect();
            showModal('import');
            e.target.value = '';
        } catch (err) { alert('不正なファイル形式です。'); }
    };
    reader.readAsText(file);
}

function updateImportFarmSelect() {
    const select = document.getElementById('select-import-farm');
    if (!select) return;
    select.innerHTML = '';
    state.farms.forEach(f => {
        const opt = document.createElement('option');
        opt.value = f.id;
        opt.innerText = f.name;
        select.appendChild(opt);
    });
}

function confirmImport() {
    if (!state.pendingGeoJSON) return;
    const farmId = document.getElementById('select-import-farm').value;
    processGeoJSON(state.pendingGeoJSON, farmId);
    state.pendingGeoJSON = null;
    hideModal();
}

function processGeoJSON(data, farmId) {
    const features = data.type === 'FeatureCollection' ? data.features : [data];
    features.forEach(feature => {
        if (feature.geometry && (feature.geometry.type === 'Polygon' || feature.geometry.type === 'MultiPolygon')) {
            const coords = feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry.coordinates;
            coords.forEach(polygonCoords => {
                const leafletCoords = polygonCoords[0].map(coord => [coord[1], coord[0]]);
                const name = feature.properties?.name || feature.properties?.label || `インポート ${state.fields.length + 1}`;
                const jsonArea = feature.properties?.area;
                const jsonCrop = feature.properties?.crop;
                const area = (jsonArea !== undefined && jsonArea !== null) ? jsonArea : calculateArea(leafletCoords);
                const crop = jsonCrop || '未設定';

                const newField = {
                    id: 'f_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
                    name: name,
                    farmId: farmId,
                    crop: crop,
                    area: area,
                    polygon: leafletCoords,
                    color: '#4c8c4a'
                };
                state.fields.push(newField);
            });
        }
    });
    saveData();
    renderAll();
}

// List Rendering
function renderFieldsList() {
    const body = document.getElementById('fields-body');
    if (!body) return;
    body.innerHTML = '';
    state.fields.forEach(field => {
        const farmName = state.farms.find(f => f.id === field.farmId)?.name || '未割当';
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><input type="checkbox" class="field-check" data-id="${field.id}"></td>
            <td>${field.name}</td>
            <td class="hide-mobile">${farmName}</td>
            <td>${field.area || 0}</td>
            <td>${field.crop || '-'}</td>
            <td class="table-actions">
                <button title="削除" onclick="deleteField('${field.id}')"><i data-lucide="trash-2" style="width:14px"></i></button>
            </td>
        `;
        body.appendChild(tr);
    });
    document.querySelectorAll('.field-check').forEach(c => c.addEventListener('change', toggleBulkDeleteBtn));
    lucide.createIcons();
}

function toggleBulkDeleteBtn() {
    const checked = document.querySelectorAll('.field-check:checked');
    const btn = document.getElementById('btn-bulk-delete');
    if (checked.length > 0) {
        btn.classList.remove('hidden');
        btn.innerHTML = `<i data-lucide="trash-2"></i> ${checked.length} 件削除`;
        lucide.createIcons();
    } else {
        btn.classList.add('hidden');
    }
}

function bulkDeleteFields() {
    const checked = document.querySelectorAll('.field-check:checked');
    if (!confirm(`${checked.length} 件の圃場を削除しますか？`)) return;
    const idsToDelete = Array.from(checked).map(c => c.dataset.id);
    state.fields = state.fields.filter(f => !idsToDelete.includes(f.id));
    saveData();
    renderAll();
    document.getElementById('check-all-fields').checked = false;
    toggleBulkDeleteBtn();
}

function deleteField(id) {
    if (!confirm('削除しますか？')) return;
    state.fields = state.fields.filter(f => f.id !== id);
    saveData();
    renderAll();
}

function renderFarmsList() {
    const body = document.getElementById('farms-body');
    if (!body) return;
    body.innerHTML = '';
    state.farms.forEach(farm => {
        const count = state.fields.filter(f => f.farmId === farm.id).length;
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td class="clickable-farm" onclick="focusOnFarm('${farm.id}')">
                <i data-lucide="map-pin" style="width:14px; margin-right:5px;"></i>${farm.name}
            </td>
            <td>${count}</td>
            <td class="table-actions">
                <button title="名前変更" onclick="renameFarm('${farm.id}')"><i data-lucide="edit-3"></i></button>
                <button class="btn-delete" title="削除" onclick="deleteFarm('${farm.id}')"><i data-lucide="trash-2"></i></button>
            </td>
        `;
        body.appendChild(tr);
    });
    lucide.createIcons();
}

function focusOnFarm(farmId) {
    const farmFields = state.fields.filter(f => f.farmId === farmId);
    if (farmFields.length === 0) {
        alert('この農場には登録された圃場がありません。');
        return;
    }
    const bounds = L.latLngBounds();
    farmFields.forEach(field => {
        field.polygon.forEach(coord => bounds.extend(coord));
    });
    // 農場全体が見えるようにフォーカスした後、UIを閉じて地図を見やすくする
    document.getElementById('app').classList.add('sidebar-minimized');
    const sidebarIcon = document.querySelector('#btn-sidebar-toggle i');
    if (sidebarIcon) sidebarIcon.setAttribute('data-lucide', 'menu');

    switchView(null); // パネルを閉じる

    // 少し余白を持たせてズーム
    map.fitBounds(bounds, { padding: [80, 80], maxZoom: 17 });
    lucide.createIcons();
}

function deleteFarm(id) {
    if (!confirm('この農場を削除しますか？所属する圃場は「未割当」になります。')) return;
    state.farms = state.farms.filter(f => f.id !== id);
    state.fields = state.fields.map(f => { if (f.farmId === id) f.farmId = null; return f; });
    saveData();
    renderAll();
}

function renameFarm(id) {
    const farm = state.farms.find(f => f.id === id);
    if (!farm) return;
    const newName = prompt("新しい農場名を入力してください:", farm.name);
    if (newName && newName !== farm.name) {
        farm.name = newName;
        saveData();
        renderAll();
    }
}

function renderHistory() {
    const body = document.getElementById('history-body');
    if (!body) return;
    body.innerHTML = '';
    state.logs.forEach(log => {
        const fieldName = state.fields.find(f => f.id === log.fieldId)?.name || '不明';
        const tr = document.createElement('tr');
        let mediaHtml = '-';
        if (log.media) {
            if (log.media.type.startsWith('image/')) {
                mediaHtml = `<img src="${log.media.url}" class="history-media-thumb" onclick="window.open('${log.media.url}')">`;
            } else if (log.media.type.startsWith('video/')) {
                mediaHtml = `<video src="${log.media.url}" class="history-media-thumb" onclick="window.open('${log.media.url}')"></video>`;
            }
        }
        tr.innerHTML = `
            <td>${log.date}</td>
            <td>${fieldName}</td>
            <td>${log.type}<br><small>(${log.crop || '未設定'})</small></td>
            <td>${log.worker}</td>
            <td>${mediaHtml}</td>
            <td>${log.notes}</td>
        `;
        body.appendChild(tr);
    });
}

function showModal(type) {
    document.getElementById('modal-overlay').classList.remove('hidden');
    document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden'));
    document.getElementById(`modal-${type}`).classList.remove('hidden');
}

function hideModal() { document.getElementById('modal-overlay').classList.add('hidden'); }

async function handleLogSubmit(e) {
    e.preventDefault();
    let mediaData = null;
    const mediaFile = document.getElementById('input-media').files[0];
    if (mediaFile) {
        mediaData = await new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = (event) => resolve({
                url: event.target.result,
                type: mediaFile.type
            });
            reader.readAsDataURL(mediaFile);
        });
    }
    const newLog = {
        id: 'l_' + Date.now(),
        date: document.getElementById('input-date').value,
        fieldId: document.getElementById('select-field').value,
        type: document.getElementById('select-type').value,
        worker: document.getElementById('input-worker').value,
        crop: document.getElementById('select-crop-target').value,
        media: mediaData,
        notes: document.getElementById('input-notes').value
    };
    state.logs.push(newLog);
    saveData();
    hideModal();
    renderAll();
    showToast('作業を正常に登録しました');
    e.target.reset();
}

function renderAll() {
    renderFieldsOnMap();
    renderHistory();
    renderFieldsList();
    renderFarmsList();
    lucide.createIcons(); // アイコンを確実に表示
}

function showToast(message) {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `<i data-lucide="check-circle"></i> ${message}`;
    container.appendChild(toast);
    lucide.createIcons();

    setTimeout(() => {
        toast.remove();
    }, 3500);
}

function exportHistoryCSV() {
    if (state.logs.length === 0) {
        alert('出力するデータがありません。');
        return;
    }

    const headers = ['日付', '農場', '圃場', '作業内容', '作業者', '対象作物', 'メモ'];
    const rows = state.logs.map(log => {
        const field = state.fields.find(f => f.id === log.fieldId);
        const farm = field ? state.farms.find(f => f.id === field.farmId) : null;
        return [
            log.date,
            farm ? farm.name : '未割当',
            field ? field.name : '不明',
            log.type,
            log.worker,
            log.crop || '未設定',
            log.notes.replace(/\n/g, ' ') // 改行をスペースに置換
        ];
    });

    // CSV文字列の生成 (BOM付きでExcel対応)
    const csvContent = "\uFEFF" + [headers, ...rows].map(e => e.map(String).map(s => `"${s.replace(/"/g, '""')}"`).join(",")).join("\n");

    // ダウンロード
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `作業履歴_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

init();
