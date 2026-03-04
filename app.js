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
const auth = firebase.auth();

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
    crops: [], // 作物リスト: [{name, color}, ...]
    taskTypes: [], // 作業内容リスト
    tasks: [], // ToDoタスクリスト: [{id, text, completed, createdAt}]
    staleViews: { farms: true, fields: true, history: true, tasks: true } // レンダリングが必要なViewを追跡
};

const CROP_COLORS = [
    '#4c8c4a', // 緑
    '#f29f05', // オレンジ
    '#2d5a27', // 深緑
    '#d94d4d', // 赤
    '#4d79d9', // 青
    '#9c4dd9', // 紫
    '#d94d9c', // ピンク
    '#79d94d', // 黄緑
    '#4dd9d9', // 水色
    '#8b4513'  // 茶色
];

const CROP_COLOR_LABELS = [
    "1: 緑", "2: オレンジ", "3: 深緑", "4: 赤", "5: 青",
    "6: 紫", "7: ピンク", "8: 黄緑", "9: 水色", "10: 茶色"
];

function getCropColor(cropName) {
    if (!cropName || cropName === '未設定') return '#FFFEF6';
    const cleanName = cropName.trim();
    const cropObj = state.crops.find(c => c.name.trim() === cleanName);
    if (cropObj && cropObj.color) return cropObj.color;

    // 見つからない場合は名前からハッシュで色を決定
    let hash = 0;
    for (let i = 0; i < cleanName.length; i++) {
        hash = cleanName.charCodeAt(i) + ((hash << 5) - hash);
    }
    return CROP_COLORS[Math.abs(hash) % CROP_COLORS.length];
}

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
    auth.onAuthStateChanged((user) => {
        if (user) {
            hideModal();
            startDataSync();
        } else {
            showModal('login');
        }
    });
}

function startDataSync() {
    console.log("Connecting to Firebase...");

    // まずローカルのデータを一旦読み込んで表示（レスポンス改善）
    const savedFarms = localStorage.getItem('fm_farms');
    const savedFields = localStorage.getItem('fm_fields');
    const savedLogs = localStorage.getItem('fm_logs');
    const savedCrops = localStorage.getItem('fm_crops');
    const savedTaskTypes = localStorage.getItem('fm_task_types');

    if (savedFarms) state.farms = JSON.parse(savedFarms);
    if (savedFields) state.fields = JSON.parse(savedFields);
    if (savedLogs) state.logs = JSON.parse(savedLogs);
    if (savedCrops) state.crops = JSON.parse(savedCrops);
    if (savedTaskTypes) state.taskTypes = JSON.parse(savedTaskTypes);
    if (localStorage.getItem('fm_tasks')) state.tasks = JSON.parse(localStorage.getItem('fm_tasks'));

    renderAll();

    // ローカルデータがある場合は即座にフォーカス（Firebaseを待たずに表示）
    if (!state.hasInitialFocus && state.farms.length > 0) {
        state.hasInitialFocus = true;
        autoFocusFirstFarm();
    }

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

            // 作物リストをオブジェクト形式に正規化
            const rawCrops = data.crops || ["コシヒカリ", "つや姫", "新之助", "あきたこまち"];
            state.crops = rawCrops.map((c, i) => {
                if (typeof c === 'string') {
                    return { name: c, color: CROP_COLORS[i % CROP_COLORS.length] };
                }
                return c;
            });

            state.taskTypes = data.taskTypes || ["播種", "田植え", "施肥", "防除", "収穫"];
            state.tasks = data.tasks || [];
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
        taskTypes: state.taskTypes,
        tasks: state.tasks
    };

    // Firebase（クラウド）へ保存
    const cloudPromise = db.ref('farmData').set(dataToSave).then(() => {
        console.log("Cloud Save Success");
    }).catch(err => {
        console.error("Firebase Save Error:", err);
        alert("クラウド保存失敗: " + err.message);
    });

    // バックアップ用 LocalStorage
    localStorage.setItem('fm_farms', JSON.stringify(state.farms));
    localStorage.setItem('fm_fields', JSON.stringify(state.fields));
    localStorage.setItem('fm_logs', JSON.stringify(state.logs));
    localStorage.setItem('fm_crops', JSON.stringify(state.crops));
    localStorage.setItem('fm_task_types', JSON.stringify(state.taskTypes));
    localStorage.setItem('fm_tasks', JSON.stringify(state.tasks));

    return cloudPromise;
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

    document.getElementById('btn-logout').addEventListener('click', handleLogout);
    document.getElementById('form-login').addEventListener('submit', handleLogin);
    document.getElementById('btn-do-register').addEventListener('click', handleRegister);

    document.querySelectorAll('.btn-close-modal').forEach(btn => btn.addEventListener('click', hideModal));
    document.getElementById('form-operation').addEventListener('submit', handleLogSubmit);

    // Export History buttons
    const btnExport = document.getElementById('btn-export-history');
    if (btnExport) btnExport.addEventListener('click', exportHistoryCSV);

    const btnReport = document.getElementById('btn-export-report');
    if (btnReport) btnReport.addEventListener('click', exportHistoryReport);

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
            showToast('農場を追加しました');
        }
    });

    document.getElementById('select-crop-target').addEventListener('change', (e) => {
        const val = e.target.value;
        if (val === '__add__') {
            const name = prompt("追加する作物の名前を入力してください:");
            if (name && !state.crops.some(c => c.name === name)) {
                const guide = CROP_COLOR_LABELS.join('\n');
                const userInput = prompt(`作物の色を番号（1-10）で選ぶか、カラーコード（例: #FF00FF）を入力してください:\n${guide}`, "1");

                let color;
                if (userInput && userInput.startsWith('#')) {
                    color = userInput; // 直接指定
                } else {
                    const idx = parseInt(userInput) - 1;
                    color = CROP_COLORS[idx % CROP_COLORS.length] || CROP_COLORS[0];
                }

                state.crops.push({ name: name, color: color });
                saveData();
                updateCropSelects();
                e.target.value = name;
                renderAll();
            } else {
                e.target.value = "未設定";
            }
        } else if (val === '__remove__') {
            const target = prompt("削除する作物の名前を確認のため正確に入力してください:\n(登録済みの履歴には影響しません)");
            if (target && state.crops.some(c => c.name === target)) {
                state.crops = state.crops.filter(c => c.name !== target);
                saveData();
                updateCropSelects();
                renderAll();
            }
            e.target.value = "未設定";
        } else if (val === '__edit_color__') {
            const cropList = state.crops.map((c, i) => `${i + 1}: ${c.name}`).join('\n');
            const cropIdx = prompt(`色を変更する作物を選んでください:\n${cropList}`);
            const selectedCrop = state.crops[parseInt(cropIdx) - 1];

            if (selectedCrop) {
                const guide = CROP_COLOR_LABELS.join('\n');
                const userInput = prompt(`「${selectedCrop.name}」の新しい色を番号（1-10）で選ぶか、カラーコード（例: #FF00FF）を入力してください:\n${guide}`, "1");

                let color;
                if (userInput && userInput.startsWith('#')) {
                    color = userInput;
                } else {
                    const idx = parseInt(userInput) - 1;
                    color = CROP_COLORS[idx % CROP_COLORS.length] || CROP_COLORS[0];
                }

                selectedCrop.color = color;
                saveData();
                renderAll();
                showToast(`${selectedCrop.name}の色を更新しました`);
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

        // データが古い（stale）場合、または表示切り替え時に最新化する
        if (state.staleViews[viewName] || isAlreadyActive === false) {
            if (viewName === 'farms') renderFarmsList();
            else if (viewName === 'fields') renderFieldsList();
            else if (viewName === 'history') renderHistory();
            else if (viewName === 'tasks') renderTasks();
            state.staleViews[viewName] = false;
        }
    }

    setTimeout(() => {
        map.invalidateSize();
        lucide.createIcons();
    }, 150);
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
        color: '#FFFEF6'
    };
    state.fields.push(newField);
    saveData();
    renderAll();
    showToast('圃場を登録しました');

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
        const cropColor = getCropColor(field.crop);
        const poly = L.polygon(field.polygon, {
            color: cropColor,
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
        opt.value = crop.name;
        opt.innerText = crop.name;
        select.appendChild(opt);
    });

    // 管理用特殊アクション
    select.innerHTML += `
        <option value="" disabled>──────────</option>
        <option value="__add__">+ 新しい作物を追加</option>
        <option value="__edit_color__">🎨 作物の色を変更</option>
        <option value="__remove__">× 作物を削除</option>
    `;

    if (state.crops.some(c => c.name === currentVal) || currentVal === "未設定") {
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
    if (state.currentView !== 'fields') {
        state.staleViews.fields = true;
        return;
    }
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

    const cropList = state.crops.map(c => c.name).join(', ');
    const newCrop = prompt(`「${field.name}」の作物を入力してください:\n(登録済み: ${cropList})`, field.crop);

    if (newCrop !== null) {
        const cleanCrop = newCrop.trim() || '未設定';
        field.crop = cleanCrop;

        // もし新しい作物名なら、自動的に作物リストに追加（色は自動割当）
        if (cleanCrop !== '未設定' && !state.crops.some(c => c.name === cleanCrop)) {
            state.crops.push({
                name: cleanCrop,
                color: CROP_COLORS[state.crops.length % CROP_COLORS.length]
            });
        }

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
    if (state.currentView !== 'farms') {
        state.staleViews.farms = true;
        return;
    }
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
    // 圃場が登録されている最初の農場を探す
    const farmWithFields = state.farms.find(farm =>
        state.fields.some(field => field.farmId === farm.id)
    );

    // もし圃場付きの農場が見つかればそこにズーム、なければ単純に最初の農場の圃場（あれば）を探す
    const targetFarm = farmWithFields || (state.farms.length > 0 ? state.farms[0] : null);

    if (targetFarm) {
        const farmFields = state.fields.filter(f => f.farmId === targetFarm.id);
        if (farmFields.length > 0) {
            const bounds = L.latLngBounds();
            farmFields.forEach(field => {
                field.polygon.forEach(coord => bounds.extend(coord));
            });
            map.fitBounds(bounds, { padding: [80, 80], maxZoom: 19 });
        }
    }
}

function deleteFarm(id) {
    if (!confirm('この農場を削除しますか？\n所属するすべての圃場も一緒に削除されます。')) return;
    state.farms = state.farms.filter(f => f.id !== id);
    state.fields = state.fields.filter(f => f.farmId !== id);
    saveData();
    renderAll();
    showToast('農場を削除しました');
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
    if (state.currentView !== 'history') {
        state.staleViews.history = true;
        return;
    }
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
    showToast('作業を登録しました');
    e.target.reset();
}

function renderAll() {
    // 地図は常に最新の状態を保つ
    renderFieldsOnMap();

    // 全てのViewを「古い(stale)」とマークし、現在アクティブなViewのみ即座に描画する
    const views = ['farms', 'fields', 'history', 'tasks'];
    views.forEach(v => {
        if (state.currentView === v) {
            if (v === 'farms') renderFarmsList();
            if (v === 'fields') renderFieldsList();
            if (v === 'history') renderHistory();
            if (v === 'tasks') renderTasks();
            state.staleViews[v] = false;
        } else {
            state.staleViews[v] = true;
        }
    });

    updateCropSelects();
    updateTaskTypeSelects();

    // アイコン生成を一括で行う
    lucide.createIcons();
}

/**
 * ToDoタスク関連の関数
 */
function addTodoTask(text) {
    const newTodo = {
        id: 't_' + Date.now(),
        text: text,
        completed: false,
        createdAt: new Date().toISOString()
    };
    state.tasks.unshift(newTodo);
    saveData();
    renderTasks();
}

function toggleTaskStatus(id) {
    const task = state.tasks.find(t => t.id === id);
    if (task) {
        task.completed = !task.completed;
        saveData();
        renderTasks();
    }
}

function deleteTaskTask(id) {
    if (!confirm('タスクを削除しますか？')) return;
    state.tasks = state.tasks.filter(t => t.id !== id);
    saveData();
    renderTasks();
}

function renderTasks() {
    if (state.currentView !== 'tasks') {
        state.staleViews.tasks = true;
        return;
    }
    const body = document.getElementById('todo-body');
    if (!body) return;
    body.innerHTML = '';

    const filteredTasks = state.tasks.filter(task => {
        if (currentTaskFilter === 'active') return !task.completed;
        if (currentTaskFilter === 'completed') return task.completed;
        return true;
    });

    if (filteredTasks.length === 0) {
        body.innerHTML = `<div class="empty-state">タスクがありません。</div>`;
        return;
    }

    filteredTasks.forEach(task => {
        const item = document.createElement('div');
        item.className = `todo-item {task.completed ? 'completed' : ''}`;
        // バッククォートのエスケープに注意
        item.innerHTML = `
            <div class="checkbox-custom" role="checkbox" aria-checked="${task.completed}"></div>
            <span class="todo-text">${escapeHtml(task.text)}</span>
            <button class="delete-btn" aria-label="削除"><i data-lucide="x"></i></button>
        `;

        item.querySelector('.checkbox-custom').onclick = () => toggleTaskStatus(task.id);
        item.querySelector('.todo-text').onclick = () => toggleTaskStatus(task.id);
        item.querySelector('.delete-btn').onclick = (e) => {
            e.stopPropagation();
            deleteTaskTask(task.id);
        };

        body.appendChild(item);
    });
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function showToast(message) {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `<i data-lucide="check-circle"></i> ${message}`;
    container.appendChild(toast);

    // アイコンの反映を確実にするため少し遅らせる
    setTimeout(() => lucide.createIcons(), 10);

    setTimeout(() => {
        toast.remove();
    }, 3500);
}

// Auth Handlers
async function handleLogin(e) {
    e.preventDefault();
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;

    try {
        await auth.signInWithEmailAndPassword(email, password);
        showToast('ログインしました');
    } catch (error) {
        alert('ログイン失敗: ' + error.message);
    }
}

async function handleRegister() {
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;

    if (!email || !password) {
        alert('メールアドレスとパスワードを入力してください。');
        return;
    }
    if (password.length < 6) {
        alert('パスワードは6文字以上で設定してください。');
        return;
    }

    try {
        await auth.createUserWithEmailAndPassword(email, password);
        showToast('アカウントを作成しました');
    } catch (error) {
        alert('登録失敗: ' + error.message);
    }
}

async function handleLogout() {
    if (!confirm('ログアウトしますか？')) return;
    try {
        await auth.signOut();
        location.reload(); // 全状態をリセット
    } catch (error) {
        alert('ログアウトエラー: ' + error.message);
    }
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
    showToast('CSVを出力しました');
}

function exportHistoryReport() {
    if (state.logs.length === 0) {
        alert('出力するデータがありません。');
        return;
    }

    // 現在のソート設定を反映
    const sortedLogs = [...state.logs].sort((a, b) => {
        let valA = a[state.sortConfig.key] || '';
        let valB = b[state.sortConfig.key] || '';
        if (state.sortConfig.key === 'fieldId') {
            valA = state.fields.find(f => f.id === a.fieldId)?.name || '';
            valB = state.fields.find(f => f.id === b.fieldId)?.name || '';
        }
        if (valA < valB) return state.sortConfig.direction === 'asc' ? -1 : 1;
        if (valA > valB) return state.sortConfig.direction === 'asc' ? 1 : -1;
        return 0;
    });

    let reportHtml = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>作業日報レポート_${new Date().toLocaleDateString()}</title>
    <style>
        body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #333; line-height: 1.6; padding: 40px; }
        h1 { border-bottom: 2px solid #2d5a27; padding-bottom: 10px; color: #2d5a27; }
        .log-entry { border: 1px solid #ddd; border-radius: 8px; margin-bottom: 30px; padding: 20px; page-break-inside: avoid; }
        .log-header { font-weight: bold; background: #f9f9f9; padding: 10px; margin: -20px -20px 15px -20px; border-radius: 8px 8px 0 0; display: flex; justify-content: space-between; }
        .meta-info { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; margin-bottom: 15px; }
        .meta-item { font-size: 0.9rem; }
        .meta-label { color: #666; font-size: 0.8rem; display: block; }
        .notes { background: #fffbe6; padding: 10px; border-left: 4px solid #ffe58f; margin: 10px 0; }
        .media-grid { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 15px; }
        .media-item { width: 200px; height: 150px; object-fit: cover; border-radius: 4px; border: 1px solid #eee; }
        @media print { body { padding: 0; } .log-entry { border-color: #eee; } }
    </style>
</head>
<body>
    <h1>🌾 作業日報レポート</h1>
    <p>出力日: ${new Date().toLocaleString()}</p>
    `;

    sortedLogs.forEach(log => {
        const fieldName = state.fields.find(f => f.id === log.fieldId)?.name || '不明';
        const farmName = state.farms.find(f => f.id === (state.fields.find(f => f.id === log.fieldId)?.farmId))?.name || '未割当';

        reportHtml += `
        <div class="log-entry">
            <div class="log-header">
                <span>${log.date}</span>
                <span>${log.type}</span>
            </div>
            <div class="meta-info">
                <div class="meta-item"><span class="meta-label">農場 / 圃場</span>${farmName} / ${fieldName}</div>
                <div class="meta-item"><span class="meta-label">対象作物</span>${log.crop || '未設定'}</div>
                <div class="meta-item"><span class="meta-label">作業者</span>${log.worker || '-'}</div>
            </div>
            <div class="notes"><span class="meta-label">作業メモ</span>${log.notes || '-'}</div>
            <div class="media-grid">
        `;

        const mediaList = log.mediaList || (log.media ? [log.media] : []);
        mediaList.forEach(m => {
            if (m.type.startsWith('image/')) {
                reportHtml += `<img src="${m.url}" class="media-item">`;
            } else if (m.type.startsWith('video/')) {
                reportHtml += `<video src="${m.url}" class="media-item" controls></video>`;
            }
        });

        reportHtml += `
            </div>
        </div>
        `;
    });

    reportHtml += `</body></html>`;

    // ダウンロード処理
    const blob = new Blob([reportHtml], { type: 'text/html;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `作業レポート_${new Date().toISOString().slice(0, 10)}.html`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast('ビジュアルレポートを出力しました');
}

init();
