// profpi — Number Pattern Solver script

document.addEventListener('DOMContentLoaded', () => {
  const seqInput = document.getElementById('sequence-input');
  const solveBtn = document.getElementById('solve-btn');
  const errorAlert = document.getElementById('error-alert');
  
  const typeOutput = document.getElementById('pattern-type-output');
  const formulaExplicit = document.getElementById('formula-explicit');
  const formulaRecursive = document.getElementById('formula-recursive');
  const predictionsOutput = document.getElementById('predictions-output');
  const stepsOutput = document.getElementById('analysis-steps-output');

  // Example clicks
  document.querySelectorAll('.example-item').forEach(item => {
    item.addEventListener('click', () => {
      seqInput.value = item.getAttribute('data-seq');
      handleSolve();
    });
  });

  function parseSequence(str) {
    return str
      .split(',')
      .map(s => s.trim())
      .filter(s => s !== '')
      .map(s => parseFloat(s));
  }

  function handleSolve() {
    errorAlert.style.display = 'none';
    const seq = parseSequence(seqInput.value);

    if (seq.some(isNaN)) {
      showError('Sequence contains invalid non-numeric inputs.');
      return;
    }
    if (seq.length < 3) {
      showError('Please enter at least 3 numbers for pattern detection.');
      return;
    }

    const n = seq.length;
    let type = 'Unknown / Complex';
    let explicit = 'No simple explicit formula found';
    let recursive = 'No simple recursive formula found';
    let nextTerms = [];
    let steps = [];

    // 1. Check Arithmetic Sequence
    let isArithmetic = true;
    const diff = seq[1] - seq[0];
    for (let i = 1; i < n - 1; i++) {
      if (Math.abs((seq[i + 1] - seq[i]) - diff) > 1e-9) {
        isArithmetic = false;
        break;
      }
    }

    if (isArithmetic) {
      type = 'Arithmetic Sequence';
      const a1 = seq[0];
      const d = diff;
      
      const c = a1 - d;
      explicit = `a_n = ${d}n ${c >= 0 ? '+' : '-'} ${Math.abs(c)}`;
      if (c === 0) explicit = `a_n = ${d}n`;
      if (d === 0) explicit = `a_n = ${a1}`;

      recursive = `a_n = a_{n-1} ${d >= 0 ? '+' : '-'} ${Math.abs(d)}; a_1 = ${a1}`;
      
      for (let i = 1; i <= 5; i++) {
        nextTerms.push(a1 + (n + i - 1) * d);
      }

      steps = [
        `Calculate the differences between consecutive terms:
         <br><code>${seq[1]} - ${seq[0]} = ${diff}</code>, <code>${seq[2]} - ${seq[1]} = ${diff}</code>...`,
        `Since the difference is constant at <strong>${diff}</strong>, this is an <strong>Arithmetic Sequence</strong>.`,
        `The formula for the nth term of an arithmetic sequence is <code>a_n = a_1 + (n-1)d</code>.`,
        `Substitute <code>a_1 = ${a1}</code> and <code>d = ${d}</code> to get:
         <br><code>a_n = ${a1} + (n-1)(${d}) = ${explicit}</code>.`
      ];

      updateDisplay(type, explicit, recursive, nextTerms, steps);
      return;
    }

    // 2. Check Geometric Sequence
    let isGeometric = true;
    const ratio = seq[1] / seq[0];
    // Check for division by zero
    if (seq.some(v => v === 0) || isNaN(ratio) || !isFinite(ratio)) {
      isGeometric = false;
    } else {
      for (let i = 1; i < n - 1; i++) {
        if (Math.abs((seq[i + 1] / seq[i]) - ratio) > 1e-9) {
          isGeometric = false;
          break;
        }
      }
    }

    if (isGeometric) {
      type = 'Geometric Sequence';
      const a1 = seq[0];
      const r = ratio;
      
      explicit = `a_n = ${a1} \\cdot (${r.toFixed(4)})^{n-1}`;
      recursive = `a_n = ${r.toFixed(4)} \\cdot a_{n-1}; a_1 = ${a1}`;

      for (let i = 1; i <= 5; i++) {
        nextTerms.push(a1 * Math.pow(r, n + i - 1));
      }

      steps = [
        `Divide consecutive terms to find the ratio:
         <br><code>${seq[1]} / ${seq[0]} = ${ratio.toFixed(4)}</code>, <code>${seq[2]} / ${seq[1]} = ${ratio.toFixed(4)}</code>...`,
        `Since the ratio is constant at <strong>${ratio.toFixed(4)}</strong>, this is a <strong>Geometric Sequence</strong>.`,
        `The formula for the nth term of a geometric sequence is <code>a_n = a_1 \\cdot r^{n-1}</code>.`,
        `Substitute <code>a_1 = ${a1}</code> and <code>r = ${r.toFixed(4)}</code> to get:
         <br><code>a_n = ${explicit}</code>.`
      ];

      updateDisplay(type, explicit, recursive, nextTerms, steps);
      return;
    }

    // 3. Check Quadratic Sequence (requires at least 4 terms)
    if (n >= 4) {
      const diffs1 = [];
      for (let i = 0; i < n - 1; i++) {
        diffs1.push(seq[i + 1] - seq[i]);
      }
      const diffs2 = [];
      for (let i = 0; i < diffs1.length - 1; i++) {
        diffs2.push(diffs1[i + 1] - diffs1[i]);
      }

      let isQuadratic = true;
      const secDiff = diffs2[0];
      for (let i = 1; i < diffs2.length; i++) {
        if (Math.abs(diffs2[i] - secDiff) > 1e-9) {
          isQuadratic = false;
          break;
        }
      }

      if (isQuadratic) {
        type = 'Quadratic Sequence';
        const a = secDiff / 2;
        const b = diffs1[0] - 3 * a;
        const c = seq[0] - a - b;

        explicit = `a_n = ${a}n² ${b >= 0 ? '+' : '-'} ${Math.abs(b)}n ${c >= 0 ? '+' : '-'} ${Math.abs(c)}`;
        recursive = `a_n = a_{n-1} + ${2 * a}(n-1) + ${b - a}`;

        const evalQuad = (idx) => a * idx * idx + b * idx + c;

        for (let i = 1; i <= 5; i++) {
          nextTerms.push(evalQuad(n + i));
        }

        steps = [
          `Find the first difference list: <code>[${diffs1.join(', ')}]</code>.`,
          `Since they are not constant, calculate the second differences: <code>[${diffs2.join(', ')}]</code>.`,
          `The second differences are constant at <strong>${secDiff}</strong>, indicating a <strong>Quadratic Sequence</strong> (<code>a_n = an² + bn + c</code>).`,
          `Calculate coefficients:
           <br><code>a = second difference / 2 = ${a}</code>
           <br><code>b = (first term of first difference) - 3a = ${b}</code>
           <br><code>c = first term - a - b = ${c}</code>`,
          `Substituting these into the model yields:
           <br><code>a_n = ${explicit}</code>.`
        ];

        updateDisplay(type, explicit, recursive, nextTerms, steps);
        return;
      }
    }

    // 4. Check Fibonacci-like Sequence
    let isFib = true;
    for (let i = 2; i < n; i++) {
      if (Math.abs(seq[i] - (seq[i - 1] + seq[i - 2])) > 1e-9) {
        isFib = false;
        break;
      }
    }

    if (isFib) {
      type = 'Fibonacci-like Sequence';
      explicit = 'a_n = \\frac{\\Phi^n - (1-\\Phi)^n}{\\sqrt{5}} (Binet\'s Formula)';
      recursive = `a_n = a_{n-1} + a_{n-2}; a_1 = ${seq[0]}, a_2 = ${seq[1]}`;

      // generate predictions dynamically using recursive relation
      const fibArr = [...seq];
      for (let i = 0; i < 5; i++) {
        const nextVal = fibArr[fibArr.length - 1] + fibArr[fibArr.length - 2];
        fibArr.push(nextVal);
        nextTerms.push(nextVal);
      }

      steps = [
        `Check if each term is the sum of the previous two terms:
         <br><code>${seq[2]} = ${seq[1]} + ${seq[0]}</code>...`,
        `Since this relationship holds true for all terms, this is a <strong>Fibonacci-like Sequence</strong>.`,
        `The recursive equation is simply: <code>a_n = a_{n-1} + a_{n-2}</code>.`
      ];

      updateDisplay(type, explicit, recursive, nextTerms, steps);
      return;
    }

    // Default Fallback
    showError('No simple arithmetic, geometric, quadratic, or Fibonacci sequence rule could be detected. Check inputs or try other examples.');
  }

  function updateDisplay(type, explicitVal, recursiveVal, nextTerms, steps) {
    typeOutput.textContent = type;
    formulaExplicit.textContent = explicitVal;
    formulaRecursive.textContent = recursiveVal;
    
    predictionsOutput.textContent = nextTerms.map(t => typeof t === 'number' ? t.toFixed(2).replace(/\.00$/, '') : t).join(', ');

    stepsOutput.innerHTML = steps.map(s => `<li>${s}</li>`).join('');
  }

  function showError(msg) {
    errorAlert.textContent = msg;
    errorAlert.style.display = 'block';
    window.scrollTo({ top: errorAlert.offsetTop - 100, behavior: 'smooth' });
  }

  solveBtn.addEventListener('click', handleSolve);
  
  // Initial run
  handleSolve();
});
