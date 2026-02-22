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
    pendingGeoJSON: null,
    hasInitialFocus: false, // 初回起動時のフォーカス管理
    sortConfig: { key: 'date', direction: 'desc' }, // 履歴のソート設定
    crops: [], // 作物リスト
    taskTypes: [] // 作業内容リスト
};

// Initialize Map
const map = L.map('map', {
    zoomControl: false,
    maxZoom: 22 // 地図全体の最大ズームレベルを引き上げ
}).setView([35.6895, 139.6917], 15);

const googleSatellite = L.tileLayer('https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', {
    attribution: '&copy; Google',
    maxNativeZoom: 20, // Googleが提供する画像の最大ズーム
    maxZoom: 22        // それ以上にズームした場合は画像を拡大して表示
});

googleSatellite.addTo(map);

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
            state.crops = data.crops || ["コシヒカリ", "つや姫", "新之助", "あきたこまち"];
            state.taskTypes = data.taskTypes || ["播種", "田植え", "施肥", "防除", "収穫"];
            renderAll();

            // 初回読み込み時のみ、一番上の農場へ自動ズーム
            if (!state.hasInitialFocus && state.farms.length > 0) {
                state.hasInitialFocus = true;
                autoFocusFirstFarm();
            }
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
        logs: state.logs,
        crops: state.crops,
        taskTypes: state.taskTypes
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

    // History Sorting Listeners
    document.querySelectorAll('#history-table th.sortable').forEach(th => {
        th.addEventListener('click', () => {
            const key = th.dataset.sort;
            const direction = (state.sortConfig.key === key && state.sortConfig.direction === 'asc') ? 'desc' : 'asc';
            state.sortConfig = { key, direction };
            renderHistory();
        });
    });

    document.getElementById('btn-add-farm').addEventListener('click', () => {
        const name = prompt("農場名を入力してください:");
        if (name) {
            state.farms.push({ id: 'farm_' + Date.now(), name: name });
            saveData();
            renderFarmsList();
        }
    });

    document.getElementById('select-crop-target').addEventListener('change', (e) => {
        const val = e.target.value;
        if (val === '__add__') {
            const name = prompt("追加する作物の名前を入力してください:");
            if (name && !state.crops.includes(name)) {
                state.crops.push(name);
                saveData();
                updateCropSelects();
                e.target.value = name;
            } else {
                e.target.value = "未設定";
            }
        } else if (val === '__remove__') {
            const target = prompt("削除する作物の名前を確認のため正確に入力してください:\n(登録済みの履歴には影響しません)");
            if (target && state.crops.includes(target)) {
                state.crops = state.crops.filter(c => c !== target);
                saveData();
                updateCropSelects();
            }
            e.target.value = "未設定";
        }
    });

    document.getElementById('select-type').addEventListener('change', (e) => {
        const val = e.target.value;
        if (val === '__add__') {
            const name = prompt("追加する作業内容の名前を入力してください:");
            if (name && !state.taskTypes.includes(name)) {
                state.taskTypes.push(name);
                saveData();
                updateTaskTypeSelects();
                e.target.value = name;
            } else {
                updateTaskTypeSelects();
            }
        } else if (val === '__remove__') {
            const target = prompt("削除する作業内容の名前を確認のため正確に入力してください:\n(登録済みの履歴には影響しません)");
            if (target && state.taskTypes.includes(target)) {
                state.taskTypes = state.taskTypes.filter(t => t !== target);
                saveData();
                updateTaskTypeSelects();
            } else {
                updateTaskTypeSelects();
            }
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

    let farmId = null;
    if (state.farms.length > 0) {
        const farmList = state.farms.map((f, i) => `${i + 1}: ${f.name}`).join('\n');
        const farmIndex = prompt(`所属させる農場を番号で選んでください:\n${farmList}\n(キャンセルで未割当)`, "1");
        if (farmIndex && state.farms[farmIndex - 1]) {
            farmId = state.farms[farmIndex - 1].id;
        }
    }

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

        const fieldLogs = state.logs.filter(l => l.fieldId === field.id);
        const lastLog = fieldLogs.length > 0 ? fieldLogs.sort((a, b) => new Date(b.date) - new Date(a.date))[0] : null;
        const lastLogHtml = lastLog ? `<p><strong>最終作業:</strong> ${lastLog.date} (${lastLog.type})</p>` : '<p><strong>最終作業:</strong> なし</p>';

        const popupContent = `
            <div class="map-popup">
                <h3>${field.name}</h3>
                <p><strong>面積:</strong> ${field.area} a</p>
                <p><strong>作物:</strong> ${field.crop}</p>
                <p><strong>所属:</strong> ${state.farms.find(f => f.id === field.farmId)?.name || '未割当'}</p>
                ${lastLogHtml}
                <div style="display: flex; flex-wrap: wrap; gap: 5px; margin-top: 0.5rem;">
                    <button class="btn-primary" style="flex: 1 1 100%; padding: 0.3rem; font-size: 0.8rem;" onclick="openLogModalForField('${field.id}')">
                        <i data-lucide="plus-circle" style="width:12px"></i> 作業登録
                    </button>
                    <button class="btn-secondary" style="flex: 1; padding: 0.3rem; font-size: 0.8rem;" onclick="editFieldCrop('${field.id}')">
                        <i data-lucide="edit-3" style="width:12px"></i> 作物変更
                    </button>
                    <button class="btn-secondary" style="flex: 1; padding: 0.3rem; font-size: 0.8rem;" onclick="editFieldFarm('${field.id}')">
                        <i data-lucide="map-pin" style="width:12px"></i> 農場変更
                    </button>
                </div>
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

function updateCropSelects() {
    const select = document.getElementById('select-crop-target');
    if (!select) return;
    const currentVal = select.value;
    select.innerHTML = '<option value="未設定">未設定</option>';

    state.crops.forEach(crop => {
        const opt = document.createElement('option');
        opt.value = crop;
        opt.innerText = crop;
        select.appendChild(opt);
    });

    // 管理用特殊アクション
    select.innerHTML += `
        <option value="" disabled>──────────</option>
        <option value="__add__">+ 新しい作物を追加</option>
        <option value="__remove__">× 作物を削除</option>
    `;

    if (state.crops.includes(currentVal) || currentVal === "未設定") {
        select.value = currentVal;
    }
}

function updateTaskTypeSelects() {
    const select = document.getElementById('select-type');
    if (!select) return;
    const currentVal = select.value;
    select.innerHTML = '';

    state.taskTypes.forEach(type => {
        const opt = document.createElement('option');
        opt.value = type;
        opt.innerText = type;
        select.appendChild(opt);
    });

    // その他を追加（なければ）
    if (!state.taskTypes.includes("その他")) {
        const opt = document.createElement('option');
        opt.value = "その他";
        opt.innerText = "その他";
        select.appendChild(opt);
    }

    // 管理用特殊アクション
    select.innerHTML += `
        <option value="" disabled>──────────</option>
        <option value="__add__">+ 新しい作業内容を追加</option>
        <option value="__remove__">× 作業内容を削除</option>
    `;

    if (state.taskTypes.includes(currentVal) || currentVal === "その他") {
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
            <td class="hide-mobile editable-cell" onclick="editFieldFarm('${field.id}')">
                ${farmName} <i data-lucide="edit-2" style="width:10px; opacity:0.5"></i>
            </td>
            <td>${field.area || 0}</td>
            <td class="editable-cell" onclick="editFieldCrop('${field.id}')">
                ${field.crop || '-'} <i data-lucide="edit-2" style="width:10px; opacity:0.5"></i>
            </td>
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

function editFieldCrop(id) {
    const field = state.fields.find(f => f.id === id);
    if (!field) return;
    const newCrop = prompt(`「${field.name}」の作物を入力してください:`, field.crop);
    if (newCrop !== null) {
        field.crop = newCrop || '未設定';
        saveData();
        renderAll();
        showToast('作物を更新しました');
    }
}

function editFieldFarm(id) {
    const field = state.fields.find(f => f.id === id);
    if (!field) return;

    if (state.farms.length === 0) {
        alert("先に農場を登録してください。");
        return;
    }

    const farmList = state.farms.map((f, i) => `${i + 1}: ${f.name}`).join('\n');
    const farmIndex = prompt(`「${field.name}」を移動させる農場を番号で選んでください:\n${farmList}\n(キャンセルで変更なし)`, "1");

    if (farmIndex && state.farms[farmIndex - 1]) {
        field.farmId = state.farms[farmIndex - 1].id;
        saveData();
        renderAll();
        showToast('所属農場を更新しました');
    }
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
    map.fitBounds(bounds, { padding: [80, 80], maxZoom: 19 }); // 17 -> 19 へ引き上げ
    lucide.createIcons();
}

function autoFocusFirstFarm() {
    if (state.farms.length > 0) {
        const firstFarm = state.farms[0];
        const farmFields = state.fields.filter(f => f.farmId === firstFarm.id);
        if (farmFields.length > 0) {
            const bounds = L.latLngBounds();
            farmFields.forEach(field => {
                field.polygon.forEach(coord => bounds.extend(coord));
            });
            map.fitBounds(bounds, { padding: [80, 80], maxZoom: 19 }); // 17 -> 19 へ引き上げ
        }
    }
}

function deleteFarm(id) {
    if (!confirm('この農場を削除しますか？\n所属するすべての圃場も一緒に削除されます。')) return;
    state.farms = state.farms.filter(f => f.id !== id);
    state.fields = state.fields.filter(f => f.farmId !== id);
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

    // ソート処理
    const sortedLogs = [...state.logs].sort((a, b) => {
        let valA = a[state.sortConfig.key] || '';
        let valB = b[state.sortConfig.key] || '';

        // 圃場名でのソートの場合はIDではなく名前で比較
        if (state.sortConfig.key === 'fieldId') {
            valA = state.fields.find(f => f.id === a.fieldId)?.name || '';
            valB = state.fields.find(f => f.id === b.fieldId)?.name || '';
        }

        if (valA < valB) return state.sortConfig.direction === 'asc' ? -1 : 1;
        if (valA > valB) return state.sortConfig.direction === 'asc' ? 1 : -1;
        return 0;
    });

    updateSortIcons();

    sortedLogs.forEach(log => {
        const fieldName = state.fields.find(f => f.id === log.fieldId)?.name || '不明';
        const tr = document.createElement('tr');

        let mediaHtml = '-';
        // media または mediaList (複数) を考慮
        const mediaList = log.mediaList || (log.media ? [log.media] : []);

        if (mediaList.length > 0) {
            mediaHtml = `<div class="media-list-container">`;
            mediaList.forEach(m => {
                if (m.type.startsWith('image/')) {
                    mediaHtml += `<img src="${m.url}" class="history-media-thumb" onclick="window.open('${m.url}')">`;
                } else if (m.type.startsWith('video/')) {
                    mediaHtml += `<video src="${m.url}" class="history-media-thumb" onclick="window.open('${m.url}')"></video>`;
                }
            });
            mediaHtml += `</div>`;
        }

        tr.innerHTML = `
            <td>${log.date}</td>
            <td>${fieldName}</td>
            <td>${log.crop || '未設定'}</td>
            <td>${log.type}</td>
            <td>${log.notes}</td>
            <td>${mediaHtml}</td>
            <td>${log.worker}</td>
        `;
        body.appendChild(tr);
    });
}

function updateSortIcons() {
    document.querySelectorAll('#history-table th.sortable').forEach(th => {
        th.classList.remove('active-sort');
        const icon = th.querySelector('.sort-icon');
        if (!icon) return;

        if (th.dataset.sort === state.sortConfig.key) {
            th.classList.add('active-sort');
            icon.setAttribute('data-lucide', state.sortConfig.direction === 'asc' ? 'chevron-up' : 'chevron-down');
        } else {
            icon.setAttribute('data-lucide', 'chevrons-up-down');
        }
    });
    lucide.createIcons();
}

function showModal(type) {
    document.getElementById('modal-overlay').classList.remove('hidden');
    document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden'));
    document.getElementById(`modal-${type}`).classList.remove('hidden');
}

function hideModal() { document.getElementById('modal-overlay').classList.add('hidden'); }

async function handleLogSubmit(e) {
    e.preventDefault();
    let mediaList = [];
    const mediaFiles = document.getElementById('input-media').files;

    if (mediaFiles.length > 0) {
        const promises = Array.from(mediaFiles).map(file => {
            return new Promise((resolve) => {
                const reader = new FileReader();
                reader.onload = (event) => resolve({
                    url: event.target.result,
                    type: file.type
                });
                reader.readAsDataURL(file);
            });
        });
        mediaList = await Promise.all(promises);
    }

    const newLog = {
        id: 'l_' + Date.now(),
        date: document.getElementById('input-date').value,
        fieldId: document.getElementById('select-field').value,
        type: document.getElementById('select-type').value,
        worker: document.getElementById('input-worker').value,
        crop: document.getElementById('select-crop-target').value,
        mediaList: mediaList,
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
    updateCropSelects(); // 作物リストを更新
    updateTaskTypeSelects(); // 作業内容リストを更新
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

    const headers = ['日付', '農場', '圃場', '対象作物', '作業内容', 'メモ', '作業者'];
    const rows = state.logs.map(log => {
        const field = state.fields.find(f => f.id === log.fieldId);
        const farm = field ? state.farms.find(f => f.id === field.farmId) : null;
        return [
            log.date,
            farm ? farm.name : '未割当',
            field ? field.name : '不明',
            log.crop || '未設定',
            log.type,
            log.notes.replace(/\n/g, ' '), // 改行をスペースに置換
            log.worker
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
