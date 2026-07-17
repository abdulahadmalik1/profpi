// profpi — Equation Finder (Regression Calculator) script

document.addEventListener('DOMContentLoaded', () => {
  const tbody = document.getElementById('points-tbody');
  const addRowBtn = document.getElementById('add-row-btn');
  const clearRowsBtn = document.getElementById('clear-rows-btn');
  const fitBtn = document.getElementById('fit-btn');
  const modelSelect = document.getElementById('fit-model-select');
  
  const errorAlert = document.getElementById('error-alert');
  const chartWrapper = document.getElementById('chart-wrapper');
  const formulaOutput = document.getElementById('formula-output');
  const modelTypeOutput = document.getElementById('model-type-output');
  const r2Output = document.getElementById('r2-output');

  // Preloaded coordinates (excellent default example)
  const initialPoints = [
    { x: 1, y: 3.2 },
    { x: 2, y: 6.1 },
    { x: 3, y: 8.9 },
    { x: 4, y: 12.1 },
    { x: 5, y: 15.0 }
  ];

  function createRow(xVal = '', yVal = '') {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><input type="number" step="any" class="point-x input-control" value="${xVal}" style="padding:6px 10px;" aria-label="X coordinate"></td>
      <td><input type="number" step="any" class="point-y input-control" value="${yVal}" style="padding:6px 10px;" aria-label="Y coordinate"></td>
      <td>
        <button class="btn-delete" type="button" title="Delete Point">
          <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </td>
    `;
    tr.querySelector('.btn-delete').addEventListener('click', () => {
      tr.remove();
    });
    tbody.appendChild(tr);
  }

  // Populate default coordinates
  initialPoints.forEach(p => createRow(p.x, p.y));

  addRowBtn.addEventListener('click', () => createRow());
  clearRowsBtn.addEventListener('click', () => {
    tbody.innerHTML = '';
    createRow();
  });

  // Solver helper functions
  function getPoints() {
    const points = [];
    const rows = tbody.querySelectorAll('tr');
    rows.forEach(row => {
      const xInput = row.querySelector('.point-x');
      const yInput = row.querySelector('.point-y');
      if (xInput && yInput && xInput.value !== '' && yInput.value !== '') {
        points.push({ x: parseFloat(xInput.value), y: parseFloat(yInput.value) });
      }
    });
    return points;
  }

  // 3x3 Matrix Equation Solver using Gauss-Jordan (for quadratic fit)
  function solve3x3(A, B) {
    const n = 3;
    for (let i = 0; i < n; i++) {
      // Find pivot
      let maxEl = Math.abs(A[i][i]);
      let maxRow = i;
      for (let k = i + 1; k < n; k++) {
        if (Math.abs(A[k][i]) > maxEl) {
          maxEl = Math.abs(A[k][i]);
          maxRow = k;
        }
      }
      // Swap rows
      for (let k = i; k < n; k++) {
        const tmp = A[maxRow][k];
        A[maxRow][k] = A[i][k];
        A[i][k] = tmp;
      }
      const tmp = B[maxRow];
      B[maxRow] = B[i];
      B[i] = tmp;

      // Make pivot 1
      const c = A[i][i];
      if (Math.abs(c) < 1e-12) return null; // Singular matrix
      for (let k = i; k < n; k++) A[i][k] /= c;
      B[i] /= c;

      // Make other elements in column 0
      for (let k = 0; k < n; k++) {
        if (k !== i) {
          const factor = A[k][i];
          for (let j = i; j < n; j++) A[k][j] -= factor * A[i][j];
          B[k] -= factor * B[i];
        }
      }
    }
    return B; // Returns [a, b, c]
  }

  // Regression Models
  const Models = {
    linear: {
      name: 'Linear',
      fit: (pts) => {
        const n = pts.length;
        let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
        pts.forEach(p => {
          sumX += p.x;
          sumY += p.y;
          sumXY += p.x * p.y;
          sumX2 += p.x * p.x;
        });
        const num = n * sumXY - sumX * sumY;
        const den = n * sumX2 - sumX * sumX;
        if (Math.abs(den) < 1e-12) return null;
        const m = num / den;
        const c = (sumY - m * sumX) / n;
        return {
          eval: (x) => m * x + c,
          eqStr: `y = ${m.toFixed(4)}x ${c >= 0 ? '+' : '-'} ${Math.abs(c).toFixed(4)}`
        };
      }
    },
    quadratic: {
      name: 'Quadratic',
      fit: (pts) => {
        const n = pts.length;
        if (n < 3) return null;
        let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumX3 = 0, sumX4 = 0, sumX2Y = 0;
        pts.forEach(p => {
          const x = p.x;
          const y = p.y;
          const x2 = x * x;
          sumX += x;
          sumY += y;
          sumXY += x * y;
          sumX2 += x2;
          sumX3 += x2 * x;
          sumX4 += x2 * x2;
          sumX2Y += x2 * y;
        });
        const A = [
          [sumX4, sumX3, sumX2],
          [sumX3, sumX2, sumX],
          [sumX2, sumX, n]
        ];
        const B = [sumX2Y, sumXY, sumY];
        const coeffs = solve3x3(A, B);
        if (!coeffs) return null;
        const [a, b, c] = coeffs;
        return {
          eval: (x) => a * x * x + b * x + c,
          eqStr: `y = ${a.toFixed(4)}x² ${b >= 0 ? '+' : '-'} ${Math.abs(b).toFixed(4)}x ${c >= 0 ? '+' : '-'} ${Math.abs(c).toFixed(4)}`
        };
      }
    },
    exponential: {
      name: 'Exponential',
      fit: (pts) => {
        const n = pts.length;
        // Exponential regression requires all y > 0
        if (pts.some(p => p.y <= 0)) return null;
        let sumX = 0, sumYLine = 0, sumXYLine = 0, sumX2 = 0;
        pts.forEach(p => {
          const yLine = Math.log(p.y);
          sumX += p.x;
          sumYLine += yLine;
          sumXYLine += p.x * yLine;
          sumX2 += p.x * p.x;
        });
        const num = n * sumXYLine - sumX * sumYLine;
        const den = n * sumX2 - sumX * sumX;
        if (Math.abs(den) < 1e-12) return null;
        const B = num / den;
        const A = (sumYLine - B * sumX) / n;
        const a = Math.exp(A);
        return {
          eval: (x) => a * Math.exp(B * x),
          eqStr: `y = ${a.toFixed(4)} · e^(${B.toFixed(4)}x)`
        };
      }
    },
    logarithmic: {
      name: 'Logarithmic',
      fit: (pts) => {
        const n = pts.length;
        // Logarithmic regression requires all x > 0
        if (pts.some(p => p.x <= 0)) return null;
        let sumXLine = 0, sumY = 0, sumXLineY = 0, sumXLine2 = 0;
        pts.forEach(p => {
          const xLine = Math.log(p.x);
          sumXLine += xLine;
          sumY += p.y;
          sumXLineY += xLine * p.y;
          sumXLine2 += xLine * xLine;
        });
        const num = n * sumXLineY - sumXLine * sumY;
        const den = n * sumXLine2 - sumXLine * sumXLine;
        if (Math.abs(den) < 1e-12) return null;
        const a = num / den;
        const b = (sumY - a * sumXLine) / n;
        return {
          eval: (x) => a * Math.log(x) + b,
          eqStr: `y = ${a.toFixed(4)} · ln(x) ${b >= 0 ? '+' : '-'} ${Math.abs(b).toFixed(4)}`
        };
      }
    }
  };

  function computeR2(pts, modelEval) {
    const n = pts.length;
    let sumY = 0;
    pts.forEach(p => sumY += p.y);
    const meanY = sumY / n;

    let ssTot = 0, ssRes = 0;
    pts.forEach(p => {
      const predY = modelEval(p.x);
      ssTot += (p.y - meanY) ** 2;
      ssRes += (p.y - predY) ** 2;
    });

    if (ssTot === 0) return 1; // Collinear flat points
    return 1 - (ssRes / ssTot);
  }

  // Draw chart output using SVG
  function drawChart(pts, modelFit) {
    chartWrapper.innerHTML = '';
    
    // Bounds calculations
    let minX = Math.min(...pts.map(p => p.x));
    let maxX = Math.max(...pts.map(p => p.x));
    let minY = Math.min(...pts.map(p => p.y));
    let maxY = Math.max(...pts.map(p => p.y));

    // Pad bounds so points don't hug borders
    let dx = maxX - minX || 2;
    let dy = maxY - minY || 2;
    minX -= dx * 0.15;
    maxX += dx * 0.15;
    minY -= dy * 0.15;
    maxY += dy * 0.15;

    const width = 450;
    const height = 300;

    const mapX = (x) => ((x - minX) / (maxX - minX)) * (width - 60) + 40;
    const mapY = (y) => height - 30 - ((y - minY) / (maxY - minY)) * (height - 50);

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.style.width = '100%';
    svg.style.height = 'auto';
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', `Regression curve fitting chart displaying plotted points and the calculated best fit line`);

    // Gridlines & Axes
    const gridG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    gridG.setAttribute('stroke', 'var(--border-color)');
    gridG.setAttribute('stroke-width', '1');
    gridG.setAttribute('opacity', '0.5');

    // Draw horizontal grid lines
    for (let i = 0; i <= 4; i++) {
      const gy = minY + (i / 4) * (maxY - minY);
      const sy = mapY(gy);
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', '40');
      line.setAttribute('y1', String(sy));
      line.setAttribute('x2', String(width - 20));
      line.setAttribute('y2', String(sy));
      gridG.appendChild(line);

      // Labels Y
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', '10');
      text.setAttribute('y', String(sy + 4));
      text.setAttribute('fill', 'var(--text-muted)');
      text.style.fontSize = '10px';
      text.style.fontFamily = 'sans-serif';
      text.textContent = gy.toFixed(1);
      svg.appendChild(text);
    }

    // Draw vertical grid lines
    for (let i = 0; i <= 4; i++) {
      const gx = minX + (i / 4) * (maxX - minX);
      const sx = mapX(gx);
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', String(sx));
      line.setAttribute('y1', '20');
      line.setAttribute('x2', String(sx));
      line.setAttribute('y2', String(height - 30));
      gridG.appendChild(line);

      // Labels X
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', String(sx - 10));
      text.setAttribute('y', String(height - 12));
      text.setAttribute('fill', 'var(--text-muted)');
      text.style.fontSize = '10px';
      text.style.fontFamily = 'sans-serif';
      text.textContent = gx.toFixed(1);
      svg.appendChild(text);
    }
    svg.appendChild(gridG);

    // Draw fitted curve line
    if (modelFit) {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      let d = '';
      let isFirst = true;

      // Evaluate 150 points along the visible viewport to draw a smooth curve
      for (let i = 0; i <= 150; i++) {
        const x = minX + (i / 150) * (maxX - minX);
        const y = modelFit.eval(x);
        if (isNaN(y) || !isFinite(y)) continue;
        const sx = mapX(x);
        const sy = mapY(y);

        // Clip to graph view
        if (sy >= 20 && sy <= height - 30) {
          if (isFirst) {
            d += `M ${sx} ${sy}`;
            isFirst = false;
          } else {
            d += ` L ${sx} ${sy}`;
          }
        }
      }
      path.setAttribute('d', d);
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', 'var(--accent)');
      path.setAttribute('stroke-width', '3');
      path.setAttribute('stroke-linecap', 'round');
      svg.appendChild(path);
    }

    // Draw data points as dots
    pts.forEach(p => {
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', String(mapX(p.x)));
      circle.setAttribute('cy', String(mapY(p.y)));
      circle.setAttribute('r', '5');
      circle.setAttribute('fill', '#06b6d4');
      circle.setAttribute('stroke', 'var(--card-bg)');
      circle.setAttribute('stroke-width', '1.5');
      svg.appendChild(circle);
    });

    chartWrapper.appendChild(svg);
  }

  function handleFit() {
    errorAlert.style.display = 'none';
    const points = getPoints();

    if (points.length < 2) {
      showError('Please enter at least 2 coordinate points to fit an equation.');
      return;
    }

    const selectedModelKey = modelSelect.value;
    let finalModel = null;
    let finalKey = '';
    let maxR2 = -Infinity;

    if (selectedModelKey === 'auto') {
      // Loop over models to find the highest R2 coefficient
      Object.keys(Models).forEach(key => {
        const fitted = Models[key].fit(points);
        if (fitted) {
          const r2 = computeR2(points, fitted.eval);
          // R2 caps at 1. We look for the one closest to 1.
          if (r2 > maxR2) {
            maxR2 = r2;
            finalModel = fitted;
            finalKey = key;
          }
        }
      });
      if (!finalModel) {
        showError('No suitable regression model could fit these points.');
        return;
      }
    } else {
      finalModel = Models[selectedModelKey].fit(points);
      if (!finalModel) {
        showError(`This data cannot be fitted with a ${Models[selectedModelKey].name} model (e.g. logarithmic models require X > 0, exponential requires Y > 0).`);
        return;
      }
      maxR2 = computeR2(points, finalModel.eval);
      finalKey = selectedModelKey;
    }

    // Update Output displays
    formulaOutput.textContent = finalModel.eqStr;
    modelTypeOutput.textContent = Models[finalKey].name;
    r2Output.textContent = isNaN(maxR2) ? '1.000' : maxR2.toFixed(4);

    // Draw SVG Chart
    drawChart(points, finalModel);
  }

  function showError(msg) {
    errorAlert.textContent = msg;
    errorAlert.style.display = 'block';
    window.scrollTo({ top: errorAlert.offsetTop - 100, behavior: 'smooth' });
  }

  fitBtn.addEventListener('click', handleFit);
  
  // Initial draw
  handleFit();
});
