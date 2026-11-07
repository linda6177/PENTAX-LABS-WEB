/* Pentax Labs Web engine.
 * Browser-side colour/model helpers. Camera runtime templates are loaded
 * separately by runtime.js so the colour engine stays deterministic.
 */

export const WHITE = 16383;
export const NODES = 256;
export const clamp01 = value => Math.min(1, Math.max(0, Number(value)));

export function identityCurve() {
  return Array.from({length:NODES}, (_, index) => index * WHITE / (NODES - 1));
}

export function cloneSlot(slot) {
  return {
    ...slot,
    matrix: slot.matrix.map(row => row.slice()),
    colorBaseMatrix: (slot.colorBaseMatrix || slot.matrix).map(row => row.slice()),
    curves: slot.curves.map(row => row.slice()),
    masterCurve: (slot.masterCurve || identityCurve()).slice(),
    fit_report: {...(slot.fit_report || {})},
    sourceLut: slot.sourceLut || null,
  };
}

export function normalizeRows(matrix) {
  const result = matrix.map(row => row.map(value => Math.round(Number(value) || 0)));
  for (let row = 0; row < 3; row++) {
    const other = [0,1,2].filter(column => column !== row);
    result[row][row] = 256 - result[row][other[0]] - result[row][other[1]];
  }
  return result;
}

export function slotFromFactory(row, cameraModel='k1ii') {
  return {
    name: row.label,
    enabled: true,
    matrix: row.matrix_q8.map(values => values.map(Number)),
    colorBaseMatrix: row.matrix_q8.map(values => values.map(Number)),
    curves: row.curve_u14.map(values => values.map(Number)),
    masterCurve: identityCurve(),
    preset_key: row.key,
    matrix_domain: row.matrix_domain || 'natural_relative',
    camera_model: cameraModel,
    brightness_ev: 0,
    contrast: 0,
    color_hue: 0,
    color_sat: 1,
    user_preset_id: '',
    fit_report: {
      mean_de00: Number(row.model_de00 || 0),
      p95_de00: Number(row.model_p95 || 0),
      source: 'Pentax Labs beta80 production factory library',
    },
    sourceLut: null,
  };
}

function matrixMultiply(a,b) {
  return a.map((row,r) => [0,1,2].map(c =>
    row[0]*b[0][c] + row[1]*b[1][c] + row[2]*b[2][c]));
}

function invert3(matrix) {
  const m=matrix;
  const a=m[0][0],b=m[0][1],c=m[0][2],d=m[1][0],e=m[1][1],f=m[1][2],g=m[2][0],h=m[2][1],i=m[2][2];
  const A=e*i-f*h,B=-(d*i-f*g),C=d*h-e*g,D=-(b*i-c*h),E=a*i-c*g,F=-(a*h-b*g),G=b*f-c*e,H=-(a*f-c*d),I=a*e-b*d;
  const det=a*A+b*B+c*C;
  if (Math.abs(det)<1e-12) throw Error('Natural 矩阵不可逆');
  return [[A,D,G],[B,E,H],[C,F,I]].map(row=>row.map(v=>v/det));
}

function matrixReference(naturalSlot,reference=null) {
  return (reference || naturalSlot.matrix).map(row=>row.map(Number));
}

export function displayMatrix(slot,naturalSlot,reference=null) {
  const relative=matrixMultiply(slot.matrix.map(r=>r.map(v=>v/256)),
    invert3(matrixReference(naturalSlot,reference).map(r=>r.map(v=>v/256))));
  return normalizeRows(relative.map(r=>r.map(v=>Math.round(v*256))));
}

export function setDisplayMatrix(slot,naturalSlot,display,reference=null) {
  const actual=matrixMultiply(display.map(r=>r.map(v=>v/256)), matrixReference(naturalSlot,reference));
  slot.matrix=normalizeRows(actual);
  return slot.matrix;
}

function interp(values,x) {
  const point=clamp01(x)*(values.length-1);
  const left=Math.min(values.length-2,Math.floor(point));
  const f=point-left;
  return values[left]*(1-f)+values[left+1]*f;
}

function smoothFactoryApprox(curve) {
  let values=curve.map(v=>Number(v)/WHITE);
  const kernel=[1/16,4/16,6/16,4/16,1/16];
  for(let pass=0;pass<2;pass++) {
    const next=new Array(values.length);
    for(let i=0;i<values.length;i++) {
      let sum=0;
      for(let k=-2;k<=2;k++) sum+=values[Math.max(0,Math.min(values.length-1,i+k))]*kernel[k+2];
      next[i]=sum;
    }
    values=next;
  }
  return values;
}

export function relativeCurve(slot,naturalSlot,channel,profiles=null,factoryBase=null) {
  const axis=profiles?.axis || Array.from({length:257},(_,i)=>i/256);
  if (channel===0) {
    const master=(slot.masterCurve||identityCurve()).map(v=>clamp01(v/WHITE));
    return axis.map(x=>interp(master,x));
  }
  if (!profiles) {
    const current=slot.curves[channel-1], natural=naturalSlot.curves[channel-1];
    return axis.map(x=>clamp01(x+interp(current.map(v=>v/WHITE),x)-interp(natural.map(v=>v/WHITE),x)));
  }
  // Match desktop relative_curves.py exactly: production factory keys are
  // namespaced (for example k12:bright), so the measured display reference
  // intentionally falls back to Natural. Only legacy plain keys use their
  // matching P317 measured profile.
  const rawKey=String(slot.preset_key||'natural');
  const key=profiles.profiles[rawKey]?rawKey:'natural';
  let tone=profiles.profiles[key][channel-1].slice();
  const base=profiles.native_reference?.[key]?.[channel-1]
    || (profiles.profiles[rawKey]?factoryBase:naturalSlot)?.curves?.[channel-1]
    || naturalSlot.curves[channel-1];
  const current=slot.curves[channel-1];
  let changed=false;
  for(let i=0;i<NODES;i++) if(Math.round(current[i])!==Math.round(base[i])) {changed=true;break;}
  if(changed) {
    const a=smoothFactoryApprox(current), b=smoothFactoryApprox(base);
    for(let i=0;i<tone.length;i++) {
      const x=i/(tone.length-1);
      tone[i]=clamp01(tone[i]+interp(a,x)-interp(b,x));
    }
    tone=isotonic(tone,tone.map(()=>1));
  }
  return axis.map((x,i)=>clamp01(
    x + interp(tone,profiles.latent[i]) - profiles.natural_at_latent[channel-1][i]));
}

export function applyRelativeCurve(slot,naturalSlot,channel,target,previous,profiles=null) {
  const clean=target.map(clamp01);
  const delta=clean.map((value,i)=>value-previous[i]);
  if (channel===0) {
    const values=(slot.masterCurve||identityCurve()).map((value,i)=>
      Math.round(clamp01(value/WHITE+interp(delta,i/(NODES-1)))*WHITE));
    for(let i=1;i<values.length;i++) values[i]=Math.max(values[i],values[i-1]);
    slot.masterCurve=values;
    return;
  }
  const displayAxis=profiles?.natural_native_display?.[channel-1] ||
    Array.from({length:NODES},(_,i)=>i/(NODES-1));
  const native=slot.curves[channel-1].map((value,i)=>
    Math.round(clamp01(value/WHITE+interp(delta,displayAxis[i]))*WHITE));
  for(let i=1;i<native.length;i++) native[i]=Math.max(native[i],native[i-1]);
  slot.curves[channel-1]=native;
}

export function saturationMatrix(strength) {
  const lum=[.2126,.7152,.0722];
  const m=Array.from({length:3},(_,r)=>Array.from({length:3},(_,c)=>
    lum[c]*(1-strength)+(r===c?strength:0)));
  return normalizeRows(m.map(row=>row.map(v=>Math.round(v*256))));
}

export function hueMatrix(degrees) {
  const a=degrees*Math.PI/180,c=Math.cos(a),s=Math.sin(a),q=Math.sqrt(3);
  const k=[[0,-1/q,1/q],[1/q,0,-1/q],[-1/q,1/q,0]];
  const kk=matrixMultiply(k,k);
  const m=Array.from({length:3},(_,r)=>Array.from({length:3},(_,col)=>
    (r===col?1:0)+s*k[r][col]+(1-c)*kk[r][col]));
  return normalizeRows(m.map(row=>row.map(v=>Math.round(v*256))));
}

export function applyColorControls(baseMatrix,saturation=1,hue=0) {
  let matrix=baseMatrix.map(row=>row.map(Number));
  if(Math.abs(saturation-1)>.001)
    matrix=matrixMultiply(matrix,saturationMatrix(saturation)).map(row=>row.map(v=>v/256));
  if(Math.abs(hue)>.001)
    matrix=matrixMultiply(matrix,hueMatrix(hue)).map(row=>row.map(v=>v/256));
  return matrix.map(row=>row.map(v=>Math.round(v)));
}

export function parseCube(text, filename='Imported.cube') {
  let size = 0;
  let dimension = 3;
  let title = filename.replace(/\.cube$/i, '');
  let domainMin = [0,0,0];
  let domainMax = [1,1,1];
  const values = [];
  let started = false;
  const headers = new Set();
  const numeric = /^[+\-.\d]/;
  for (const [index, sourceLine] of String(text).split(/\r?\n/).entries()) {
    const line = sourceLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const fields = line.match(/"[^"]*"|'[^']*'|\S+/g) || [];
    const key = (fields[0] || '').toUpperCase();
    if (['TITLE','DOMAIN_MIN','DOMAIN_MAX','LUT_1D_SIZE','LUT_3D_SIZE'].includes(key)) {
      if (started) throw Error('第 ' + (index + 1) + ' 行：LUT 数据之后不能再写头部');
      if (headers.has(key)) throw Error('重复的 CUBE 头部：' + key);
      headers.add(key);
      if (key === 'TITLE') {
        title = fields.slice(1).join(' ').replace(/^["']|["']$/g, '') || title;
      } else if (key === 'LUT_1D_SIZE') {
        dimension = 1;
        size = Number(fields[1]);
      } else if (key === 'LUT_3D_SIZE') {
        dimension = 3;
        size = Number(fields[1]);
      } else {
        const vector = fields.slice(1,4).map(Number);
        if (vector.length !== 3 || vector.some(value => !Number.isFinite(value))) {
          throw Error(key + ' 必须包含 3 个有限数值');
        }
        if (key === 'DOMAIN_MIN') domainMin = vector;
        else domainMax = vector;
      }
      continue;
    }
    if (key.startsWith('LUT_') || key.startsWith('DOMAIN_')) {
      throw Error('不支持的 CUBE 头部：' + key);
    }
    if (!numeric.test(line)) continue;
    if (!size) throw Error('第 ' + (index + 1) + ' 行：请先声明 LUT_3D_SIZE');
    if (fields.length !== 3) throw Error('第 ' + (index + 1) + ' 行：需要 3 个 RGB 输出值');
    started = true;
    values.push(...fields.map(Number));
  }
  if (dimension !== 3) throw Error('网页版当前只接收 3D .cube');
  if (!Number.isInteger(size) || size < 2 || size > 65) {
    throw Error('网页版支持 2–65 网格的 3D .cube');
  }
  if (values.length !== size ** 3 * 3) {
    throw Error('LUT 节点数量不匹配：' + (values.length / 3) + ' / ' + (size ** 3));
  }
  if (values.some(value => !Number.isFinite(value))) throw Error('CUBE 含非有限 RGB 数值');
  if (domainMin.some((value, i) => !Number.isFinite(value) ||
      !Number.isFinite(domainMax[i]) || domainMax[i] <= value)) {
    throw Error('DOMAIN_MIN / DOMAIN_MAX 不正确');
  }
  return {
    id: 'lut:' + crypto.randomUUID(),
    name: title.slice(0, 60),
    filename,
    size,
    min: domainMin,
    max: domainMax,
    data: new Float32Array(values),
  };
}

export function evaluateCube(cube, rgb) {
  const n = cube.size;
  const hi = n - 1;
  const point = rgb.map((value, channel) =>
    clamp01((value - cube.min[channel]) / (cube.max[channel] - cube.min[channel])) * hi);
  const base = point.map(value => Math.min(hi - 1, Math.floor(value)));
  const frac = point.map((value, channel) => value - base[channel]);
  const out = [0,0,0];
  const offset = (r,g,b) => ((b * n + g) * n + r) * 3;
  for (let db = 0; db <= 1; db++) {
    for (let dg = 0; dg <= 1; dg++) {
      for (let dr = 0; dr <= 1; dr++) {
        const weight =
          (dr ? frac[0] : 1-frac[0]) *
          (dg ? frac[1] : 1-frac[1]) *
          (db ? frac[2] : 1-frac[2]);
        const at = offset(base[0] + dr, base[1] + dg, base[2] + db);
        out[0] += cube.data[at] * weight;
        out[1] += cube.data[at + 1] * weight;
        out[2] += cube.data[at + 2] * weight;
      }
    }
  }
  return out.map(clamp01);
}

function effectiveCurve(curve, masterCurve, contrast=0, brightnessEv=0) {
  const power = Math.max(.25, 1 + Number(contrast || 0) / 100);
  const gain = 2 ** Number(brightnessEv || 0);
  const master=(masterCurve||identityCurve()).map(v=>clamp01(v/WHITE));
  return curve.map(raw => {
    let value = curveAt(master, clamp01(raw / WHITE));
    if (contrast) {
      const high = value ** power;
      const low = (1 - value) ** power;
      value = high / Math.max(high + low, 1e-12);
    }
    return clamp01(value * gain);
  });
}

export function effectiveCurves(slot) {
  return slot.curves.map(curve =>
    effectiveCurve(curve,slot.masterCurve,slot.contrast||0,slot.brightness_ev||0)
      .map(value=>Math.round(clamp01(value)*WHITE)));
}

function curveAt(curve, value) {
  const x = clamp01(value) * (curve.length - 1);
  const left = Math.min(curve.length - 2, Math.floor(x));
  const fraction = x - left;
  return curve[left] * (1-fraction) + curve[left + 1] * fraction;
}

export function nativeStageAt(slot, rgb) {
  const mixed = [0,0,0];
  for (let row=0; row<3; row++) {
    mixed[row] = clamp01(
      (slot.matrix[row][0] * rgb[0] +
       slot.matrix[row][1] * rgb[1] +
       slot.matrix[row][2] * rgb[2]) / 256);
  }
  const curves = slot.curves.map(curve =>
    effectiveCurve(curve, slot.masterCurve, slot.contrast || 0, slot.brightness_ev || 0));
  return mixed.map((value, channel) => curveAt(curves[channel], value));
}

function prepareStage(slot) {
  return {
    matrix: slot.matrix.map(row => row.map(Number)),
    curves: slot.curves.map(curve =>
      effectiveCurve(curve, slot.masterCurve, slot.contrast || 0, slot.brightness_ev || 0)),
  };
}

function preparedStageAt(stage, rgb) {
  const mixed = [0,0,0];
  for (let row=0; row<3; row++) {
    mixed[row] = clamp01(
      (stage.matrix[row][0] * rgb[0] +
       stage.matrix[row][1] * rgb[1] +
       stage.matrix[row][2] * rgb[2]) / 256);
  }
  return mixed.map((value, channel) => curveAt(stage.curves[channel], value));
}

export function prepareRelativeProxy(slot, naturalSlot) {
  return {style:prepareStage(slot), natural:prepareStage(naturalSlot)};
}

export function applyPreparedRelative(prepared, rgb) {
  const style = preparedStageAt(prepared.style, rgb);
  const natural = preparedStageAt(prepared.natural, rgb);
  return rgb.map((value, channel) => clamp01(value + style[channel] - natural[channel]));
}

export function applyRelativeProxy(slot, naturalSlot, rgb) {
  return applyPreparedRelative(prepareRelativeProxy(slot, naturalSlot), rgb);
}

export function transformPixel(slot, naturalSlot, rgb, mode='camera') {
  if (mode === 'lut' && slot.sourceLut) return evaluateCube(slot.sourceLut, rgb);
  return applyRelativeProxy(slot, naturalSlot, rgb);
}

function inverseCurve(curve, value) {
  const target = clamp01(value);
  let low = 0;
  let high = curve.length - 1;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (curve[mid] < target) low = mid + 1;
    else high = mid;
  }
  if (low === 0) return 0;
  const a = curve[low - 1];
  const b = curve[low];
  const fraction = b > a ? (target - a) / (b - a) : 0;
  return clamp01((low - 1 + fraction) / (curve.length - 1));
}

function solve2(features, target, weights) {
  let aa=0, ab=0, bb=0, ay=0, by=0;
  for (let i=0; i<target.length; i++) {
    const w = weights[i];
    const a = features[i][0];
    const b = features[i][1];
    const y = target[i];
    aa += w*a*a;
    ab += w*a*b;
    bb += w*b*b;
    ay += w*a*y;
    by += w*b*y;
  }
  aa += 1e-7;
  bb += 1e-7;
  const determinant = aa*bb - ab*ab;
  if (Math.abs(determinant) < 1e-12) return [0,0];
  return [(ay*bb - by*ab)/determinant, (by*aa - ay*ab)/determinant];
}

function fitMatrix(samples, targetPreTone, weights) {
  const matrix = [[256,0,0],[0,256,0],[0,0,256]];
  for (let channel=0; channel<3; channel++) {
    const others = [0,1,2].filter(index => index !== channel);
    const features = samples.map(sample => [
      sample[others[0]] - sample[channel],
      sample[others[1]] - sample[channel],
    ]);
    const target = targetPreTone.map((row,index) => row[channel] - samples[index][channel]);
    const solved = solve2(features, target, weights);
    matrix[channel][others[0]] = Math.round(solved[0] * 256);
    matrix[channel][others[1]] = Math.round(solved[1] * 256);
  }
  return normalizeRows(matrix).map(row =>
    row.map(value => Math.max(-2048, Math.min(2047, value))));
}

function isotonic(values, weights) {
  const levels = [];
  const mass = [];
  const starts = [];
  for (let i=0; i<values.length; i++) {
    levels.push(values[i]);
    mass.push(Math.max(weights[i], 1e-6));
    starts.push(i);
    while (levels.length > 1 && levels[levels.length-2] > levels[levels.length-1]) {
      const total = mass[mass.length-2] + mass[mass.length-1];
      levels[levels.length-2] =
        (levels[levels.length-2]*mass[mass.length-2] +
         levels[levels.length-1]*mass[mass.length-1]) / total;
      mass[mass.length-2] = total;
      levels.pop();
      mass.pop();
      starts.pop();
    }
  }
  const result = new Array(values.length);
  for (let group=0; group<starts.length; group++) {
    const end = group + 1 < starts.length ? starts[group+1] : values.length;
    for (let index=starts[group]; index<end; index++) {
      result[index] = clamp01(levels[group]);
    }
  }
  return result;
}

function fitCurve(xs, ys, weights) {
  const sum = new Float64Array(NODES);
  const mass = new Float64Array(NODES);
  for (let i=0; i<xs.length; i++) {
    const point = clamp01(xs[i]) * (NODES - 1);
    const left = Math.min(NODES - 2, Math.floor(point));
    const fraction = point - left;
    const weight = weights[i];
    sum[left] += ys[i] * weight * (1-fraction);
    mass[left] += weight * (1-fraction);
    sum[left+1] += ys[i] * weight * fraction;
    mass[left+1] += weight * fraction;
  }
  const values = new Array(NODES).fill(null);
  for (let i=0; i<NODES; i++) {
    if (mass[i] > 1e-9) values[i] = sum[i] / mass[i];
  }
  let previous = -1;
  for (let i=0; i<NODES; i++) {
    if (values[i] === null) continue;
    if (previous < 0) {
      for (let k=0; k<i; k++) values[k] = values[i];
    } else if (i - previous > 1) {
      const a = values[previous];
      const b = values[i];
      for (let k=previous+1; k<i; k++) {
        values[k] = a + (b-a) * (k-previous)/(i-previous);
      }
    }
    previous = i;
  }
  if (previous < 0) return identityCurve();
  for (let i=previous+1; i<NODES; i++) values[i] = values[previous];
  return isotonic(values, Array.from(mass, value => Math.max(value, .1)))
    .map(value => Math.round(value * WHITE));
}

function sampleTarget(cube, naturalSlot, grid=13) {
  const samples = [];
  const targetStage = [];
  const weights = [];
  const add = (rgb, weight) => {
    const desired = evaluateCube(cube, rgb);
    const base = nativeStageAt(naturalSlot, rgb);
    samples.push(rgb);
    targetStage.push(desired.map((value, channel) =>
      clamp01(value - rgb[channel] + base[channel])));
    weights.push(weight);
  };
  for (let b=0; b<grid; b++) {
    for (let g=0; g<grid; g++) {
      for (let r=0; r<grid; r++) {
        add([r/(grid-1),g/(grid-1),b/(grid-1)], 1);
      }
    }
  }
  for (let i=0; i<256; i++) {
    const value = i / 255;
    add([value,value,value], 12);
  }
  return {samples,targetStage,weights};
}

function mixedValues(matrix, samples) {
  return samples.map(sample => matrix.map(row => clamp01(
    (row[0]*sample[0] + row[1]*sample[1] + row[2]*sample[2]) / 256)));
}

export function fitCubeQuick(cube, naturalSlot, cameraModel='k1ii') {
  const sampled = sampleTarget(cube, naturalSlot);
  const samples = sampled.samples;
  const targetStage = sampled.targetStage;
  const weights = sampled.weights;
  const naturalCurves = naturalSlot.curves.map(curve =>
    curve.map(value => clamp01(value / WHITE)));
  let targetPre = targetStage.map(row =>
    row.map((value, channel) => inverseCurve(naturalCurves[channel], value)));
  let matrix = fitMatrix(samples, targetPre, weights);
  let curves = naturalSlot.curves.map(row => row.slice());
  for (let iteration=0; iteration<2; iteration++) {
    const mixed = mixedValues(matrix, samples);
    curves = [0,1,2].map(channel => fitCurve(
      mixed.map(row => row[channel]),
      targetStage.map(row => row[channel]),
      weights));
    const normalized = curves.map(curve => curve.map(value => clamp01(value / WHITE)));
    targetPre = targetStage.map(row =>
      row.map((value, channel) => inverseCurve(normalized[channel], value)));
    matrix = fitMatrix(samples, targetPre, weights);
  }
  const mixed = mixedValues(matrix, samples);
  curves = [0,1,2].map(channel => fitCurve(
    mixed.map(row => row[channel]),
    targetStage.map(row => row[channel]),
    weights));
  const slot = {
    name: cube.name,
    enabled: true,
    matrix,
    colorBaseMatrix: matrix.map(row=>row.slice()),
    curves,
    masterCurve: identityCurve(),
    preset_key: 'k12:natural',
    matrix_domain: 'natural_relative',
    camera_model: cameraModel,
    brightness_ev: 0,
    contrast: 0,
    color_hue: 0,
    color_sat: 1,
    user_preset_id: '',
    fit_report: {},
    sourceLut: cube,
  };
  let absolute=0;
  let count=0;
  let max=0;
  const validationGrid = 9;
  for (let b=0;b<validationGrid;b++) {
    for (let g=0;g<validationGrid;g++) {
      for (let r=0;r<validationGrid;r++) {
        const rgb=[r/(validationGrid-1),g/(validationGrid-1),b/(validationGrid-1)];
        const truth=evaluateCube(cube,rgb);
        const predicted=applyRelativeProxy(slot,naturalSlot,rgb);
        for(let channel=0;channel<3;channel++){
          const error=Math.abs(truth[channel]-predicted[channel])*255;
          absolute+=error;
          count++;
          max=Math.max(max,error);
        }
      }
    }
  }
  slot.fit_report = {
    rgb_mae_255: absolute / count,
    rgb_max_255: max,
    validation_grid: validationGrid,
    model: 'Web quick Natural-relative Q8 + RGB U14 fit',
  };
  return slot;
}

export function editCurveMonotone(curve, fromIndex, toIndex, toValue) {
  const result = curve.slice();
  const start = Math.max(0, Math.min(NODES-1, Math.round(fromIndex)));
  const end = Math.max(0, Math.min(NODES-1, Math.round(toIndex)));
  const value = clamp01(toValue) * WHITE;
  const original = result[start];
  if (start === end) {
    result[end] = value;
  } else {
    const direction = end > start ? 1 : -1;
    const steps = Math.abs(end-start);
    for (let step=0; step<=steps; step++) {
      const index = start + direction*step;
      result[index] = original + (value-original) * step/steps;
    }
  }
  for(let i=1;i<NODES;i++) result[i]=Math.max(result[i],result[i-1]);
  for(let i=0;i<NODES;i++) result[i]=Math.round(Math.max(0,Math.min(WHITE,result[i])));
  return result;
}

function curveDict(values) {
  return {
    values: values.map(Number),
    nodes: 256,
    interpolation: 'natural_relative',
    display_curve: null,
    points: [],
    base_values: null,
  };
}

export function projectJson(slots, cameraModel='k1ii') {
  return {
    schema: 1,
    slots: slots.map(slot => ({
      name: slot.name || 'CUST',
      enabled: Boolean(slot.enabled),
      matrix: slot.matrix.map(row => row.map(value => Math.round(value))),
      channels: slot.curves.map(curveDict),
      master: curveDict(identityCurve()),
      curve_active: true,
      preset_key: slot.preset_key || 'k12:natural',
      color_hue: 0,
      color_sat: 1,
      brightness_ev: Number(slot.brightness_ev || 0),
      contrast: Number(slot.contrast || 0),
      user_preset_id: '',
      camera_model: cameraModel,
      fit_report: {...(slot.fit_report || {}), exported_by: 'Pentax Labs Web'},
      matrix_domain: slot.matrix_domain || 'natural_relative',
    })),
    four_season: {enabled:false,count:0},
    source_hint: {origin:'Pentax Labs Web', note:'No firmware/runtime binary embedded'},
    camera_model: cameraModel,
  };
}

export function parameterJson(slot, cameraModel='k1ii') {
  return {
    schema: 1,
    generator: 'Pentax Labs Web',
    camera_model: cameraModel,
    name: slot.name,
    matrix_q8: slot.matrix.map(row => row.map(value => Math.round(value))),
    curve_u14: slot.curves.map(row => row.map(value => Math.round(value))),
    matrix_domain: slot.matrix_domain || 'natural_relative',
    brightness_ev: Number(slot.brightness_ev || 0),
    contrast: Number(slot.contrast || 0),
    fit_report: slot.fit_report || {},
    note: 'Parameter-only package. Camera P/R runtime is intentionally not embedded in the public web build.',
  };
}

export function cubeTextFromSlot(slot, naturalSlot, size=33) {
  if (![17,33,65].includes(Number(size))) throw Error('LUT 网格仅支持 17 / 33 / 65');
  const count = Number(size);
  const clean = (slot.name || 'Pentax Labs Web').replaceAll('"', "'");
  const lines = [
    'TITLE "' + clean + '"',
    '# Pentax Labs Web / Natural-relative Q8 + RGB U14 preview proxy',
    '# This is a display LUT for the web parameter model, not a RAW/ISP reconstruction.',
    'LUT_3D_SIZE ' + count,
    'DOMAIN_MIN 0.000000 0.000000 0.000000',
    'DOMAIN_MAX 1.000000 1.000000 1.000000',
  ];
  for(let b=0;b<count;b++) {
    for(let g=0;g<count;g++) {
      for(let r=0;r<count;r++){
        const rgb=[r/(count-1),g/(count-1),b/(count-1)];
        lines.push(applyRelativeProxy(slot,naturalSlot,rgb)
          .map(value=>value.toFixed(9)).join(' '));
      }
    }
  }
  return lines.join('\n') + '\n';
}
