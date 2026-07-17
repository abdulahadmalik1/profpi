// profpi — Fraction Visualizer script

document.addEventListener('DOMContentLoaded', () => {
  const f1NumInput = document.getElementById('f1-num');
  const f1DenInput = document.getElementById('f1-den');
  const f2NumInput = document.getElementById('f2-num');
  const f2DenInput = document.getElementById('f2-den');
  const opSelect = document.getElementById('op-select');
  const calcBtn = document.getElementById('calc-btn');
  
  const errorAlert = document.getElementById('error-alert');
  const chartsContainer = document.getElementById('charts-container');
  const formulaOutput = document.getElementById('formula-output');
  const stepsOutput = document.getElementById('steps-output');
  
  const pieBtn = document.getElementById('pie-model-btn');
  const barBtn = document.getElementById('bar-model-btn');

  let activeModel = 'pie'; // 'pie' or 'bar'

  // Helper Math Functions
  function gcd(a, b) {
    a = Math.abs(a);
    b = Math.abs(b);
    while (b) {
      const t = b;
      b = a % b;
      a = t;
    }
    return a;
  }

  function lcm(a, b) {
    return Math.abs(a * b) / gcd(a, b);
  }

  // Format fraction as a string
  function fmtFrac(num, den) {
    if (den === 1) return String(num);
    return `${num}/${den}`;
  }

  // SVG Drawing Helpers
  function createSVGElement(tag) {
    return document.createElementNS('http://www.w3.org/2000/svg', tag);
  }

  // Render a fraction visually (Pie/Circle model)
  function drawPieSVG(num, den, color) {
    const svg = createSVGElement('svg');
    svg.setAttribute('viewBox', '0 0 160 160');
    svg.classList.add('fraction-chart-svg');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', `Circle model pie chart representing the fraction ${num} over ${den}`);

    // If fraction is greater than 1, draw multiple circles
    const totalCircles = Math.max(1, Math.ceil(num / den));
    // Limit to 5 circles to avoid visual clutter
    const drawCircles = Math.min(5, totalCircles);
    
    // adjust wrapper viewport dynamically if drawing multiple circles
    svg.setAttribute('viewBox', `0 0 ${160 * drawCircles} 160`);

    for (let c = 0; c < drawCircles; c++) {
      const cx = 80 + c * 160;
      const cy = 80;
      const r = 60;
      
      // Draw background circle segments
      for (let i = 0; i < den; i++) {
        const path = createSVGElement('path');
        const startAngle = (i * 360) / den - 90;
        const endAngle = ((i + 1) * 360) / den - 90;
        
        const startRad = (startAngle * Math.PI) / 180;
        const endRad = (endAngle * Math.PI) / 180;
        
        const x1 = cx + r * Math.cos(startRad);
        const y1 = cy + r * Math.sin(startRad);
        const x2 = cx + r * Math.cos(endRad);
        const y2 = cy + r * Math.sin(endRad);
        
        const d = `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 0 1 ${x2} ${y2} Z`;
        path.setAttribute('d', d);
        path.setAttribute('stroke', 'var(--border-color)');
        path.setAttribute('stroke-width', '1.5');
        
        // Fill active slices
        const currentSliceIndex = c * den + i;
        if (currentSliceIndex < num) {
          path.setAttribute('fill', color);
        } else {
          path.setAttribute('fill', 'var(--card-bg)');
        }
        svg.appendChild(path);
      }
    }
    return svg;
  }

  // Render a fraction visually (Bar model)
  function drawBarSVG(num, den, color) {
    const svg = createSVGElement('svg');
    svg.classList.add('fraction-chart-svg');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', `Rectangular bar model chart representing the fraction ${num} over ${den}`);

    const totalBars = Math.max(1, Math.ceil(num / den));
    const drawBars = Math.min(5, totalBars);

    svg.setAttribute('viewBox', `0 0 160 ${40 * drawBars}`);
    svg.style.height = `${40 * drawBars}px`;

    for (let b = 0; b < drawBars; b++) {
      const by = 5 + b * 35;
      const width = 150;
      const height = 25;
      const cellWidth = width / den;

      // Draw background bar outline
      const outerRect = createSVGElement('rect');
      outerRect.setAttribute('x', '5');
      outerRect.setAttribute('y', String(by));
      outerRect.setAttribute('width', String(width));
      outerRect.setAttribute('height', String(height));
      outerRect.setAttribute('fill', 'none');
      outerRect.setAttribute('stroke', 'var(--border-color)');
      outerRect.setAttribute('stroke-width', '1.5');
      outerRect.setAttribute('rx', '4');
      svg.appendChild(outerRect);

      for (let i = 0; i < den; i++) {
        const rect = createSVGElement('rect');
        rect.setAttribute('x', String(5 + i * cellWidth));
        rect.setAttribute('y', String(by));
        rect.setAttribute('width', String(cellWidth));
        rect.setAttribute('height', String(height));
        rect.setAttribute('stroke', 'var(--border-color)');
        rect.setAttribute('stroke-width', '1');

        const currentCellIndex = b * den + i;
        if (currentCellIndex < num) {
          rect.setAttribute('fill', color);
        } else {
          rect.setAttribute('fill', 'var(--card-bg)');
        }
        svg.appendChild(rect);
      }
    }
    return svg;
  }

  function handleCalculate() {
    errorAlert.style.display = 'none';
    
    const f1Num = parseInt(f1NumInput.value);
    const f1Den = parseInt(f1DenInput.value);
    const f2Num = parseInt(f2NumInput.value);
    const f2Den = parseInt(f2DenInput.value);
    const op = opSelect.value;

    // Inputs check
    if (isNaN(f1Num) || isNaN(f1Den) || isNaN(f2Num) || isNaN(f2Den)) {
      showError('Please fill in all fraction input fields.');
      return;
    }
    if (f1Den === 0 || f2Den === 0) {
      showError('Denominator cannot be zero.');
      return;
    }
    if (f1Den < 0 || f2Den < 0 || f1Num < 0 || f2Num < 0) {
      showError('This visualizer currently supports positive integer fractions.');
      return;
    }
    if (f1Den > 100 || f2Den > 100) {
      showError('For visual clarity, denominators are capped at 100.');
      return;
    }

    let resultNum, resultDen;
    let stepsHtml = '';
    
    // LCD calculation steps
    const commonDen = lcm(f1Den, f2Den);
    const m1 = commonDen / f1Den;
    const m2 = commonDen / f2Den;
    const newNum1 = f1Num * m1;
    const newNum2 = f2Num * m2;

    if (op === '+' || op === '-') {
      if (op === '+') {
        resultNum = newNum1 + newNum2;
      } else {
        resultNum = newNum1 - newNum2;
      }
      resultDen = commonDen;

      stepsHtml = `
        <ol>
          <li>Find the Least Common Denominator (LCD) of <strong>${f1Den}</strong> and <strong>${f2Den}</strong>, which is <strong>${commonDen}</strong>.</li>
          <li>Convert the fractions to have the common denominator:
            <br><code>${f1Num}/${f1Den} = (${f1Num} &times; ${m1})/(${f1Den} &times; ${m1}) = ${newNum1}/${commonDen}</code>
            <br><code>${f2Num}/${f2Den} = (${f2Num} &times; ${m2})/(${f2Den} &times; ${m2}) = ${newNum2}/${commonDen}</code>
          </li>
          <li>${op === '+' ? 'Add' : 'Subtract'} the numerators:
            <br><code>(${newNum1} ${op} ${newNum2})/${commonDen} = ${resultNum}/${commonDen}</code>
          </li>
      `;
    } else if (op === '*') {
      resultNum = f1Num * f2Num;
      resultDen = f1Den * f2Den;
      stepsHtml = `
        <ol>
          <li>Multiply the numerators together: <code>${f1Num} &times; ${f2Num} = ${resultNum}</code>.</li>
          <li>Multiply the denominators together: <code>${f1Den} &times; ${f2Den} = ${resultDen}</code>.</li>
          <li>Combine them: <code>${resultNum}/${resultDen}</code>.</li>
      `;
    } else if (op === '/') {
      resultNum = f1Num * f2Den;
      resultDen = f1Den * f2Num;
      stepsHtml = `
        <ol>
          <li>Multiply by the reciprocal of the second fraction (flip it):
            <br><code>${f1Num}/${f1Den} &times; ${f2Den}/${f2Num}</code>
          </li>
          <li>Multiply numerators: <code>${f1Num} &times; ${f2Den} = ${resultNum}</code>.</li>
          <li>Multiply denominators: <code>${f1Den} &times; ${f2Num} = ${resultDen}</code>.</li>
      `;
    } else if (op === 'compare') {
      const val1 = f1Num / f1Den;
      const val2 = f2Num / f2Den;
      let relation = '=';
      let relWord = 'equal to';
      if (val1 > val2) { relation = '>'; relWord = 'greater than'; }
      if (val1 < val2) { relation = '<'; relWord = 'less than'; }

      formulaOutput.textContent = `${fmtFrac(f1Num, f1Den)} ${relation} ${fmtFrac(f2Num, f2Den)}`;
      stepsHtml = `
        <ol>
          <li>Find a common denominator to compare, which is <strong>${commonDen}</strong>.</li>
          <li>Convert the fractions:
            <br><code>${f1Num}/${f1Den} = ${newNum1}/${commonDen}</code>
            <br><code>${f2Num}/${f2Den} = ${newNum2}/${commonDen}</code>
          </li>
          <li>Compare the numerators: <strong>${newNum1}</strong> is ${relWord} <strong>${newNum2}</strong>.</li>
          <li>Therefore, <code>${f1Num}/${f1Den} ${relation} ${f2Num}/${f2Den}</code>.</li>
        </ol>
      `;
      stepsOutput.innerHTML = stepsHtml;
      renderCharts(f1Num, f1Den, f2Num, f2Den, null, null, true);
      return;
    }

    // Simplification / Reduction
    if (resultNum < 0) {
      showError('Result is negative. This visualizer currently shows positive proportions.');
      return;
    }

    const divisor = gcd(resultNum, resultDen);
    const reducedNum = resultNum / divisor;
    const reducedDen = resultDen / divisor;

    if (divisor > 1) {
      stepsHtml += `
        <li>Reduce the fraction by dividing the numerator and denominator by their Greatest Common Divisor (GCD) of <strong>${divisor}</strong>:
          <br><code>${resultNum}/${resultDen} = (${resultNum} &divide; ${divisor})/(${resultDen} &divide; ${divisor}) = ${reducedNum}/${reducedDen}</code>.
        </li>
      `;
    }
    
    // Mixed number check
    if (reducedNum > reducedDen && reducedDen !== 1) {
      const whole = Math.floor(reducedNum / reducedDen);
      const remainder = reducedNum % reducedDen;
      stepsHtml += `
        <li>Convert to a mixed number: <strong>${whole} <sup>${remainder}</sup>/<sub>${reducedDen}</sub></strong></li>
      `;
    }
    stepsHtml += '</ol>';

    // Formula Display
    formulaOutput.textContent = `${fmtFrac(f1Num, f1Den)} ${op === '*' ? '×' : op === '/' ? '÷' : op} ${fmtFrac(f2Num, f2Den)} = ${fmtFrac(reducedNum, reducedDen)}`;
    if (reducedNum !== resultNum || reducedDen !== resultDen) {
      formulaOutput.innerHTML += ` <span style="font-size:1rem; font-weight:400; color:var(--text-muted);">(${fmtFrac(resultNum, resultDen)})</span>`;
    }
    formulaOutput.innerHTML += ` <span style="font-size:1.1rem; font-weight:600; color:var(--text-muted); margin-left:8px;">≈ ${(reducedNum / reducedDen).toFixed(3)}</span>`;

    stepsOutput.innerHTML = stepsHtml;

    // Render diagrams
    renderCharts(f1Num, f1Den, f2Num, f2Den, resultNum, resultDen, false);
  }

  function renderCharts(f1Num, f1Den, f2Num, f2Den, resNum, resDen, isCompare) {
    chartsContainer.innerHTML = '';

    const drawFn = activeModel === 'pie' ? drawPieSVG : drawBarSVG;

    // Card 1
    const card1 = document.createElement('div');
    card1.classList.add('fraction-chart-card');
    card1.innerHTML = `<div class="fraction-chart-title">Fraction 1: ${fmtFrac(f1Num, f1Den)}</div>`;
    card1.appendChild(drawFn(f1Num, f1Den, '#6366f1'));
    chartsContainer.appendChild(card1);

    // Card 2
    const card2 = document.createElement('div');
    card2.classList.add('fraction-chart-card');
    card2.innerHTML = `<div class="fraction-chart-title">Fraction 2: ${fmtFrac(f2Num, f2Den)}</div>`;
    card2.appendChild(drawFn(f2Num, f2Den, '#06b6d4'));
    chartsContainer.appendChild(card2);

    // Result Card
    if (!isCompare) {
      const cardRes = document.createElement('div');
      cardRes.classList.add('fraction-chart-card');
      cardRes.innerHTML = `<div class="fraction-chart-title">Result: ${fmtFrac(resNum, resDen)}</div>`;
      cardRes.appendChild(drawFn(resNum, resDen, '#a855f7'));
      chartsContainer.appendChild(cardRes);
    }
  }

  function showError(msg) {
    errorAlert.textContent = msg;
    errorAlert.style.display = 'block';
    window.scrollTo({ top: errorAlert.offsetTop - 100, behavior: 'smooth' });
  }

  // Model selection listeners
  pieBtn.addEventListener('click', () => {
    pieBtn.classList.add('active');
    barBtn.classList.remove('active');
    activeModel = 'pie';
    handleCalculate();
  });

  barBtn.addEventListener('click', () => {
    barBtn.classList.add('active');
    pieBtn.classList.remove('active');
    activeModel = 'bar';
    handleCalculate();
  });

  calcBtn.addEventListener('click', handleCalculate);
  
  // Initial run
  handleCalculate();
});
