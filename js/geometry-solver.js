// profpi — Geometry Solver script

document.addEventListener('DOMContentLoaded', () => {
  // Shape buttons
  const btnTri = document.getElementById('btn-shape-triangle');
  const btnCir = document.getElementById('btn-shape-circle');
  const btnRec = document.getElementById('btn-shape-rectangle');

  // Input sections
  const secTri = document.getElementById('inputs-triangle');
  const secCir = document.getElementById('inputs-circle');
  const secRec = document.getElementById('inputs-rectangle');

  // Fields & Buttons
  const triMethod = document.getElementById('tri-method-select');
  const solveBtn = document.getElementById('solve-btn');
  const errorAlert = document.getElementById('error-alert');
  const resultsTbody = document.getElementById('results-tbody');
  const diagramWrapper = document.getElementById('diagram-wrapper');

  const btnSvg = document.getElementById('btn-download-svg');
  const btnPng = document.getElementById('btn-download-png');

  let activeShape = 'triangle'; // 'triangle', 'circle', 'rectangle'

  // Input method adjustments for Triangles
  function adjustTriangleLabels() {
    const method = triMethod.value;
    const triA = document.getElementById('tri-a');
    const triB = document.getElementById('tri-b');
    const triC = document.getElementById('tri-c');

    const lblA = document.getElementById('lbl-tri-a');
    const lblB = document.getElementById('lbl-tri-b');
    const lblC = document.getElementById('lbl-tri-c');

    if (method === 'SSS') {
      lblA.textContent = 'Side a'; triA.value = '3';
      lblB.textContent = 'Side b'; triB.value = '4';
      lblC.textContent = 'Side c'; triC.value = '5';
    } else if (method === 'SAS') {
      lblA.textContent = 'Side a'; triA.value = '5';
      lblB.textContent = 'Angle C (°)'; triB.value = '60';
      lblC.textContent = 'Side b'; triC.value = '7';
    } else if (method === 'ASA') {
      lblA.textContent = 'Angle A (°)'; triA.value = '45';
      lblB.textContent = 'Side c'; triB.value = '10';
      lblC.textContent = 'Angle B (°)'; triC.value = '60';
    } else if (method === 'AAS') {
      lblA.textContent = 'Angle A (°)'; triA.value = '30';
      lblB.textContent = 'Angle B (°)'; triB.value = '80';
      lblC.textContent = 'Side a'; triC.value = '8';
    }
  }

  triMethod.addEventListener('change', adjustTriangleLabels);

  // Shape button click toggles
  btnTri.addEventListener('click', () => {
    setActiveShape('triangle', btnTri, secTri);
  });
  btnCir.addEventListener('click', () => {
    setActiveShape('circle', btnCir, secCir);
  });
  btnRec.addEventListener('click', () => {
    setActiveShape('rectangle', btnRec, secRec);
  });

  function setActiveShape(shape, btn, section) {
    activeShape = shape;
    [btnTri, btnCir, btnRec].forEach(b => b.classList.remove('active'));
    [secTri, secCir, secRec].forEach(s => s.classList.remove('active'));
    btn.classList.add('active');
    section.classList.add('active');
    errorAlert.style.display = 'none';
  }

  // Helper solvers
  function solveTriangle(method, valA, valB, valC) {
    let a, b, c, A, B, C; // Sides and angles in radians
    const toRad = Math.PI / 180;
    const toDeg = 180 / Math.PI;

    if (method === 'SSS') {
      a = valA; b = valB; c = valC;
      if (a + b <= c || a + c <= b || b + c <= a) return null; // Triangle inequality check
      C = Math.acos((a * a + b * b - c * c) / (2 * a * b));
      B = Math.acos((a * a + c * c - b * b) / (2 * a * c));
      A = Math.PI - B - C;
    } else if (method === 'SAS') {
      a = valA; C = valB * toRad; b = valC;
      if (C >= Math.PI) return null;
      c = Math.sqrt(a * a + b * b - 2 * a * b * Math.cos(C));
      A = Math.acos((b * b + c * c - a * a) / (2 * b * c));
      B = Math.PI - A - C;
    } else if (method === 'ASA') {
      A = valA * toRad; c = valB; B = valC * toRad;
      if (A + B >= Math.PI) return null;
      C = Math.PI - A - B;
      a = (c * Math.sin(A)) / Math.sin(C);
      b = (c * Math.sin(B)) / Math.sin(C);
    } else if (method === 'AAS') {
      A = valA * toRad; B = valB * toRad; a = valC;
      if (A + B >= Math.PI) return null;
      C = Math.PI - A - B;
      b = (a * Math.sin(B)) / Math.sin(A);
      c = (a * Math.sin(C)) / Math.sin(A);
    }

    const s = (a + b + c) / 2;
    const area = Math.sqrt(s * (s - a) * (s - b) * (s - c));
    const perimeter = a + b + c;
    const inradius = area / s;
    const circumradius = (a * b * c) / (4 * area);

    return {
      a, b, c,
      A: A * toDeg, B: B * toDeg, C: C * toDeg,
      area, perimeter, inradius, circumradius
    };
  }

  function solveCircle(type, val) {
    let r, d, circumference, area;
    if (type === 'radius') r = val;
    else if (type === 'diameter') r = val / 2;
    else if (type === 'circumference') r = val / (2 * Math.PI);
    else if (type === 'area') r = Math.sqrt(val / Math.PI);

    if (r <= 0) return null;
    d = r * 2;
    circumference = 2 * Math.PI * r;
    area = Math.PI * r * r;

    return { r, d, circumference, area };
  }

  function solveRectangle(w, h) {
    if (w <= 0 || h <= 0) return null;
    const area = w * h;
    const perimeter = 2 * (w + h);
    const diagonal = Math.sqrt(w * w + h * h);
    return { w, h, area, perimeter, diagonal };
  }

  // Layout rendering results
  function renderResults(props) {
    resultsTbody.innerHTML = '';
    Object.keys(props).forEach(key => {
      const row = document.createElement('tr');
      let name = key;
      let val = props[key];

      // Format name nicely
      if (key === 'a') name = 'Side a';
      else if (key === 'b') name = 'Side b';
      else if (key === 'c') name = 'Side c';
      else if (key === 'A') name = 'Angle A';
      else if (key === 'B') name = 'Angle B';
      else if (key === 'C') name = 'Angle C';
      else if (key === 'r') name = 'Radius';
      else if (key === 'd') name = 'Diameter';
      else if (key === 'w') name = 'Width';
      else if (key === 'h') name = 'Height';
      
      const formattedVal = (key === 'A' || key === 'B' || key === 'C') ? `${val.toFixed(2)}°` : val.toFixed(4);

      row.innerHTML = `
        <td>${name.charAt(0).toUpperCase() + name.slice(1)}</td>
        <td>${formattedVal}</td>
      `;
      resultsTbody.appendChild(row);
    });
  }

  // Draw diagrams in SVG
  function drawTriangle(res) {
    const width = 360;
    const height = 240;
    const padding = 30;

    // Calculate vertex coordinates: A at (0, 0), B along x-axis at (c, 0), C at (b*cos(A), b*sin(A))
    const A_rad = res.A * (Math.PI / 180);
    const ax = 0;
    const ay = 0;
    const bx = res.c;
    const by = 0;
    const cx = res.b * Math.cos(A_rad);
    const cy = res.b * Math.sin(A_rad);

    // Scaling to fit the viewport padding box
    const minX = Math.min(ax, bx, cx);
    const maxX = Math.max(ax, bx, cx);
    const minY = Math.min(ay, by, cy);
    const maxY = Math.max(ay, by, cy);

    const scaleX = (width - padding * 2) / (maxX - minX || 1);
    const scaleY = (height - padding * 2) / (maxY - minY || 1);
    const scale = Math.min(scaleX, scaleY);

    // Apply scale and flip Y-axis for screen rendering
    const mapCoords = (x, y) => {
      const sx = padding + (x - minX) * scale;
      const sy = height - padding - (y - minY) * scale;
      return [sx, sy];
    };

    const [ptAx, ptAy] = mapCoords(ax, ay);
    const [ptBx, ptBy] = mapCoords(bx, by);
    const [ptCx, ptCy] = mapCoords(cx, cy);

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', `To-scale triangle diagram with side lengths a=${res.a.toFixed(1)}, b=${res.b.toFixed(1)}, c=${res.c.toFixed(1)} and angles A=${res.A.toFixed(0)}°, B=${res.B.toFixed(0)}°, C=${res.C.toFixed(0)}°`);

    // Fill polygon shape
    const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    poly.setAttribute('points', `${ptAx},${ptAy} ${ptBx},${ptBy} ${ptCx},${ptCy}`);
    poly.setAttribute('fill', 'var(--danger-bg)');
    poly.setAttribute('stroke', 'var(--accent)');
    poly.setAttribute('stroke-width', '2.5');
    poly.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(poly);

    // Helper text renderer
    function drawLabel(x, y, text, isAngle = false) {
      const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      txt.setAttribute('x', String(x));
      txt.setAttribute('y', String(y));
      txt.setAttribute('text-anchor', 'middle');
      txt.setAttribute('fill', isAngle ? 'var(--text-muted)' : 'var(--text-main)');
      txt.style.fontSize = isAngle ? '10px' : '12px';
      txt.style.fontWeight = isAngle ? '500' : '700';
      txt.style.fontFamily = 'sans-serif';
      txt.textContent = text;
      svg.appendChild(txt);
    }

    // Side labels (midpoints offset slightly)
    const midAB_x = (ptAx + ptBx) / 2;
    const midAB_y = (ptAy + ptBy) / 2 + 16;
    drawLabel(midAB_x, midAB_y, `c = ${res.c.toFixed(1)}`);

    const midBC_x = (ptBx + ptCx) / 2 + 16;
    const midBC_y = (ptBy + ptCy) / 2 - 8;
    drawLabel(midBC_x, midBC_y, `a = ${res.a.toFixed(1)}`);

    const midAC_x = (ptAx + ptCx) / 2 - 16;
    const midAC_y = (ptAy + ptCy) / 2 - 8;
    drawLabel(midAC_x, midAC_y, `b = ${res.b.toFixed(1)}`);

    // Vertex angle labels
    drawLabel(ptAx + 18, ptAy - 8, `${res.A.toFixed(0)}°`, true);
    drawLabel(ptBx - 18, ptBy - 8, `${res.B.toFixed(0)}°`, true);
    drawLabel(ptCx, ptCy + 16, `${res.C.toFixed(0)}°`, true);

    diagramWrapper.innerHTML = '';
    diagramWrapper.appendChild(svg);
  }

  function drawCircle(res) {
    const width = 360;
    const height = 240;
    const cx = 180;
    const cy = 120;
    const r = 75;

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', `To-scale circle diagram with radius r=${res.r.toFixed(1)} and diameter d=${res.d.toFixed(1)}`);

    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', String(cx));
    circle.setAttribute('cy', String(cy));
    circle.setAttribute('r', String(r));
    circle.setAttribute('fill', 'var(--danger-bg)');
    circle.setAttribute('stroke', 'var(--accent)');
    circle.setAttribute('stroke-width', '2.5');
    svg.appendChild(circle);

    // Draw radius line
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', String(cx));
    line.setAttribute('y1', String(cy));
    line.setAttribute('x2', String(cx + r));
    line.setAttribute('y2', String(cy));
    line.setAttribute('stroke', 'var(--text-main)');
    line.setAttribute('stroke-width', '2');
    line.setAttribute('stroke-dasharray', '4');
    svg.appendChild(line);

    // Center point indicator
    const centerPt = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    centerPt.setAttribute('cx', String(cx));
    centerPt.setAttribute('cy', String(cy));
    centerPt.setAttribute('r', '3');
    centerPt.setAttribute('fill', 'var(--text-main)');
    svg.appendChild(centerPt);

    // Radius Label
    const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    txt.setAttribute('x', String(cx + r / 2));
    txt.setAttribute('y', String(cy - 8));
    txt.setAttribute('text-anchor', 'middle');
    txt.setAttribute('fill', 'var(--text-main)');
    txt.style.fontSize = '12px';
    txt.style.fontWeight = '700';
    txt.style.fontFamily = 'sans-serif';
    txt.textContent = `r = ${res.r.toFixed(1)}`;
    svg.appendChild(txt);

    diagramWrapper.innerHTML = '';
    diagramWrapper.appendChild(svg);
  }

  function drawRectangle(res) {
    const width = 360;
    const height = 240;

    // Scale rectangle to fit bounds nicely
    const maxDim = Math.max(res.w, res.h);
    const boxW = (res.w / maxDim) * 180;
    const boxH = (res.h / maxDim) * 120;

    const rx = (width - boxW) / 2;
    const ry = (height - boxH) / 2;

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', `To-scale rectangle diagram with width w=${res.w.toFixed(1)} and height h=${res.h.toFixed(1)}`);

    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', String(rx));
    rect.setAttribute('y', String(ry));
    rect.setAttribute('width', String(boxW));
    rect.setAttribute('height', String(boxH));
    rect.setAttribute('fill', 'var(--danger-bg)');
    rect.setAttribute('stroke', 'var(--accent)');
    rect.setAttribute('stroke-width', '2.5');
    rect.setAttribute('rx', '4');
    svg.appendChild(rect);

    // Labels
    function createTxt(x, y, align, val) {
      const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      txt.setAttribute('x', String(x));
      txt.setAttribute('y', String(y));
      txt.setAttribute('text-anchor', align);
      txt.setAttribute('fill', 'var(--text-main)');
      txt.style.fontSize = '12px';
      txt.style.fontWeight = '700';
      txt.style.fontFamily = 'sans-serif';
      txt.textContent = val;
      svg.appendChild(txt);
    }

    createTxt(width / 2, ry - 10, 'middle', `w = ${res.w.toFixed(1)}`);
    createTxt(rx - 10, height / 2 + 4, 'end', `h = ${res.h.toFixed(1)}`);

    diagramWrapper.innerHTML = '';
    diagramWrapper.appendChild(svg);
  }

  // Solver handler
  function handleSolve() {
    errorAlert.style.display = 'none';

    if (activeShape === 'triangle') {
      const method = triMethod.value;
      const valA = parseFloat(document.getElementById('tri-a').value);
      const valB = parseFloat(document.getElementById('tri-b').value);
      const valC = parseFloat(document.getElementById('tri-c').value);

      if (isNaN(valA) || isNaN(valB) || isNaN(valC) || valA <= 0 || valB <= 0 || valC <= 0) {
        showError('Please enter positive values for all fields.');
        return;
      }

      const res = solveTriangle(method, valA, valB, valC);
      if (!res) {
        showError('Invalid Triangle bounds. Check inequality sum (SSS) or angle boundaries.');
        return;
      }
      renderResults(res);
      drawTriangle(res);

    } else if (activeShape === 'circle') {
      const type = document.getElementById('circle-type-select').value;
      const val = parseFloat(document.getElementById('circle-val').value);

      if (isNaN(val) || val <= 0) {
        showError('Please enter a positive value.');
        return;
      }

      const res = solveCircle(type, val);
      if (!res) {
        showError('Computation failed. Please review the input value.');
        return;
      }
      renderResults(res);
      drawCircle(res);

    } else if (activeShape === 'rectangle') {
      const w = parseFloat(document.getElementById('rect-w').value);
      const h = parseFloat(document.getElementById('rect-h').value);

      if (isNaN(w) || isNaN(h) || w <= 0 || h <= 0) {
        showError('Width and Height must be positive numbers.');
        return;
      }

      const res = solveRectangle(w, h);
      renderResults(res);
      drawRectangle(res);
    }
  }

  function showError(msg) {
    errorAlert.textContent = msg;
    errorAlert.style.display = 'block';
    window.scrollTo({ top: errorAlert.offsetTop - 100, behavior: 'smooth' });
  }

  // Image downloading serializers
  function downloadSVG() {
    const svgEl = diagramWrapper.querySelector('svg');
    if (!svgEl) return;
    const serializer = new XMLSerializer();
    const source = serializer.serializeToString(svgEl);
    const blob = new Blob([source], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `profpi_${activeShape}_diagram.svg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function downloadPNG() {
    const svgEl = diagramWrapper.querySelector('svg');
    if (!svgEl) return;

    const canvas = document.createElement('canvas');
    canvas.width = 720; // High-res download
    canvas.height = 480;
    const ctx = canvas.getContext('2d');

    // Serialize SVG XML string
    const serializer = new XMLSerializer();
    const source = serializer.serializeToString(svgEl);
    
    // Inject background box for image canvas export (so grid & shape lines render clearly)
    const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
    const bgFill = currentTheme === 'dark' ? '#0f172a' : '#ffffff';
    const strokeTheme = currentTheme === 'dark' ? '#334155' : '#e2e8f0';

    // We can parse the source XML, inject a background rect to draw on canvas
    const parser = new DOMParser();
    const doc = parser.parseFromString(source, 'image/svg+xml');
    const root = doc.documentElement;
    
    // Background rectangle insertion
    const rect = doc.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('width', '100%');
    rect.setAttribute('height', '100%');
    rect.setAttribute('fill', bgFill);
    root.insertBefore(rect, root.firstChild);

    const serializedSource = serializer.serializeToString(root);
    const blob = new Blob([serializedSource], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const pngUrl = canvas.toDataURL('image/png');
      
      const a = document.createElement('a');
      a.href = pngUrl;
      a.download = `profpi_${activeShape}_diagram.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    };
    img.src = url;
  }

  solveBtn.addEventListener('click', handleSolve);
  btnSvg.addEventListener('click', downloadSVG);
  btnPng.addEventListener('click', downloadPNG);

  // Initial draw
  adjustTriangleLabels();
  handleSolve();
});
