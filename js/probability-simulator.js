// profpi — Probability Simulator script

document.addEventListener('DOMContentLoaded', () => {
  const btnCoin = document.getElementById('btn-sim-coin');
  const btnDice = document.getElementById('btn-sim-dice');
  const btnCard = document.getElementById('btn-sim-card');
  
  const countSelect = document.getElementById('trials-count');
  const runBtn = document.getElementById('run-btn');
  const resetBtn = document.getElementById('reset-btn');
  const animationWrapper = document.getElementById('animation-wrapper');
  
  const chartWrapper = document.getElementById('sim-chart-wrapper');
  const statsTbody = document.getElementById('stats-tbody');

  let activeMode = 'coin'; // 'coin', 'dice', 'card'
  let totalRuns = 0;
  
  // Frequency trackers
  let counts = {};

  // Setup initial state
  function initStats() {
    totalRuns = 0;
    counts = {};
    if (activeMode === 'coin') {
      counts = { 'Heads': 0, 'Tails': 0 };
    } else if (activeMode === 'dice') {
      for (let i = 2; i <= 12; i++) counts[String(i)] = 0;
    } else if (activeMode === 'card') {
      counts = { 'Spades ♠': 0, 'Hearts ♥': 0, 'Diamonds ♦': 0, 'Clubs ♣': 0 };
    }
    updateDisplay();
  }

  // Set toggle listeners
  btnCoin.addEventListener('click', () => {
    setMode('coin', btnCoin, `<div class="visual-coin" id="coin-visual">H</div>`);
  });

  btnDice.addEventListener('click', () => {
    setMode('dice', btnDice, `
      <div class="visual-die" id="die-1" style="margin-right:12px;"></div>
      <div class="visual-die" id="die-2"></div>
    `);
  });

  btnCard.addEventListener('click', () => {
    setMode('card', btnCard, `<div class="visual-card" id="card-visual"><span>A</span><span style="align-self:center;">♠</span><span>A</span></div>`);
  });

  function setMode(mode, btn, defaultHtml) {
    activeMode = mode;
    [btnCoin, btnDice, btnCard].forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    animationWrapper.innerHTML = defaultHtml;
    initStats();
  }

  // Simulation Logic
  function tossCoin() {
    return Math.random() < 0.5 ? 'Heads' : 'Tails';
  }

  function rollDice() {
    const d1 = Math.floor(Math.random() * 6) + 1;
    const d2 = Math.floor(Math.random() * 6) + 1;
    return { sum: d1 + d2, d1, d2 };
  }

  function drawCard() {
    const suits = ['Spades ♠', 'Hearts ♥', 'Diamonds ♦', 'Clubs ♣'];
    const ranks = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
    const suit = suits[Math.floor(Math.random() * 4)];
    const rank = ranks[Math.floor(Math.random() * 13)];
    return { suit, rank };
  }

  // Dice visual dot matrix builder
  function setDieVisual(el, val) {
    el.innerHTML = '';
    const dotsMap = {
      1: [4],
      2: [0, 8],
      3: [0, 4, 8],
      4: [0, 2, 6, 8],
      5: [0, 2, 4, 6, 8],
      6: [0, 2, 3, 5, 6, 8]
    };
    
    // Create 9 grid slots for dots
    for (let i = 0; i < 9; i++) {
      const slot = document.createElement('div');
      if (dotsMap[val].includes(i)) {
        const dot = document.createElement('div');
        dot.classList.add('die-dot');
        slot.appendChild(dot);
      }
      el.appendChild(slot);
    }
  }

  function handleRun() {
    const trials = parseInt(countSelect.value);

    // Single step animation
    if (trials === 1) {
      runBtn.disabled = true;
      
      if (activeMode === 'coin') {
        const coin = document.getElementById('coin-visual');
        coin.style.animation = 'tossCoin 0.4s ease-out';
        
        setTimeout(() => {
          const outcome = tossCoin();
          coin.textContent = outcome === 'Heads' ? 'H' : 'T';
          coin.style.background = outcome === 'Heads' ? '#f59e0b' : '#3b82f6';
          coin.style.borderColor = outcome === 'Heads' ? '#d97706' : '#2563eb';
          coin.style.animation = 'none';
          
          totalRuns++;
          counts[outcome]++;
          updateDisplay();
          runBtn.disabled = false;
        }, 400);

      } else if (activeMode === 'dice') {
        const die1 = document.getElementById('die-1');
        const die2 = document.getElementById('die-2');
        die1.style.animation = 'rollDie 0.4s ease-out';
        die2.style.animation = 'rollDie 0.4s ease-out';

        setTimeout(() => {
          const res = rollDice();
          setDieVisual(die1, res.d1);
          setDieVisual(die2, res.d2);
          die1.style.animation = 'none';
          die2.style.animation = 'none';

          totalRuns++;
          counts[String(res.sum)]++;
          updateDisplay();
          runBtn.disabled = false;
        }, 400);

      } else if (activeMode === 'card') {
        const card = document.getElementById('card-visual');
        card.style.animation = 'rollDie 0.3s ease-out';

        setTimeout(() => {
          const res = drawCard();
          const isRed = res.suit.includes('♥') || res.suit.includes('♦');
          card.style.color = isRed ? '#ef4444' : '#0f172a';
          
          const symbol = res.suit.split(' ')[1];
          card.innerHTML = `<span>${res.rank}</span><span style="align-self:center; font-size: 2rem;">${symbol}</span><span>${res.rank}</span>`;
          card.style.animation = 'none';

          totalRuns++;
          counts[res.suit]++;
          updateDisplay();
          runBtn.disabled = false;
        }, 300);
      }

    } else {
      // Loop run instantly
      for (let t = 0; t < trials; t++) {
        if (activeMode === 'coin') {
          counts[tossCoin()]++;
        } else if (activeMode === 'dice') {
          counts[String(rollDice().sum)]++;
        } else if (activeMode === 'card') {
          counts[drawCard().suit]++;
        }
      }
      totalRuns += trials;
      updateDisplay();
    }
  }

  function getTheoreticalProbability(key) {
    if (activeMode === 'coin') {
      return 0.5;
    } else if (activeMode === 'dice') {
      const sum = parseInt(key);
      const ways = {
        2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 7: 6,
        8: 5, 9: 4, 10: 3, 11: 2, 12: 1
      };
      return ways[sum] / 36;
    } else if (activeMode === 'card') {
      return 0.25;
    }
    return 0;
  }

  // Draw chart visual representation
  function drawChart() {
    chartWrapper.innerHTML = '';
    const keys = Object.keys(counts);

    const width = 400;
    const height = 180;
    const padding = 25;

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.style.width = '100%';
    svg.style.height = 'auto';
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', `Probability simulation distribution bar chart showing outcomes frequency vs theoretical expectation thresholds`);

    const maxRatio = Math.max(
      ...keys.map(k => totalRuns > 0 ? counts[k] / totalRuns : 0),
      ...keys.map(k => getTheoreticalProbability(k)),
      0.1
    );

    const scaleY = (height - padding * 2) / maxRatio;
    const barWidth = (width - padding * 2) / keys.length - 8;

    keys.forEach((key, idx) => {
      const x = padding + idx * ((width - padding * 2) / keys.length) + 4;
      const experimentalRatio = totalRuns > 0 ? counts[key] / totalRuns : 0;
      const theoreticalRatio = getTheoreticalProbability(key);

      const expBarH = experimentalRatio * scaleY;
      const theoBarH = theoreticalRatio * scaleY;

      // 1. Experimental Bar (filled)
      const rectExp = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rectExp.setAttribute('x', String(x));
      rectExp.setAttribute('y', String(height - padding - expBarH));
      rectExp.setAttribute('width', String(barWidth));
      rectExp.setAttribute('height', String(expBarH));
      rectExp.setAttribute('fill', 'var(--accent)');
      rectExp.setAttribute('rx', '2');
      svg.appendChild(rectExp);

      // 2. Theoretical Line / Target Indicator (dash overlay)
      const lineTheo = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      lineTheo.setAttribute('x1', String(x - 2));
      lineTheo.setAttribute('y1', String(height - padding - theoBarH));
      lineTheo.setAttribute('x2', String(x + barWidth + 2));
      lineTheo.setAttribute('y2', String(height - padding - theoBarH));
      lineTheo.setAttribute('stroke', '#f59e0b'); // Amber for theoretical line
      lineTheo.setAttribute('stroke-width', '2.5');
      lineTheo.setAttribute('stroke-dasharray', '3 2');
      svg.appendChild(lineTheo);

      // 3. Labels
      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.setAttribute('x', String(x + barWidth / 2));
      label.setAttribute('y', String(height - 8));
      label.setAttribute('text-anchor', 'middle');
      label.setAttribute('fill', 'var(--text-muted)');
      label.style.fontSize = '9px';
      label.style.fontFamily = 'monospace';
      label.textContent = key.replace(/ .*/, ''); // Remove symbols for brevity
      svg.appendChild(label);
    });

    chartWrapper.appendChild(svg);
  }

  function updateDisplay() {
    statsTbody.innerHTML = '';
    const keys = Object.keys(counts);

    keys.forEach(key => {
      const row = document.createElement('tr');
      const countVal = counts[key];
      const expPct = totalRuns > 0 ? (countVal / totalRuns) * 100 : 0;
      const theoPct = getTheoreticalProbability(key) * 100;

      row.innerHTML = `
        <td><strong>${key}</strong></td>
        <td style="text-align:center;">${countVal}</td>
        <td style="text-align:center;">${expPct.toFixed(2)}%</td>
        <td style="text-align:right;">${theoPct.toFixed(2)}%</td>
      `;
      statsTbody.appendChild(row);
    });

    drawChart();
  }

  runBtn.addEventListener('click', handleRun);
  resetBtn.addEventListener('click', initStats);

  // Initial draw
  initStats();
});
