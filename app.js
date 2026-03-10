// --- Constants & State ---
const state = {
    year: 2026,
    tasks: JSON.parse(localStorage.getItem('gp_tasks')) || [],
    cropOrder: JSON.parse(localStorage.getItem('gp_crop_order')) || [],
    categoryOrders: JSON.parse(localStorage.getItem('gp_cat_orders')) || {},
    editingTaskId: null
};

const WEEK_WIDTH = 35;
const pxPerDay = 5;
const TASK_LIST_WIDTH = 180;
const ITEM_HEIGHT = 64; // 1タスクが占有する垂直高さ（上下表示ができるように広め）
const ROW_PADDING = 10;

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    initTimeline();
    renderTasks();
    setupEventListeners();
    lucide.createIcons();
});

// --- Timeline Generation ---
function initTimeline() {
    const monthsRow = document.getElementById('months-row');
    monthsRow.innerHTML = '';
    for (let m = 2; m < 14; m++) {
        const displayMonth = (m % 12);
        const displayYear = state.year + Math.floor(m / 12);

        const lastDay = new Date(displayYear, displayMonth + 1, 0);
        const daysInMonth = lastDay.getDate();

        const monthCol = document.createElement('div');
        monthCol.className = 'month-col';
        monthCol.style.width = `${daysInMonth * pxPerDay}px`;

        const monthLabel = document.createElement('div');
        monthLabel.className = 'month-label';
        monthLabel.innerText = (displayMonth + 1) + '月';
        monthCol.appendChild(monthLabel);

        const weeksRow = document.createElement('div');
        weeksRow.className = 'weeks-row';
        for (let d = 1; d <= daysInMonth; d += 7) {
            const weekLabel = document.createElement('div');
            weekLabel.className = 'week-label';
            weekLabel.innerText = Math.floor((d - 1) / 7) + 1;
            weekLabel.style.width = `${Math.min(7, daysInMonth - d + 1) * pxPerDay}px`;
            weeksRow.appendChild(weekLabel);
        }
        monthCol.appendChild(weeksRow);
        monthsRow.appendChild(monthCol);
    }
}

// --- Task Rendering ---
function renderTasks() {
    const container = document.getElementById('gantt-rows-container');
    container.innerHTML = '';

    const groups = {};
    state.tasks.forEach(task => {
        // 旧データの自動移行（crop未設定の場合）
        if (!task.crop) {
            task.crop = task.name || '未分類';
            task.name = task.subName || '一般作業';
            task.subName = '';
        }
        if (!groups[task.crop]) groups[task.crop] = {};
        if (!groups[task.crop][task.name]) groups[task.crop][task.name] = [];
        groups[task.crop][task.name].push(task);
    });

    // 表示順の整理
    let cropNames = Object.keys(groups).sort((a, b) => {
        let ia = state.cropOrder.indexOf(a);
        let ib = state.cropOrder.indexOf(b);
        return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
    });
    // キャッシュを更新
    state.cropOrder = cropNames;

    cropNames.forEach(cropName => {
        const cropSection = document.createElement('div');
        cropSection.className = 'crop-section';
        cropSection.dataset.crop = cropName;
        cropSection.draggable = true;
        cropSection.ondragstart = (e) => handleDragStart(e, 'crop', cropName);
        cropSection.ondragover = (e) => handleDragOver(e);
        cropSection.ondrop = (e) => handleDrop(e, 'crop', cropName);

        // 作物用サイドバー（セル統合風）
        const cropSidebar = document.createElement('div');
        cropSidebar.className = 'crop-sidebar-cell';

        const gripCrop = document.createElement('div');
        gripCrop.className = 'drag-handle';
        gripCrop.innerHTML = '<i data-lucide="grip-vertical"></i>';
        cropSidebar.appendChild(gripCrop);

        const cropLabel = document.createElement('span');
        cropLabel.innerText = cropName;
        cropSidebar.appendChild(cropLabel);

        cropSidebar.title = 'ドラッグで移動 / クリックで追加';
        cropSidebar.onclick = (e) => {
            if (e.target.closest('.drag-handle')) return;
            openModal({ crop: cropName, isNewPreset: true });
        };
        cropSection.appendChild(cropSidebar);

        const rowsContainer = document.createElement('div');
        rowsContainer.className = 'crop-rows-container';
        cropSection.appendChild(rowsContainer);

        // カテゴリの並び替え
        let categoryNames = Object.keys(groups[cropName]).sort((a, b) => {
            const orders = state.categoryOrders[cropName] || [];
            let ia = orders.indexOf(a);
            let ib = orders.indexOf(b);
            return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
        });
        state.categoryOrders[cropName] = categoryNames;

        categoryNames.forEach((categoryName, catIdx) => {
            const row = document.createElement('div');
            row.className = 'gantt-row';
            row.draggable = true;
            row.ondragstart = (e) => {
                e.stopPropagation();
                handleDragStart(e, 'category', { cropName, categoryName });
            };
            row.ondragover = (e) => handleDragOver(e);
            row.ondrop = (e) => {
                e.stopPropagation();
                handleDrop(e, 'category', { cropName, categoryName });
            };

            const nameCell = document.createElement('div');
            nameCell.className = 'task-name-cell';

            const gripCat = document.createElement('div');
            gripCat.className = 'drag-handle';
            gripCat.innerHTML = '<i data-lucide="grip-vertical"></i>';
            gripCat.style.opacity = '0.5';
            nameCell.appendChild(gripCat);

            const titleSpan = document.createElement('span');
            titleSpan.innerText = categoryName;
            titleSpan.style.cursor = 'pointer';
            titleSpan.style.textDecoration = 'underline';
            titleSpan.style.textDecorationColor = 'rgba(255,255,255,0.3)';
            titleSpan.style.flex = '1';
            titleSpan.title = 'この作業項目にタスクを追加';
            titleSpan.onclick = () => openModal({ crop: cropName, name: categoryName, isNewPreset: true });
            nameCell.appendChild(titleSpan);

            const delRowBtn = document.createElement('button');
            delRowBtn.className = 'row-delete-btn';
            delRowBtn.innerHTML = '<i data-lucide="trash-2"></i>';
            delRowBtn.onclick = (e) => {
                e.stopPropagation();
                deleteCategory(categoryName, cropName);
            };
            nameCell.appendChild(delRowBtn);
            row.appendChild(nameCell);

            const gridCells = document.createElement('div');
            gridCells.className = 'grid-cells';

            // カテゴリ内のタスクを開始日順に並べる
            const categoryTasks = groups[cropName][categoryName].sort((a, b) => new Date(a.start) - new Date(b.start));

            const placements = categoryTasks.map(task => {
                const isDeadlineUI = task.type === 'deadline' || task.type === 'sequential';
                const { left, width } = calculateBarPosition(task, isDeadlineUI && task.progress !== '100');
                const estimatedLabelWidth = ((task.subName || "").length * 12) + 120;
                return { task, left, width, isDeadlineUI, estimatedLabelWidth };
            });

            const labelEnds = {};
            let maxAbsLevel = 1;

            placements.forEach((p, i) => {
                let rank = 1;
                let chosenLevel = null;
                while (true) {
                    if (!labelEnds[rank] || labelEnds[rank] <= p.left) { chosenLevel = rank; break; }
                    if (!labelEnds[-rank] || labelEnds[-rank] <= p.left) { chosenLevel = -rank; break; }
                    rank++;
                }
                labelEnds[chosenLevel] = p.left + p.estimatedLabelWidth;
                p.level = chosenLevel;
                maxAbsLevel = Math.max(maxAbsLevel, rank);

                const overlapColors = new Set();
                for (let j = 0; j < i; j++) {
                    const other = placements[j];
                    if (p.left < other.left + other.width && p.left + p.width > other.left) {
                        if (other.colorIdx !== undefined) {
                            overlapColors.add(other.colorIdx);
                        }
                    }
                }
                let colorIdx = overlapColors.size > 0 ? 1 : 0;
                while (overlapColors.has(colorIdx)) {
                    colorIdx++;
                }
                if (colorIdx > 5) colorIdx = ((colorIdx - 1) % 5) + 1; // 1~5でループ
                p.colorIdx = colorIdx;
            });

            // 矢印の後ろのガイド線
            const track = document.createElement('div');
            track.className = 'layer-track';
            track.style.top = `calc(50% - 6px)`; // 中央
            track.style.height = `12px`;
            gridCells.appendChild(track);

            placements.forEach(p => {
                const task = p.task;
                const taskItem = document.createElement('div');
                const uiTypeClass = p.isDeadlineUI ? 'deadline' : 'period';
                const overlapClass = p.colorIdx > 0 ? ` overlap-c${p.colorIdx}` : '';
                taskItem.className = `task-item p-${task.progress} ${uiTypeClass}${overlapClass}`;
                taskItem.style.left = `${p.left}px`;
                taskItem.style.top = `0`;
                taskItem.style.height = `100%`;
                taskItem.style.width = `${p.width}px`;
                taskItem.style.pointerEvents = 'none'; // 重なり回避

                const detailWrap = document.createElement('div');
                detailWrap.className = `task-details`;
                detailWrap.style.pointerEvents = 'auto'; // 個別にクリック可能に

                // 動的に上下位置を計算
                if (p.level > 0) {
                    detailWrap.style.bottom = `calc(50% + ${(p.level - 1) * 20 + 8}px)`;
                } else {
                    detailWrap.style.top = `calc(50% + ${(Math.abs(p.level) - 1) * 20 + 8}px)`;
                }

                const checkBtn = document.createElement('span');
                checkBtn.className = 'status-check-btn';
                checkBtn.innerText = task.progress === '100' ? '✅' : '⬜';
                checkBtn.onclick = (e) => {
                    e.stopPropagation();
                    if (task.progress === '100') {
                        task.progress = '0';
                    } else {
                        task.progress = '100';
                        if (task.type === 'sequential' && task.pendingSteps && task.pendingSteps.length > 0) {
                            const nextStep = task.pendingSteps[0];
                            const nextStart = new Date();
                            const nextTask = {
                                id: `t_${Date.now()}`,
                                type: 'sequential',
                                name: task.name,
                                subName: nextStep.name,
                                pendingSteps: task.pendingSteps.slice(1),
                                start: nextStart.toISOString().split('T')[0],
                                end: nextStep.deadline,
                                progress: '0'
                            };
                            task.pendingSteps = [];
                            state.tasks.push(nextTask);
                        }
                    }
                    saveState();
                    renderTasks();
                };
                detailWrap.appendChild(checkBtn);

                const startDate = new Date(task.start);
                const endDate = new Date(task.end);
                const isValidStart = !isNaN(startDate.getTime());
                const isValidEnd = !isNaN(endDate.getTime());

                let dateLabel = "日付不明";
                if (isValidEnd) {
                    if (p.isDeadlineUI) {
                        dateLabel = endDate.toLocaleDateString('ja-JP', { month: 'short', day: 'numeric' });
                    } else if (isValidStart) {
                        dateLabel = `${startDate.toLocaleDateString('ja-JP', { month: 'short', day: 'numeric' })}〜${endDate.toLocaleDateString('ja-JP', { month: 'short', day: 'numeric' })}`;
                    }
                }

                const detailText = `${task.subName || ''} (${dateLabel})`;
                const labelEl = document.createElement('span');
                labelEl.className = 'task-label';
                labelEl.innerText = detailText;
                detailWrap.appendChild(labelEl);
                taskItem.appendChild(detailWrap);

                const arrowWrap = document.createElement('div');
                arrowWrap.className = 'task-arrow';
                arrowWrap.style.pointerEvents = 'auto'; // 矢印もクリック可能に
                if (p.isDeadlineUI) {
                    const line = document.createElement('div');
                    line.className = 'arrow-line';
                    const rightHead = document.createElement('div');
                    rightHead.className = 'arrow-right-head';
                    arrowWrap.appendChild(line);
                    arrowWrap.appendChild(rightHead);
                } else {
                    const line = document.createElement('div');
                    line.className = 'arrow-line';
                    const leftHead = document.createElement('div');
                    leftHead.className = 'arrow-left-head';
                    const rightHead = document.createElement('div');
                    rightHead.className = 'arrow-right-head';
                    arrowWrap.appendChild(leftHead);
                    arrowWrap.appendChild(line);
                    arrowWrap.appendChild(rightHead);
                }
                taskItem.appendChild(arrowWrap);

                // クリックイベントを子要素に委譲
                detailWrap.onclick = (e) => {
                    if (e.target.className !== 'status-check-btn') openModal(task);
                };
                arrowWrap.onclick = () => openModal(task);

                gridCells.appendChild(taskItem);
            });

            // 必要な重なりレベルに応じて行の垂直幅を自動拡張
            const dynamicHeight = Math.max(ITEM_HEIGHT, (maxAbsLevel * 20 + 16) * 2);
            row.style.height = `${Math.max(ROW_MIN_HEIGHT, dynamicHeight)}px`;

            row.appendChild(gridCells);
            rowsContainer.appendChild(row);
        });
        container.appendChild(cropSection);
    });
    lucide.createIcons();
}

// --- Drag and Drop ---
let dragSource = null;

function handleDragStart(e, type, data) {
    dragSource = { type, data };
    e.dataTransfer.effectAllowed = 'move';
    // ゴースト画像の代わりに透明度を下げる等の視覚効果はCSSで行う
}

function handleDragOver(e) {
    if (e.preventDefault) e.preventDefault();
    return false;
}

function handleDrop(e, targetType, targetData) {
    if (!dragSource || dragSource.type !== targetType) return;

    if (dragSource.type === 'crop') {
        const fromIdx = state.cropOrder.indexOf(dragSource.data);
        const toIdx = state.cropOrder.indexOf(targetData);
        if (fromIdx !== -1 && toIdx !== -1) {
            state.cropOrder.splice(fromIdx, 1);
            state.cropOrder.splice(toIdx, 0, dragSource.data);
        }
    } else if (dragSource.type === 'category') {
        // 同じ作物内でのみ移動可能とする
        if (dragSource.data.cropName !== targetData.cropName) return;
        const crop = dragSource.data.cropName;
        const orders = state.categoryOrders[crop];
        const fromIdx = orders.indexOf(dragSource.data.categoryName);
        const toIdx = orders.indexOf(targetData.categoryName);
        if (fromIdx !== -1 && toIdx !== -1) {
            orders.splice(fromIdx, 1);
            orders.splice(toIdx, 0, dragSource.data.categoryName);
        }
    }

    saveState();
    renderTasks();
}

const ROW_MIN_HEIGHT = 48;

function deleteCategory(categoryName, cropName) {
    if (!confirm(`「${cropName}」の作業項目「${categoryName}」を完全に削除しますか？`)) return;
    state.tasks = state.tasks.filter(t => !(t.crop === cropName && t.name === categoryName));
    saveState();
    renderTasks();
}

function calculateBarPosition(task, useTodayStart = false) {
    const end = new Date(task.end);
    const startStr = task.start;
    const yearStart = new Date(state.year, 2, 1); // 3月1日を起点にする
    let start;

    if (useTodayStart) {
        start = new Date();
        start.setHours(0, 0, 0, 0);
        end.setHours(0, 0, 0, 0);
        if (start > end) start = new Date(end);
    } else {
        start = new Date(startStr);
    }

    const diffStart = (start - yearStart) / (1000 * 60 * 60 * 24);
    const diffEnd = (end - start) / (1000 * 60 * 60 * 24) + 1;

    return {
        left: Math.max(0, diffStart * pxPerDay),
        width: Math.max(12, diffEnd * pxPerDay)
    };
}

function setupEventListeners() {
    document.getElementById('btn-add-task').onclick = () => openModal();
    document.getElementById('btn-cancel').onclick = closeModal;
    document.getElementById('btn-delete').onclick = deleteTask;
    document.getElementById('task-form').onsubmit = handleFormSubmit;
    document.getElementById('task-type').onchange = (e) => updateModalLayout(e.target.value);
    document.getElementById('btn-add-seq-step').onclick = () => {
        const container = document.getElementById('seq-steps-container');
        addSeqStepRow(container, '', '', container.children.length + 1);
    };
}

function updateModalLayout(type) {
    const normalInputs = document.getElementById('normal-task-inputs');
    const seqInputs = document.getElementById('sequential-task-inputs');
    const startContainer = document.getElementById('start-date-container');
    const endLabel = document.getElementById('end-date-label');

    ['task-subname', 'task-start', 'task-end', 'seq-start-date'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.removeAttribute('required');
    });

    if (type === 'sequential') {
        normalInputs.style.display = 'none';
        seqInputs.style.display = 'block';
    } else {
        normalInputs.style.display = 'block';
        seqInputs.style.display = 'none';

        if (type === 'deadline') {
            startContainer.style.display = 'none';
            endLabel.innerText = '締切日';
        } else {
            startContainer.style.display = 'block';
            endLabel.innerText = '終了日';
        }
    }
}

function renderSeqSteps(steps = []) {
    const container = document.getElementById('seq-steps-container');
    container.innerHTML = '';
    if (steps.length === 0) {
        steps = [{ name: '', deadline: '' }];
    }
    steps.forEach((step, idx) => {
        addSeqStepRow(container, step.name, step.deadline, idx + 1);
    });
}

function addSeqStepRow(container, name = '', deadline = '', num) {
    const row = document.createElement('div');
    row.className = 'seq-step-row';
    row.style = 'display: flex; gap: 8px; align-items: center;';

    const numLabel = document.createElement('span');
    numLabel.innerText = `${num}.`;
    numLabel.style = 'color: var(--text-dim); font-size: 0.8rem;';

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'seq-step-name';
    nameInput.placeholder = '作業名 (例: 種まき)';
    nameInput.value = name;
    nameInput.style = 'margin: 0; flex: 1;';

    const deadlineInput = document.createElement('input');
    deadlineInput.type = 'date';
    deadlineInput.className = 'seq-step-deadline';
    deadlineInput.value = deadline || new Date().toISOString().split('T')[0];
    deadlineInput.style = 'margin: 0; width: 130px;';

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.innerHTML = '×';
    delBtn.style = 'padding: 8px 10px; background: transparent; border: 1px solid var(--border); color: var(--text-dim); border-radius: 4px; cursor: pointer; margin: 0;';
    delBtn.onclick = () => {
        if (container.children.length > 1) {
            row.remove();
            Array.from(container.children).forEach((child, i) => {
                child.querySelector('span').innerText = `${i + 1}.`;
            });
        }
    };

    row.appendChild(numLabel);
    row.appendChild(nameInput);
    row.appendChild(deadlineInput);
    row.appendChild(delBtn);
    container.appendChild(row);
}

function openModal(task = null) {
    const overlay = document.getElementById('modal-overlay');
    const form = document.getElementById('task-form');
    const btnDelete = document.getElementById('btn-delete');
    form.reset();
    state.editingTaskId = null;

    const today = new Date().toISOString().split('T')[0];

    if (task && !task.isNewPreset) {
        state.editingTaskId = task.id;
        document.getElementById('task-type').value = task.type || 'period';
        document.getElementById('task-crop').value = task.crop || '';
        document.getElementById('task-name').value = task.name || '';
        document.getElementById('task-progress').value = task.progress || '0';

        if (task.type === 'sequential') {
            document.getElementById('seq-start-date').value = task.start;
            const stepsToRender = [{ name: task.subName, deadline: task.end }, ...(task.pendingSteps || [])];
            renderSeqSteps(stepsToRender);
        } else {
            document.getElementById('task-subname').value = task.subName || '';
            document.getElementById('task-start').value = task.start || today;
            document.getElementById('task-end').value = task.end || today;
        }

        btnDelete.classList.remove('hidden');
        updateModalLayout(task.type || 'period');
    } else {
        btnDelete.classList.add('hidden');
        document.getElementById('task-type').value = 'period';

        if (task && task.isNewPreset) {
            document.getElementById('task-crop').value = task.crop || '';
            document.getElementById('task-name').value = task.name || '';
        } else {
            document.getElementById('task-crop').value = '';
            document.getElementById('task-name').value = '';
        }

        document.getElementById('task-start').value = today;
        document.getElementById('task-end').value = today;
        document.getElementById('seq-start-date').value = today;
        renderSeqSteps([{ name: '', deadline: today }]);

        updateModalLayout('period');
    }
    overlay.classList.remove('hidden');
}

function closeModal() { document.getElementById('modal-overlay').classList.add('hidden'); }

function handleFormSubmit(e) {
    if (e) e.preventDefault();

    // 手動バリデーション
    const taskCropEl = document.getElementById('task-crop');
    const taskNameEl = document.getElementById('task-name');
    if (!taskCropEl.value.trim()) {
        alert('作物名(大分類)を入力してください。');
        taskCropEl.focus();
        return;
    }
    if (!taskNameEl.value.trim()) {
        alert('作業項目(行の名前)を入力してください。');
        taskNameEl.focus();
        return;
    }

    const type = document.getElementById('task-type').value;
    let subName = '';
    let start = '';
    let end = '';
    let pendingSteps = [];

    if (type === 'sequential') {
        const seqStartBtn = document.getElementById('seq-start-date');
        const rows = document.querySelectorAll('.seq-step-row');
        const stepsData = Array.from(rows).map(row => {
            return {
                name: row.querySelector('.seq-step-name').value.trim(),
                deadline: row.querySelector('.seq-step-deadline').value
            };
        }).filter(s => s.name && s.deadline);

        if (stepsData.length === 0) {
            alert('作業名と日付の両方を入力したステップが最低1つ必要です。');
            return;
        }

        subName = stepsData[0].name;
        start = seqStartBtn.value || new Date().toISOString().split('T')[0];
        end = stepsData[0].deadline;
        pendingSteps = stepsData.slice(1);
    } else {
        const subNameEl = document.getElementById('task-subname');
        const startEl = document.getElementById('task-start');
        const endEl = document.getElementById('task-end');

        if (!subNameEl.value.trim() && type === 'period') {
            // 期間タスクの場合は内容も必須とする運用と仮定
            alert('作業内容を入力してください。');
            subNameEl.focus();
            return;
        }
        if (!endEl.value) {
            alert('終了日(または締切日)を入力してください。');
            endEl.focus();
            return;
        }

        subName = subNameEl.value;
        start = startEl.value || new Date().toISOString().split('T')[0];
        end = endEl.value;
    }

    const taskData = {
        id: state.editingTaskId || `t_${Date.now()}`,
        type: type,
        crop: taskCropEl.value.trim(),
        name: taskNameEl.value.trim(),
        subName: subName,
        pendingSteps: pendingSteps,
        start: start,
        end: end,
        progress: document.getElementById('task-progress') ? document.getElementById('task-progress').value : '0'
    };

    if (state.editingTaskId) {
        const idx = state.tasks.findIndex(t => t.id === state.editingTaskId);
        state.tasks[idx] = taskData;
    } else {
        state.tasks.push(taskData);
    }
    saveState();
    renderTasks();
    closeModal();
}

function deleteTask() {
    if (!state.editingTaskId || !confirm('この項目を削除しますか？')) return;
    state.tasks = state.tasks.filter(t => t.id !== state.editingTaskId);
    saveState();
    renderTasks();
    closeModal();
}

function saveState() {
    localStorage.setItem('gp_tasks', JSON.stringify(state.tasks));
    localStorage.setItem('gp_crop_order', JSON.stringify(state.cropOrder));
    localStorage.setItem('gp_cat_orders', JSON.stringify(state.categoryOrders));
}
