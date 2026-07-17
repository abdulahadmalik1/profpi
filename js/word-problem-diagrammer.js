// profpi — Word Problem Diagrammer (Tape Diagram Maker) script

document.addEventListener('DOMContentLoaded', () => {
  const tbody = document.getElementById('tape-tbody');
  const addRowBtn = document.getElementById('add-row-btn');
  const clearRowsBtn = document.getElementById('clear-rows-btn');
  const drawBtn = document.getElementById('draw-btn');
  
  const totalValueInput = document.getElementById('total-value-input');
  const errorAlert = document.getElementById('error-alert');
  const tapeWrapper = document.getElementById('tape-wrapper');
  
  const resultsCard = document.getElementById('multiplier-details-card');
  const resultsTbody = document.getElementById('tape-results-tbody');

  const btnSvg = document.getElementById('btn-download-svg');
  const btnPng = document.getElementById('btn-download-png');

  // Preloaded default coordinates/problem
  const defaultItems = [
    { label: 'John', parts: 3 },
    { label: 'Mary', parts: 5 }
  ];

  function createRow(lbl = '', parts = '') {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><input type="text" class="bar-label input-control" value="${lbl}" style="padding:6px 10px;" aria-label="Label name"></td>
      <td><input type="number" min="1" class="bar-parts input-control" value="${parts}" style="padding:6px 10px;" aria-label="Parts count"></td>
      <td>
        <button class="btn-delete" type="button" title="Delete Bar">
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

  // Initial populate
  defaultItems.forEach(item => createRow(item.label, item.parts));

  addRowBtn.addEventListener('click', () => createRow());
  clearRowsBtn.addEventListener('click', () => {
    tbody.innerHTML = '';
    createRow();
  });

  function getItems() {
    const items = [];
    tbody.querySelectorAll('tr').forEach(tr => {
      const lblInput = tr.querySelector('.bar-label');
      const partsInput = tr.querySelector('.bar-parts');
      if (lblInput && partsInput && lblInput.value.trim() !== '' && partsInput.value !== '') {
        items.push({
          label: lblInput.value.trim(),
          parts: parseInt(partsInput.value)
        });
      }
    });
    return items;
  }

  function handleDraw() {
    errorAlert.style.display = 'none';
    resultsCard.style.display = 'none';

    const items = getItems();
    if (items.length < 1) {
      showError('Please add at least one bar item details.');
      return;
    }
    if (items.some(item => item.parts <= 0)) {
      showError('Parts values must be positive integers.');
      return;
    }

    const totalValRaw = totalValueInput.value.trim();
    let totalVal = parseFloat(totalValRaw);
    let hasTotal = !isNaN(totalVal) && totalVal > 0;
    
    let sumParts = 0;
    items.forEach(item => sumParts += item.parts);

    let multiplier = 0;
    if (hasTotal) {
      multiplier = totalVal / sumParts;
    }

    // Populate calculations display
    if (hasTotal) {
      resultsTbody.innerHTML = `
        <tr><td>Sum of Parts</td><td>${sumParts} units</td></tr>
        <tr><td>Unit Value (Multiplier)</td><td>${totalVal} &divide; ${sumParts} = <strong>${multiplier.toFixed(2)}</strong></td></tr>
      `;
      items.forEach(item => {
        const itemVal = item.parts * multiplier;
        resultsTbody.innerHTML += `
          <tr><td>Value of <strong>${item.label}</strong></td><td>${item.parts} &times; ${multiplier.toFixed(2)} = <strong>${itemVal.toFixed(2)}</strong></td></tr>
        `;
      });
      resultsCard.style.display = 'block';
    }

    // Create SVG Diagram
    renderTapeSVG(items, sumParts, multiplier, hasTotal);
  }

  function renderTapeSVG(items, sumParts, multiplier, hasTotal) {
    tapeWrapper.innerHTML = '';

    const width = 450;
    // Calculate height dynamically based on number of bars
    const barHeight = 35;
    const barSpacing = 25;
    const height = 40 + items.length * (barHeight + barSpacing);

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.style.width = '100%';
    svg.style.height = 'auto';
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', `Visual tape diagram representation. Total parts: ${sumParts}. Bars and counts: ` + items.map(item => `${item.label} (${item.parts} parts)`).join(', '));

    // Find max parts to scale segment sizes
    const maxParts = Math.max(...items.map(item => item.parts));
    const maxBarW = 280; // pixels for max bar
    
    // Each segment unit width in pixels
    const unitWidth = maxBarW / maxParts;

    items.forEach((item, idx) => {
      const by = 20 + idx * (barHeight + barSpacing);
      const bx = 110; // X offset to leave space for left labels

      // 1. Label text (left)
      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.setAttribute('x', String(bx - 14));
      label.setAttribute('y', String(by + barHeight / 2 + 4));
      label.setAttribute('text-anchor', 'end');
      label.setAttribute('fill', 'var(--text-main)');
      label.style.fontSize = '12px';
      label.style.fontWeight = '700';
      label.style.fontFamily = 'sans-serif';
      label.textContent = item.label;
      svg.appendChild(label);

      // 2. Bar segments
      const barColor = idx % 2 === 0 ? 'var(--accent)' : '#06b6d4';
      const segmentWidth = unitWidth;

      for (let s = 0; s < item.parts; s++) {
        const segX = bx + s * segmentWidth;

        // Draw rectangle segment
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', String(segX));
        rect.setAttribute('y', String(by));
        rect.setAttribute('width', String(segmentWidth));
        rect.setAttribute('height', String(barHeight));
        rect.setAttribute('fill', 'var(--danger-bg)');
        rect.setAttribute('stroke', barColor);
        rect.setAttribute('stroke-width', '2');
        rect.setAttribute('rx', '3');
        svg.appendChild(rect);

        // Draw segment label if multiplier exists
        if (hasTotal) {
          const unitText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
          unitText.setAttribute('x', String(segX + segmentWidth / 2));
          unitText.setAttribute('y', String(by + barHeight / 2 + 4));
          unitText.setAttribute('text-anchor', 'middle');
          unitText.setAttribute('fill', barColor);
          unitText.style.fontSize = '10px';
          unitText.style.fontWeight = '700';
          unitText.style.fontFamily = 'monospace';
          unitText.textContent = multiplier.toFixed(1).replace(/\.0$/, '');
          svg.appendChild(unitText);
        }
      }

      // 3. Right summary bracket / label showing total parts count
      const totalText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      const rightX = bx + item.parts * segmentWidth + 12;
      totalText.setAttribute('x', String(rightX));
      totalText.setAttribute('y', String(by + barHeight / 2 + 4));
      totalText.setAttribute('fill', 'var(--text-muted)');
      totalText.style.fontSize = '11px';
      totalText.style.fontWeight = '700';
      totalText.style.fontFamily = 'sans-serif';
      
      let rightLabel = `${item.parts} parts`;
      if (hasTotal) {
        rightLabel += ` = ${(item.parts * multiplier).toFixed(1).replace(/\.0$/, '')}`;
      }
      totalText.textContent = rightLabel;
      svg.appendChild(totalText);
    });

    tapeWrapper.appendChild(svg);
  }

  // Image downloading serializers
  function downloadSVG() {
    const svgEl = tapeWrapper.querySelector('svg');
    if (!svgEl) return;
    const serializer = new XMLSerializer();
    const source = serializer.serializeToString(svgEl);
    const blob = new Blob([source], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = 'profpi_tape_diagram.svg';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function downloadPNG() {
    const svgEl = tapeWrapper.querySelector('svg');
    if (!svgEl) return;

    const canvas = document.createElement('canvas');
    canvas.width = 900; // High-res download
    canvas.height = 500;
    const ctx = canvas.getContext('2d');

    const serializer = new XMLSerializer();
    const source = serializer.serializeToString(svgEl);
    
    const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
    const bgFill = currentTheme === 'dark' ? '#0f172a' : '#ffffff';

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
      a.download = 'profpi_tape_diagram.png';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    };
    img.src = url;
  }

  function showError(msg) {
    errorAlert.textContent = msg;
    errorAlert.style.display = 'block';
    window.scrollTo({ top: errorAlert.offsetTop - 100, behavior: 'smooth' });
  }

  drawBtn.addEventListener('click', handleDraw);
  btnSvg.addEventListener('click', downloadSVG);
  btnPng.addEventListener('click', downloadPNG);

  // Initial draw
  handleDraw();
});
