import {
  WHITE,
  cloneSlot,
  normalizeRows,
  slotFromFactory,
  parseCube,
  evaluateCube,
  fitCubeQuick,
  prepareRelativeProxy,
  applyPreparedRelative,
  editCurveMonotone,
  projectJson,
  parameterJson,
  cubeTextFromSlot,
} from './engine.js';

const $ = id => document.getElementById(id);
const STORAGE_KEY = 'pentax-labs-web-beta80-v1';
const DB_NAME = 'PentaxLabsWeb';
const DB_STORE = 'userFilters';

const state = {
  family: null,
  factoryRows: [],
  factorySlots: new Map(),
  natural: null,
  users: new Map(),
  db: null,
  tab: 'factory',
  active: 0,
  cameraModel: 'k1ii',
  previewMode: 'camera',
  slots: [],
  bases: [],
  channel: 0,
  comparing: false,
  sourceName: '内置色卡',
};

const original = document.createElement('canvas');
const originalContext = original.getContext('2d', {willReadFrequently:true});
const preview = $('previewCanvas');
const previewContext = preview.getContext('2d');
let renderTimer = 0;
let toastTimer = 0;
let curvePointer = null;

function currentSlot() {
  return state.slots[state.active];
}

function currentBase() {
  return state.bases[state.active];
}

function safeName(value) {
  return String(value || 'PentaxLabs').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 72);
}

function stripSource(slot) {
  const copy = cloneSlot(slot);
  copy.sourceLut = null;
  return copy;
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      active: state.active,
      cameraModel: state.cameraModel,
      tab: state.tab,
      slots: state.slots.map(stripSource),
      bases: state.bases.map(stripSource),
    }));
  } catch (error) {
    console.warn('Unable to persist web state', error);
  }
}

function restoreLocal() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (!parsed || !Array.isArray(parsed.slots) || parsed.slots.length !== 3) return null;
    if (!Array.isArray(parsed.bases) || parsed.bases.length !== 3) parsed.bases = parsed.slots;
    return parsed;
  } catch {
    return null;
  }
}

function notify(message) {
  const toast = $('toast');
  toast.textContent = message;
  toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 3000);
}

function setStatus(message) {
  $('footerStatus').textContent = message;
}

function downloadBlob(filename, data, type) {
  const blob = data instanceof Blob ? data : new Blob([data], {type});
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 800);
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(DB_STORE)) {
        request.result.createObjectStore(DB_STORE, {keyPath:'id'});
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function dbAll() {
  if (!state.db) return Promise.resolve([]);
  return new Promise((resolve, reject) => {
    const request = state.db.transaction(DB_STORE, 'readonly').objectStore(DB_STORE).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

function dbPut(item) {
  if (!state.db) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const tx = state.db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).put(item);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

function dbDelete(id) {
  if (!state.db) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const tx = state.db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).delete(id);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

async function loadFactoryLibrary() {
  let payload = null;
  let lastError = null;
  for (const url of ['./assets/factory_lut_families.json', '../app/core/assets/factory_lut_families.json']) {
    try {
      const response = await fetch(url, {cache:'no-cache'});
      if (!response.ok) throw Error('HTTP ' + response.status);
      payload = await response.json();
      break;
    } catch (error) {
      lastError = error;
    }
  }
  if (!payload) throw Error('无法读取 beta80 原厂滤镜库：' + (lastError ? lastError.message : 'unknown'));
  const family = payload.families && payload.families.k12;
  if (!family || !Array.isArray(family.filters)) throw Error('K12 原厂滤镜库格式不正确');
  state.family = family;
  state.factoryRows = family.filters;
  state.factorySlots.clear();
  family.filters.forEach(row => state.factorySlots.set(row.key, slotFromFactory(row, state.cameraModel)));
  const naturalRow = family.filters.find(row => row.local_key === 'natural');
  if (!naturalRow) throw Error('原厂滤镜库缺少 Natural');
  state.natural = slotFromFactory(naturalRow, state.cameraModel);
  $('familyLabel').textContent = family.label || 'K12';
}

function hydrateUserSources() {
  for (const list of [state.slots, state.bases]) {
    for (const slot of list) {
      if (!slot || !slot.user_preset_id) continue;
      const item = state.users.get(slot.user_preset_id);
      if (item && item.sourceLut) slot.sourceLut = item.sourceLut;
    }
  }
}

function initializeSlots() {
  const restored = restoreLocal();
  if (restored) {
    state.active = Math.max(0, Math.min(2, Number(restored.active) || 0));
    state.cameraModel = restored.cameraModel === 'k1' ? 'k1' : 'k1ii';
    state.tab = restored.tab === 'user' ? 'user' : 'factory';
    state.slots = restored.slots.map(slot => ({...slot, sourceLut:null, camera_model:state.cameraModel}));
    state.bases = restored.bases.map(slot => ({...slot, sourceLut:null, camera_model:state.cameraModel}));
    return;
  }
  state.slots = [0,1,2].map(() => cloneSlot(state.natural));
  state.bases = state.slots.map(cloneSlot);
}

function rgbCss(rgb) {
  return 'rgb(' + rgb.map(value => Math.round(Math.max(0,Math.min(1,value))*255)).join(',') + ')';
}

function swatchForSlot(slot) {
  const prepared = prepareRelativeProxy(slot, state.natural);
  const samples = [[.8,.3,.22],[.25,.55,.75],[.25,.72,.42]];
  return 'linear-gradient(125deg,' +
    samples.map(rgb => rgbCss(applyPreparedRelative(prepared, rgb))).join(',') + ')';
}

function userItems() {
  return Array.from(state.users.values()).sort((a,b) => Number(b.importedAt || 0) - Number(a.importedAt || 0));
}

function renderFilterList() {
  const term = $('filterSearch').value.trim().toLowerCase();
  const list = $('filterList');
  list.replaceChildren();
  const factoryMode = state.tab === 'factory';
  const items = factoryMode ? state.factoryRows : userItems();
  const filtered = items.filter(item => {
    const name = factoryMode ? item.label : item.name;
    return String(name).toLowerCase().includes(term);
  });
  $('filterCategory').textContent = factoryMode ? '原厂滤镜' : '用户滤镜';
  $('filterCount').textContent = filtered.length + ' 个';
  $('factoryTab').classList.toggle('on', factoryMode);
  $('userTab').classList.toggle('on', !factoryMode);

  if (!filtered.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-list';
    empty.textContent = factoryMode ? '没有匹配的原厂滤镜' : '尚无用户滤镜，导入 .cube 后会保存在这里';
    list.appendChild(empty);
    return;
  }

  filtered.forEach(item => {
    const slot = factoryMode ? state.factorySlots.get(item.key) : item.slot;
    const row = document.createElement('div');
    row.className = 'filter-row';
    const button = document.createElement('button');
    button.className = 'filter-item';
    const isSelected = factoryMode
      ? currentSlot().preset_key === item.key && !currentSlot().user_preset_id
      : currentSlot().user_preset_id === item.id;
    button.classList.toggle('active', isSelected);

    const thumb = document.createElement('span');
    thumb.className = 'thumb';
    thumb.style.background = swatchForSlot(slot);
    const label = document.createElement('span');
    label.className = 'filter-label';
    const title = document.createElement('b');
    title.textContent = factoryMode ? item.label : item.name;
    const sub = document.createElement('small');
    if (factoryMode) {
      sub.textContent = 'K12 · Matrix + RGB Gamma';
    } else {
      const report = item.slot.fit_report || {};
      sub.textContent = 'Web 拟合 · MAE ' +
        (Number.isFinite(report.rgb_mae_255) ? report.rgb_mae_255.toFixed(2) + '/255' : '—');
    }
    label.append(title, sub);
    const marker = document.createElement('span');
    marker.className = 'filter-indicator';
    button.append(thumb, label, marker);
    button.onclick = () => applyPreset(factoryMode ? item.key : item.id, factoryMode);
    row.appendChild(button);

    if (!factoryMode) {
      const remove = document.createElement('button');
      remove.className = 'delete-filter';
      remove.title = '删除用户滤镜';
      remove.textContent = '×';
      remove.onclick = async event => {
        event.stopPropagation();
        await deleteUser(item.id);
      };
      row.appendChild(remove);
    }
    list.appendChild(row);
  });
}

function renderSlots() {
  const root = $('slotRow');
  root.replaceChildren();
  state.slots.forEach((slot, index) => {
    const card = document.createElement('div');
    card.className = 'slot-card';
    card.classList.toggle('active', index === state.active);
    const main = document.createElement('button');
    main.className = 'slot-main';
    const number = document.createElement('span');
    number.className = 'slot-number';
    number.textContent = '0' + (index + 1);
    const title = document.createElement('strong');
    title.textContent = '自定义 ' + (index + 1);
    const name = document.createElement('small');
    name.textContent = slot.name || 'CUST';
    main.append(number, title, name);
    main.onclick = () => {
      state.active = index;
      persist();
      refresh();
    };
    const toggle = document.createElement('button');
    toggle.className = 'slot-toggle';
    toggle.classList.toggle('on', Boolean(slot.enabled));
    toggle.title = slot.enabled ? '停用此槽' : '启用此槽';
    toggle.textContent = slot.enabled ? '●' : '○';
    toggle.onclick = () => {
      slot.enabled = !slot.enabled;
      persist();
      renderSlots();
    };
    card.append(main, toggle);
    root.appendChild(card);
  });
}

function renderMatrix() {
  const grid = $('matrixGrid');
  grid.replaceChildren();
  const slot = currentSlot();
  for (let row=0; row<3; row++) {
    for (let column=0; column<3; column++) {
      const input = document.createElement('input');
      input.type = 'number';
      input.step = '1';
      input.min = '-2048';
      input.max = '2047';
      input.value = Math.round(slot.matrix[row][column]);
      input.dataset.row = row;
      input.dataset.column = column;
      input.className = row === column ? 'matrix-cell diagonal' : 'matrix-cell';
      input.readOnly = row === column;
      input.title = row === column ? '对角项由本行另外两项自动计算，使行和保持 256' : 'Q8 矩阵系数';
      input.onchange = () => {
        if (row === column) return;
        slot.matrix[row][column] = Math.max(-2048, Math.min(2047, Math.round(Number(input.value) || 0)));
        slot.matrix = normalizeRows(slot.matrix);
        persist();
        renderMatrix();
        queueRender();
      };
      grid.appendChild(input);
    }
  }
}

function drawCurve() {
  const canvas = $('curveCanvas');
  const ctx = canvas.getContext('2d');
  const width = canvas.width;
  const height = canvas.height;
  ctx.clearRect(0,0,width,height);
  ctx.fillStyle = '#111216';
  ctx.fillRect(0,0,width,height);
  ctx.strokeStyle = '#292b31';
  ctx.lineWidth = 1;
  for (let i=1;i<4;i++) {
    const x = width*i/4;
    const y = height*i/4;
    ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,height); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(width,y); ctx.stroke();
  }
  const colors = ['#ef6767','#6fd58b','#6ba4ff'];
  ctx.strokeStyle = colors[state.channel];
  ctx.lineWidth = 2;
  ctx.beginPath();
  currentSlot().curves[state.channel].forEach((value,index) => {
    const x = index / 255 * width;
    const y = height - Math.max(0,Math.min(WHITE,value)) / WHITE * height;
    if (index === 0) ctx.moveTo(x,y);
    else ctx.lineTo(x,y);
  });
  ctx.stroke();
}

function updateReport() {
  const slot = currentSlot();
  const report = slot.fit_report || {};
  if (Number.isFinite(report.rgb_mae_255)) {
    $('fitReport').textContent = 'Web 参数拟合验证 RGB MAE ' + report.rgb_mae_255.toFixed(3) +
      '/255 · Max ' + Number(report.rgb_max_255 || 0).toFixed(3) +
      '/255。原始 LUT 与机内参数可直接切换比较。';
  } else if (Number.isFinite(report.mean_de00)) {
    $('fitReport').textContent = 'beta80 生产预设 · 模型 ΔE00 平均 ' +
      report.mean_de00.toFixed(3) + ' · P95 ' + Number(report.p95_de00 || 0).toFixed(3) + '。';
  } else {
    $('fitReport').textContent = 'Matrix / RGB Gamma 参数由浏览器本地处理；完整相机脚本由桌面版生成。';
  }
}

function refreshControls() {
  const slot = currentSlot();
  $('brightness').value = Number(slot.brightness_ev || 0);
  $('brightnessVal').textContent =
    (Number(slot.brightness_ev || 0) >= 0 ? '+' : '') + Number(slot.brightness_ev || 0).toFixed(2) + ' EV';
  $('contrast').value = Number(slot.contrast || 0);
  $('contrastVal').textContent = String(Math.round(Number(slot.contrast || 0)));
  $('cameraModel').value = state.cameraModel;
  $('footerCamera').textContent = state.cameraModel === 'k1' ? 'PENTAX K-1' : 'PENTAX K-1 II';
  $('activeFilter').textContent = slot.name || 'CUST';
  $('footerFilter').textContent = slot.name || 'CUST';
  $('lutModeBtn').classList.toggle('on', state.previewMode === 'lut');
  $('cameraModeBtn').classList.toggle('on', state.previewMode === 'camera');
  $('lutModeBtn').classList.toggle('disabled', !slot.sourceLut);
  $('channelTabs').querySelectorAll('button').forEach(button => {
    button.classList.toggle('on', Number(button.dataset.channel) === state.channel);
  });
  renderMatrix();
  drawCurve();
  updateReport();
}

function refresh() {
  renderSlots();
  renderFilterList();
  refreshControls();
  queueRender();
}

function applyPreset(identifier, factoryMode) {
  let selected = null;
  if (factoryMode) {
    selected = state.factorySlots.get(identifier);
  } else {
    const item = state.users.get(identifier);
    if (item) {
      selected = cloneSlot(item.slot);
      selected.sourceLut = item.sourceLut || null;
      selected.user_preset_id = item.id;
    }
  }
  if (!selected) return;
  selected = cloneSlot(selected);
  selected.enabled = currentSlot().enabled;
  selected.camera_model = state.cameraModel;
  state.slots[state.active] = selected;
  state.bases[state.active] = cloneSlot(selected);
  if (state.previewMode === 'lut' && !selected.sourceLut) state.previewMode = 'camera';
  persist();
  refresh();
}

async function deleteUser(id) {
  const item = state.users.get(id);
  if (!item) return;
  await dbDelete(id);
  state.users.delete(id);
  for (let index=0; index<state.slots.length; index++) {
    if (state.slots[index].user_preset_id === id) {
      state.slots[index] = cloneSlot(state.natural);
      state.bases[index] = cloneSlot(state.natural);
    }
  }
  persist();
  refresh();
  notify('已删除用户滤镜：' + item.name);
}

function chartSource() {
  state.sourceName = '内置色卡';
  original.width = 1200;
  original.height = 660;
  const ctx = originalContext;
  ctx.fillStyle = '#17191d';
  ctx.fillRect(0,0,original.width,original.height);
  const patches = [
    [115,82,68],[194,150,130],[98,122,157],[87,108,67],[133,128,177],[103,189,170],
    [214,126,44],[80,91,166],[193,90,99],[94,60,108],[157,188,64],[224,163,46],
    [56,61,150],[70,148,73],[175,54,60],[231,199,31],[187,86,149],[8,133,161],
    [243,243,242],[200,200,200],[160,160,160],[122,122,121],[85,85,85],[52,52,52],
  ];
  const margin = 48;
  const gap = 14;
  const cellWidth = Math.floor((original.width - margin*2 - gap*5)/6);
  const cellHeight = 104;
  patches.forEach((rgb,index) => {
    const x = margin + (index%6)*(cellWidth+gap);
    const y = 42 + Math.floor(index/6)*(cellHeight+gap);
    ctx.fillStyle = 'rgb(' + rgb.join(',') + ')';
    ctx.fillRect(x,y,cellWidth,cellHeight);
  });
  const rampY = 42 + 4*(cellHeight+gap) + 10;
  const gradient = ctx.createLinearGradient(margin,0,original.width-margin,0);
  gradient.addColorStop(0,'#000');
  gradient.addColorStop(1,'#fff');
  ctx.fillStyle = gradient;
  ctx.fillRect(margin,rampY,original.width-margin*2,42);
  ctx.fillStyle = '#98a2b2';
  ctx.font = '15px sans-serif';
  ctx.fillText('PENTAX LABS · WEB COLOR PREVIEW', margin, 26);
  $('photoLabel').textContent = state.sourceName;
  queueRender();
}

async function loadPhoto(file) {
  const bitmap = await createImageBitmap(file);
  const factor = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  original.width = Math.max(1, Math.round(bitmap.width * factor));
  original.height = Math.max(1, Math.round(bitmap.height * factor));
  originalContext.clearRect(0,0,original.width,original.height);
  originalContext.drawImage(bitmap,0,0,original.width,original.height);
  bitmap.close();
  state.sourceName = file.name;
  $('photoLabel').textContent = file.name;
  queueRender();
}

function queueRender() {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(renderPreview, 28);
}

function renderPreview() {
  if (!original.width || !original.height || !state.natural || !currentSlot()) return;
  preview.width = original.width;
  preview.height = original.height;
  if (state.comparing) {
    previewContext.drawImage(original,0,0);
    $('renderStatus').textContent = '原图 · ' + original.width + ' × ' + original.height;
    return;
  }
  const image = originalContext.getImageData(0,0,original.width,original.height);
  const pixels = image.data;
  const slot = currentSlot();
  const directLut = state.previewMode === 'lut' && slot.sourceLut;
  const prepared = directLut ? null : prepareRelativeProxy(slot, state.natural);
  for (let index=0; index<pixels.length; index+=4) {
    const rgb = [pixels[index]/255,pixels[index+1]/255,pixels[index+2]/255];
    const output = directLut ? evaluateCube(slot.sourceLut, rgb) : applyPreparedRelative(prepared, rgb);
    pixels[index] = Math.round(output[0]*255);
    pixels[index+1] = Math.round(output[1]*255);
    pixels[index+2] = Math.round(output[2]*255);
  }
  previewContext.putImageData(image,0,0);
  $('renderStatus').textContent =
    (directLut ? '原始 LUT' : '机内参数 Web proxy') + ' · ' + original.width + ' × ' + original.height;
}

async function importFiles(files) {
  const cubeFiles = Array.from(files).filter(file => /\.cube$/i.test(file.name));
  if (!cubeFiles.length) return;
  for (const file of cubeFiles) {
    try {
      setStatus('拟合 LUT：' + file.name);
      await new Promise(resolve => requestAnimationFrame(resolve));
      const cube = parseCube(await file.text(), file.name);
      const fitted = fitCubeQuick(cube, state.natural, state.cameraModel);
      const id = cube.id.replace('lut:','');
      fitted.user_preset_id = id;
      fitted.sourceLut = cube;
      const item = {
        id,
        name: cube.name,
        slot: stripSource(fitted),
        sourceLut: cube,
        importedAt: Date.now(),
      };
      state.users.set(id,item);
      await dbPut(item);
      state.slots[state.active] = cloneSlot(fitted);
      state.bases[state.active] = cloneSlot(fitted);
      state.tab = 'user';
      state.previewMode = 'camera';
      persist();
      setStatus('LUT 拟合完成');
      notify('已导入「' + cube.name + '」 · Web MAE ' + fitted.fit_report.rgb_mae_255.toFixed(2) + '/255');
    } catch (error) {
      console.error(error);
      notify(file.name + '：' + (error.message || String(error)));
      setStatus('LUT 导入失败');
    }
  }
  $('lutFile').value = '';
  refresh();
}

function resetCurrent() {
  const enabled = currentSlot().enabled;
  state.slots[state.active] = cloneSlot(currentBase());
  state.slots[state.active].enabled = enabled;
  if (state.previewMode === 'lut' && !currentSlot().sourceLut) state.previewMode = 'camera';
  persist();
  refresh();
}

function installEvents() {
  $('factoryTab').onclick = () => { state.tab='factory'; persist(); renderFilterList(); };
  $('userTab').onclick = () => { state.tab='user'; persist(); renderFilterList(); };
  $('filterSearch').oninput = renderFilterList;
  $('importBtn').onclick = () => $('lutFile').click();
  $('lutFile').onchange = event => importFiles(event.target.files);
  $('photoBtn').onclick = () => $('photoFile').click();
  $('photoFile').onchange = async event => {
    try {
      if (event.target.files[0]) await loadPhoto(event.target.files[0]);
    } catch (error) {
      notify('照片读取失败：' + (error.message || String(error)));
    }
    event.target.value = '';
  };
  $('chartBtn').onclick = chartSource;
  $('resetBtn').onclick = resetCurrent;

  $('cameraModel').onchange = () => {
    state.cameraModel = $('cameraModel').value === 'k1' ? 'k1' : 'k1ii';
    state.slots.forEach(slot => slot.camera_model = state.cameraModel);
    state.bases.forEach(slot => slot.camera_model = state.cameraModel);
    persist();
    refreshControls();
    notify('网页参数模型已切换到 ' + (state.cameraModel === 'k1' ? 'K-1' : 'K-1 II'));
  };

  $('brightness').oninput = () => {
    currentSlot().brightness_ev = Number($('brightness').value);
    $('brightnessVal').textContent =
      (currentSlot().brightness_ev >= 0 ? '+' : '') + currentSlot().brightness_ev.toFixed(2) + ' EV';
    persist();
    queueRender();
  };
  $('contrast').oninput = () => {
    currentSlot().contrast = Number($('contrast').value);
    $('contrastVal').textContent = String(Math.round(currentSlot().contrast));
    persist();
    queueRender();
  };

  $('channelTabs').querySelectorAll('button').forEach(button => {
    button.onclick = () => {
      state.channel = Number(button.dataset.channel);
      refreshControls();
    };
  });
  $('resetCurveBtn').onclick = () => {
    currentSlot().curves[state.channel] = currentBase().curves[state.channel].slice();
    persist();
    drawCurve();
    queueRender();
  };

  const curve = $('curveCanvas');
  const curvePosition = event => {
    const rect = curve.getBoundingClientRect();
    const index = Math.max(0,Math.min(255,(event.clientX-rect.left)/rect.width*255));
    const value = Math.max(0,Math.min(1,1-(event.clientY-rect.top)/rect.height));
    return {index,value};
  };
  curve.addEventListener('pointerdown', event => {
    curve.setPointerCapture(event.pointerId);
    curvePointer = curvePosition(event);
  });
  curve.addEventListener('pointermove', event => {
    if (!curvePointer || !curve.hasPointerCapture(event.pointerId)) return;
    const next = curvePosition(event);
    currentSlot().curves[state.channel] = editCurveMonotone(
      currentSlot().curves[state.channel], curvePointer.index, next.index, next.value);
    curvePointer = next;
    drawCurve();
    persist();
    queueRender();
  });
  const endCurve = event => {
    if (curve.hasPointerCapture(event.pointerId)) curve.releasePointerCapture(event.pointerId);
    curvePointer = null;
  };
  curve.addEventListener('pointerup', endCurve);
  curve.addEventListener('pointercancel', endCurve);

  $('cameraModeBtn').onclick = () => {
    state.previewMode = 'camera';
    refreshControls();
    queueRender();
  };
  $('lutModeBtn').onclick = () => {
    if (!currentSlot().sourceLut) {
      notify('当前滤镜没有保留原始 CUBE；重新导入后可进行 LUT / 机内对比');
      return;
    }
    state.previewMode = 'lut';
    refreshControls();
    queueRender();
  };

  const compare = $('toggleCompare');
  compare.addEventListener('pointerdown', () => {
    state.comparing = true;
    renderPreview();
  });
  const endCompare = () => {
    if (!state.comparing) return;
    state.comparing = false;
    queueRender();
  };
  window.addEventListener('pointerup', endCompare);
  window.addEventListener('pointercancel', endCompare);

  $('exportProjectBtn').onclick = () => {
    const payload = JSON.stringify(projectJson(state.slots, state.cameraModel), null, 2);
    downloadBlob('PentaxLabs_Web_Project.json', payload, 'application/json;charset=utf-8');
    notify('已导出桌面版兼容 Pentax Labs 项目');
  };
  $('exportParamsBtn').onclick = () => {
    const payload = JSON.stringify(parameterJson(currentSlot(), state.cameraModel), null, 2);
    downloadBlob(safeName(currentSlot().name) + '_PentaxLabs_Params.json',
      payload, 'application/json;charset=utf-8');
    notify('已导出当前 Matrix / RGB Gamma 参数');
  };
  $('exportCubeBtn').onclick = () => {
    setStatus('生成 ' + $('exportGrid').value + '³ CUBE…');
    setTimeout(() => {
      try {
        const text = cubeTextFromSlot(currentSlot(), state.natural, Number($('exportGrid').value));
        downloadBlob(safeName(currentSlot().name) + '_PentaxLabs_Web.cube',
          text, 'text/plain;charset=utf-8');
        setStatus('CUBE 导出完成');
        notify('已导出 ' + $('exportGrid').value + '³ CUBE');
      } catch (error) {
        setStatus('CUBE 导出失败');
        notify(error.message || String(error));
      }
    }, 20);
  };

  const stage = $('photoStage');
  stage.addEventListener('dragover', event => {
    event.preventDefault();
    stage.classList.add('drag-over');
  });
  stage.addEventListener('dragleave', () => stage.classList.remove('drag-over'));
  stage.addEventListener('drop', async event => {
    event.preventDefault();
    stage.classList.remove('drag-over');
    const files = Array.from(event.dataTransfer.files);
    const cubes = files.filter(file => /\.cube$/i.test(file.name));
    if (cubes.length) await importFiles(cubes);
    const photo = files.find(file => file.type.startsWith('image/'));
    if (photo) {
      try { await loadPhoto(photo); }
      catch (error) { notify('照片读取失败：' + (error.message || String(error))); }
    }
  });
}

async function start() {
  installEvents();
  try {
    setStatus('加载 beta80 参数库');
    await loadFactoryLibrary();
    initializeSlots();
    $('cameraModel').value = state.cameraModel;
    chartSource();
    refresh();
    persist();
    setStatus('就绪 · beta80 Web');
    try {
      state.db = await openDatabase();
      for (const item of await dbAll()) {
        if (item && item.id && item.slot) state.users.set(item.id,item);
      }
      hydrateUserSources();
      refresh();
      persist();
    } catch (error) {
      console.warn('IndexedDB unavailable', error);
      notify('浏览器持久存储不可用；本次会话仍可使用');
    }
  } catch (error) {
    console.error(error);
    $('renderStatus').textContent = '初始化失败';
    setStatus('初始化失败');
    notify(error.message || String(error));
  }
}

start();
