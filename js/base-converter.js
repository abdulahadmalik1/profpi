// profpi — Base Converter script

document.addEventListener('DOMContentLoaded', () => {
  const inputVal = document.getElementById('base-input-val');
  const fromBaseSelect = document.getElementById('from-base');
  const toBaseSelect = document.getElementById('to-base');
  const convertBtn = document.getElementById('convert-btn');
  
  const errorAlert = document.getElementById('error-alert');
  const resultFormula = document.getElementById('base-result-formula');
  const stepsList = document.getElementById('base-steps-list');
  const board = document.getElementById('binary-board');

  // 1. Build interactive 8-bit board
  const bitWeights = [128, 64, 32, 16, 8, 4, 2, 1];
  let bitStates = [0, 0, 1, 0, 1, 1, 0, 1]; // defaults to 45 (00101101)

  function buildBoard() {
    board.innerHTML = '';
    bitWeights.forEach((weight, idx) => {
      const bitDiv = document.createElement('div');
      bitDiv.classList.add('bit-switch');
      if (bitStates[idx] === 1) {
        bitDiv.classList.add('active');
      }

      bitDiv.innerHTML = `
        <div class="bulb-icon">💡</div>
        <div class="bit-label">2<sup>${7 - idx}</sup></div>
        <div class="bit-value">${weight}</div>
      `;

      bitDiv.addEventListener('click', () => {
        bitStates[idx] = bitStates[idx] === 1 ? 0 : 1;
        
        // Calculate total decimal value from active bits
        let total = 0;
        bitWeights.forEach((w, i) => {
          if (bitStates[i] === 1) total += w;
        });

        // Sync inputs
        inputVal.value = String(total);
        fromBaseSelect.value = '10';
        
        buildBoard();
        handleConvert();
      });

      board.appendChild(bitDiv);
    });
  }

  // Sync board bulbs with decimal values if inside bounds [0, 255]
  function syncBoardWithDecimal(decVal) {
    if (decVal >= 0 && decVal <= 255) {
      let val = decVal;
      bitWeights.forEach((weight, idx) => {
        if (val >= weight) {
          bitStates[idx] = 1;
          val -= weight;
        } else {
          bitStates[idx] = 0;
        }
      });
      buildBoard();
    }
  }

  function handleConvert() {
    errorAlert.style.display = 'none';

    const rawInput = inputVal.value.trim();
    const fromBase = parseInt(fromBaseSelect.value);
    const toBase = parseInt(toBaseSelect.value);

    if (rawInput === '') {
      showError('Please enter a value to convert.');
      return;
    }

    // Input characters validation
    const baseRegexes = {
      2: /^[01]+$/,
      8: /^[0-7]+$/,
      10: /^[0-9]+$/,
      16: /^[0-9A-Fa-f]+$/
    };

    if (!baseRegexes[fromBase].test(rawInput)) {
      showError(`Invalid character format for Base ${fromBase}.`);
      return;
    }

    // Convert intermediate value to Base 10
    const decVal = parseInt(rawInput, fromBase);
    if (isNaN(decVal)) {
      showError('Could not parse the input value.');
      return;
    }

    // Convert to target base
    const finalVal = decVal.toString(toBase).toUpperCase();

    // Set Formula Output
    resultFormula.textContent = `${rawInput} (Base ${fromBase}) = ${finalVal} (Base ${toBase})`;

    // Generate math steps
    let stepsHtml = '';
    
    // Step A: Base X to Base 10
    if (fromBase !== 10) {
      stepsHtml += `<li><strong>Step 1: Convert to Decimal (Base 10)</strong>
        <br>Multiply each digit of the number by its base power representation (base <code>${fromBase}</code>):
        <br><code>`;
      
      const digitTerms = [];
      let calculatedSum = 0;
      const len = rawInput.length;
      
      for (let i = 0; i < len; i++) {
        const char = rawInput[i];
        const val = parseInt(char, fromBase);
        const power = len - 1 - i;
        const termVal = val * Math.pow(fromBase, power);
        calculatedSum += termVal;
        
        digitTerms.push(`(${char} &times; ${fromBase}<sup>${power}</sup>)`);
      }
      
      stepsHtml += digitTerms.join(' + ') + ` = ${calculatedSum}</code></li>`;
    }

    // Step B: Base 10 to Target Base
    if (toBase !== 10) {
      stepsHtml += `<li><strong>Step 2: Convert from Decimal to Base ${toBase}</strong>
        <br>Divide <strong>${decVal}</strong> consecutively by <strong>${toBase}</strong> and record the remainders:
        <br><table style="width:100%; font-family:monospace; margin-top:8px;">`;
      
      let temp = decVal;
      const divisionLines = [];
      const remainderDigits = [];

      if (temp === 0) {
        divisionLines.push(`0 &divide; ${toBase} = 0 (Remainder 0)`);
        remainderDigits.push('0');
      }

      while (temp > 0) {
        const quot = Math.floor(temp / toBase);
        const rem = temp % toBase;
        const remChar = rem.toString(toBase).toUpperCase();
        
        divisionLines.push(`<tr><td>${temp} &divide; ${toBase}</td><td>= ${quot}</td><td>(Remainder <strong>${remChar}</strong>)</td></tr>`);
        remainderDigits.unshift(remChar);
        temp = quot;
      }
      
      stepsHtml += divisionLines.join('') + `</table>
        <br>Read the remainders from bottom to top to construct the final result: <strong>${finalVal}</strong>.</li>`;
    }

    if (fromBase === 10 && toBase === 10) {
      stepsHtml = `<li>The source base and target base are identical (Decimal). The value remains <strong>${decVal}</strong>.</li>`;
    }

    stepsList.innerHTML = stepsHtml;

    // Sync bulb switch states
    syncBoardWithDecimal(decVal);
  }

  function showError(msg) {
    errorAlert.textContent = msg;
    errorAlert.style.display = 'block';
    window.scrollTo({ top: errorAlert.offsetTop - 100, behavior: 'smooth' });
  }

  convertBtn.addEventListener('click', handleConvert);
  
  // Initial run
  buildBoard();
  handleConvert();
});
