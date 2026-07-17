// profpi — Unit Circle Explorer script

document.addEventListener('DOMContentLoaded', () => {
  const angleDegInput = document.getElementById('angle-deg');
  const angleRadInput = document.getElementById('angle-rad');
  const snapBtns = document.querySelectorAll('.snap-btn');
  
  const trigTbody = document.getElementById('trig-tbody');
  const wrapper = document.getElementById('unit-circle-wrapper');
  const errorAlert = document.getElementById('error-alert');

  let currentAngle = 45; // Degrees

  // Exact math representations for common angles
  const COMMON_TRIG = {
    0:   { sin: '0',           cos: '1',           tan: '0',           csc: 'Undefined',   sec: '1',           cot: 'Undefined',   rad: '0' },
    30:  { sin: '1/2',         cos: '√3/2',        tan: '√3/3',        csc: '2',           sec: '2√3/3',       cot: '√3',          rad: 'π/6' },
    45:  { sin: '√2/2',        cos: '√2/2',        tan: '1',           csc: '√2',          sec: '√2',          cot: '1',           rad: 'π/4' },
    60:  { sin: '√3/2',        cos: '1/2',         tan: '√3',          csc: '2√3/3',       sec: '2',           cot: '√3/3',        rad: 'π/3' },
    90:  { sin: '1',           cos: '0',           tan: 'Undefined',   csc: '1',           sec: 'Undefined',   cot: '0',           rad: 'π/2' },
    120: { sin: '√3/2',        cos: '-1/2',        tan: '-√3',         csc: '2√3/3',       sec: '-2',          cot: '-√3/3',       rad: '2π/3' },
    135: { sin: '√2/2',        cos: '-√2/2',       tan: '-1',          csc: '√2',          sec: '-√2',         cot: '-1',          rad: '3π/4' },
    150: { sin: '1/2',         cos: '-√3/2',       tan: '-√3/3',       csc: '2',           sec: '-2√3/3',      cot: '-√3',         rad: '5π/6' },
    180: { sin: '0',           cos: '-1',          tan: '0',           csc: 'Undefined',   sec: '-1',          cot: 'Undefined',   rad: 'π' },
    210: { sin: '-1/2',        cos: '-√3/2',       tan: '√3/3',        csc: '-2',          sec: '-2√3/3',      cot: '√3',          rad: '7π/6' },
    225: { sin: '-√2/2',       cos: '-√2/2',       tan: '1',           csc: '-√2',         sec: '-√2',         cot: '1',           rad: '5π/4' },
    240: { sin: '-√3/2',       cos: '-1/2',        tan: '√3',          csc: '-2√3/3',      sec: '-2',          cot: '√3/3',        rad: '4π/3' },
    270: { sin: '-1',          cos: '0',           tan: 'Undefined',   csc: '-1',          sec: 'Undefined',   cot: '0',           rad: '3π/2' },
    300: { sin: '-√3/2',       cos: '1/2',         tan: '-√3',         csc: '-2√3/3',      sec: '2',           cot: '-√3/3',       rad: '5π/3' },
    315: { sin: '-√2/2',       cos: '√2/2',        tan: '-1',          csc: '-√2',         sec: '√2',          cot: '-1',          rad: '7π/4' },
    330: { sin: '-1/2',        cos: '√3/2',        tan: '-√3/3',       csc: '-2',          sec: '2√3/3',       cot: '-√3',         rad: '11π/6' },
    360: { sin: '0',           cos: '1',           tan: '0',           csc: 'Undefined',   sec: '1',           cot: 'Undefined',   rad: '2π' }
  };

  // Convert decimal angle to nice fraction format of pi
  function degToPiFrac(deg) {
    deg = ((deg % 360) + 360) % 360;
    if (deg === 0) return '0';
    if (COMMON_TRIG[deg]) return COMMON_TRIG[deg].rad;
    const radVal = (deg * Math.PI) / 180;
    return `${radVal.toFixed(3)} rad`;
  }

  // Draw Circle Canvas
  function drawUnitCircle() {
    wrapper.innerHTML = '';

    const width = 320;
    const height = 320;
    const cx = 160;
    const cy = 160;
    const r = 100; // Visual radius mapping unit circle 1.0

    const rad = (currentAngle * Math.PI) / 180;
    const px = cx + r * Math.cos(rad);
    const py = cy - r * Math.sin(rad); // Flip Y coordinate

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.style.width = '100%';
    svg.style.height = 'auto';
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', `Interactive unit circle diagram at angle ${currentAngle} degrees, showing cosine at ${Math.cos(rad).toFixed(2)} and sine at ${Math.sin(rad).toFixed(2)}`);

    // 1. Grid Axes
    const axesG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    axesG.setAttribute('stroke', 'var(--border-color)');
    axesG.setAttribute('stroke-width', '1.5');
    
    // X Axis
    const xAxis = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    xAxis.setAttribute('x1', '20'); xAxis.setAttribute('y1', String(cy));
    xAxis.setAttribute('x2', String(width - 20)); xAxis.setAttribute('y2', String(cy));
    axesG.appendChild(xAxis);

    // Y Axis
    const yAxis = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    yAxis.setAttribute('x1', String(cx)); yAxis.setAttribute('y1', '20');
    yAxis.setAttribute('x2', String(cx)); yAxis.setAttribute('y2', String(height - 20));
    axesG.appendChild(yAxis);
    svg.appendChild(axesG);

    // 2. Unit Circle Boundary
    const boundary = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    boundary.setAttribute('cx', String(cx));
    boundary.setAttribute('cy', String(cy));
    boundary.setAttribute('r', String(r));
    boundary.setAttribute('fill', 'none');
    boundary.setAttribute('stroke', 'var(--text-muted)');
    boundary.setAttribute('stroke-width', '2');
    boundary.setAttribute('opacity', '0.6');
    svg.appendChild(boundary);

    // 3. Highlight projection lines (Sine: vertical, Cosine: horizontal)
    // Cosine line (horizontal on X axis)
    const cosLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    cosLine.setAttribute('x1', String(cx));
    cosLine.setAttribute('y1', String(cy));
    cosLine.setAttribute('x2', String(px));
    cosLine.setAttribute('y2', String(cy));
    cosLine.setAttribute('stroke', '#06b6d4'); // Cyan for cosine
    cosLine.setAttribute('stroke-width', '3');
    svg.appendChild(cosLine);

    // Sine line (vertical from terminal point to X axis)
    const sinLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    sinLine.setAttribute('x1', String(px));
    sinLine.setAttribute('y1', String(cy));
    sinLine.setAttribute('x2', String(px));
    sinLine.setAttribute('y2', String(py));
    sinLine.setAttribute('stroke', '#ef4444'); // Red for sine
    sinLine.setAttribute('stroke-width', '3');
    svg.appendChild(sinLine);

    // 4. Terminal Ray
    const ray = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    ray.setAttribute('x1', String(cx));
    ray.setAttribute('y1', String(cy));
    ray.setAttribute('x2', String(px));
    ray.setAttribute('y2', String(py));
    ray.setAttribute('stroke', 'var(--accent)');
    ray.setAttribute('stroke-width', '2.5');
    svg.appendChild(ray);

    // 5. Angle Arc
    if (currentAngle > 0) {
      const arc = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      const largeArc = currentAngle > 180 ? 1 : 0;
      const arcR = 25;
      const ax = cx + arcR;
      const ay = cy;
      const endX = cx + arcR * Math.cos(rad);
      const endY = cy - arcR * Math.sin(rad);
      
      const d = `M ${cx} ${cy} L ${ax} ${ay} A ${arcR} ${arcR} 0 ${largeArc} 0 ${endX} ${endY} Z`;
      arc.setAttribute('d', d);
      arc.setAttribute('fill', 'var(--danger-bg)');
      arc.setAttribute('opacity', '0.6');
      svg.appendChild(arc);
    }

    // 6. Terminal point
    const pt = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    pt.setAttribute('cx', String(px));
    pt.setAttribute('cy', String(py));
    pt.setAttribute('r', '6');
    pt.setAttribute('fill', 'var(--border-focus)');
    pt.setAttribute('stroke', 'var(--card-bg)');
    pt.setAttribute('stroke-width', '2');
    svg.appendChild(pt);

    // 7. Coordinates text label
    const coordsText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    const labelOffsetDirX = Math.cos(rad) >= 0 ? 1 : -1;
    const labelOffsetDirY = Math.sin(rad) >= 0 ? -1 : 1;
    coordsText.setAttribute('x', String(px + 12 * labelOffsetDirX));
    coordsText.setAttribute('y', String(py + 10 * labelOffsetDirY));
    coordsText.setAttribute('text-anchor', labelOffsetDirX >= 0 ? 'start' : 'end');
    coordsText.setAttribute('fill', 'var(--text-main)');
    coordsText.style.fontSize = '12px';
    coordsText.style.fontWeight = '700';
    coordsText.style.fontFamily = 'monospace';
    coordsText.textContent = `(${Math.cos(rad).toFixed(2)}, ${Math.sin(rad).toFixed(2)})`;
    svg.appendChild(coordsText);

    wrapper.appendChild(svg);

    // 8. Event listener for interaction
    function updateAngleFromCoords(clientX, clientY) {
      const rect = svg.getBoundingClientRect();
      const x = clientX - rect.left - (rect.width / 2);
      const y = (rect.height / 2) - (clientY - rect.top);
      
      let angle = Math.atan2(y, x) * (180 / Math.PI);
      angle = (angle + 360) % 360;
      
      currentAngle = parseFloat(angle.toFixed(1));
      updateDisplay();
    }

    let isDragging = false;
    
    svg.addEventListener('mousedown', (e) => {
      isDragging = true;
      updateAngleFromCoords(e.clientX, e.clientY);
    });

    window.addEventListener('mousemove', (e) => {
      if (isDragging) {
        updateAngleFromCoords(e.clientX, e.clientY);
      }
    });

    window.addEventListener('mouseup', () => {
      isDragging = false;
    });

    // Touch support
    svg.addEventListener('touchstart', (e) => {
      isDragging = true;
      if (e.touches.length > 0) {
        updateAngleFromCoords(e.touches[0].clientX, e.touches[0].clientY);
      }
    });

    svg.addEventListener('touchmove', (e) => {
      if (isDragging && e.touches.length > 0) {
        updateAngleFromCoords(e.touches[0].clientX, e.touches[0].clientY);
      }
    });

    svg.addEventListener('touchend', () => {
      isDragging = false;
    });
  }

  // Update textual data outputs
  function updateDisplay() {
    errorAlert.style.display = 'none';

    // Fields
    angleDegInput.value = currentAngle;
    angleRadInput.value = degToPiFrac(currentAngle);

    // Truncate decimals for exact ratio check
    const intAngle = Math.round(currentAngle);
    const isCommon = Math.abs(currentAngle - intAngle) < 1e-9 && COMMON_TRIG[intAngle];
    const commonObj = isCommon ? COMMON_TRIG[intAngle] : null;

    const rad = (currentAngle * Math.PI) / 180;

    const sinVal = Math.sin(rad);
    const cosVal = Math.cos(rad);
    const tanVal = Math.abs(cosVal) < 1e-9 ? 'Undefined' : Math.tan(rad);
    const cscVal = Math.abs(sinVal) < 1e-9 ? 'Undefined' : 1 / sinVal;
    const secVal = Math.abs(cosVal) < 1e-9 ? 'Undefined' : 1 / cosVal;
    const cotVal = Math.abs(sinVal) < 1e-9 ? 'Undefined' : 1 / Math.tan(rad);

    function fmtVal(key, val) {
      if (commonObj) return commonObj[key];
      if (val === 'Undefined') return 'Undefined';
      return val.toFixed(4);
    }

    trigTbody.innerHTML = `
      <tr><td>sin(θ) [y]</td><td>${fmtVal('sin', sinVal)}</td></tr>
      <tr><td>cos(θ) [x]</td><td>${fmtVal('cos', cosVal)}</td></tr>
      <tr><td>tan(θ) [y/x]</td><td>${fmtVal('tan', typeof tanVal === 'number' ? tanVal : 'Undefined')}</td></tr>
      <tr><td>csc(θ) [1/y]</td><td>${fmtVal('csc', typeof cscVal === 'number' ? cscVal : 'Undefined')}</td></tr>
      <tr><td>sec(θ) [1/x]</td><td>${fmtVal('sec', typeof secVal === 'number' ? secVal : 'Undefined')}</td></tr>
      <tr><td>cot(θ) [x/y]</td><td>${fmtVal('cot', typeof cotVal === 'number' ? cotVal : 'Undefined')}</td></tr>
    `;

    // Redraw SVG diagram
    drawUnitCircle();
  }

  // Bind inputs
  angleDegInput.addEventListener('input', () => {
    let val = parseFloat(angleDegInput.value);
    if (!isNaN(val)) {
      // Allow bounds check
      val = ((val % 360) + 360) % 360;
      currentAngle = val;
      updateDisplay();
    }
  });

  // Bind snaps
  snapBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      currentAngle = parseFloat(btn.getAttribute('data-angle'));
      updateDisplay();
    });
  });

  // Initial render
  updateDisplay();
});
