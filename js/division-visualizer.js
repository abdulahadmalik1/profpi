// profpi — Division Visualizer script

document.addEventListener('DOMContentLoaded', () => {
  const dividendInput = document.getElementById('dividend-input');
  const divisorInput = document.getElementById('divisor-input');
  const solveBtn = document.getElementById('solve-btn');
  
  const errorAlert = document.getElementById('error-alert');
  const layoutContainer = document.getElementById('division-layout-container');
  const formulaOutput = document.getElementById('division-result-formula');
  const stepsList = document.getElementById('division-steps-list');

  function handleSolve() {
    errorAlert.style.display = 'none';

    const dividend = parseInt(dividendInput.value);
    const divisor = parseInt(divisorInput.value);

    // Inputs Validation
    if (isNaN(dividend) || isNaN(divisor)) {
      showError('Please fill in both input fields.');
      return;
    }
    if (divisor === 0) {
      showError('Cannot divide by zero.');
      return;
    }
    if (dividend < 0 || divisor < 0) {
      showError('This visualizer currently supports positive integers.');
      return;
    }
    if (dividend > 999999) {
      showError('Dividend is too large. Limit is 999,999.');
      return;
    }

    const dividendStr = String(dividend);
    const divisorStr = String(divisor);
    
    let quotientStr = '';
    let runningVal = 0;
    
    // Arrays to hold visual steps
    const lines = []; // Holds arrays of { text, type, offset }
    const stepExplanations = [];

    // Setup first lines: Quotient line, Divider line, Dividend line
    // Offset for divisor plus separator is divisorStr.length + 3
    const divOffset = divisorStr.length + 3;

    // Run division digit-by-digit
    for (let i = 0; i < dividendStr.length; i++) {
      const digit = parseInt(dividendStr[i]);
      runningVal = runningVal * 10 + digit;
      
      const stepQuotient = Math.floor(runningVal / divisor);
      const multiplyVal = stepQuotient * divisor;
      const remainder = runningVal - multiplyVal;

      const quotientChar = String(stepQuotient);
      quotientStr += quotientChar;

      // Log step explanations
      if (i === 0 || quotientStr !== '0' || i === dividendStr.length - 1) {
        stepExplanations.push(
          `Bring down <strong>${digit}</strong>. Running value is <strong>${runningVal}</strong>.
           <br>Divide: <code>${runningVal} &divide; ${divisor} = ${stepQuotient}</code> (remainder <code>${remainder}</code>).
           <br>Multiply: <code>${stepQuotient} &times; ${divisor} = ${multiplyVal}</code>.
           <br>Subtract: <code>${runningVal} - ${multiplyVal} = ${remainder}</code>.`
        );
      }

      // Add lines for ASCII alignment
      if (stepQuotient > 0 || quotientStr.length > 1) {
        // Record intermediate division subtraction visual
        lines.push({
          val: multiplyVal,
          offset: divOffset + i - String(multiplyVal).length + 1,
          isSub: true
        });
        lines.push({
          val: remainder,
          offset: divOffset + i - String(remainder).length + 1,
          isRem: true
        });
      }

      runningVal = remainder;
    }

    // Trim leading zeroes in final Quotient (unless quotient is exactly 0)
    let finalQuotient = quotientStr.replace(/^0+/, '');
    if (finalQuotient === '') finalQuotient = '0';
    const finalRemainder = runningVal;

    // Formatting visual ASCII block
    // Line 1: Quotient
    const qLinePadding = ' '.repeat(divOffset);
    let ascii = qLinePadding + finalQuotient + '\n';
    
    // Line 2: Horizontal Bar
    ascii += ' '.repeat(divisorStr.length + 1) + '┌' + '─'.repeat(dividendStr.length + 2) + '\n';
    
    // Line 3: Dividend
    ascii += ` ${divisorStr} │ ${dividendStr}\n`;

    // Process all subtraction lines
    let lastIdx = 0;
    
    // We want to construct a clean step outline
    // Let's execute long division subtraction loops
    let currentVal = 0;
    let textOut = '';
    
    // Draw visual steps properly aligned
    let curOffset = divOffset;
    let divSteps = [];

    // Manual builder for ASCII layout
    for (let i = 0; i < dividendStr.length; i++) {
      const digit = dividendStr[i];
      currentVal = currentVal * 10 + parseInt(digit);
      
      const q = Math.floor(currentVal / divisor);
      const mult = q * divisor;
      const rem = currentVal - mult;

      // We only draw subtraction details if we divided
      if (q > 0 || i === dividendStr.length - 1) {
        // Draw the subtraction value
        const spaceLeft = divOffset + i - String(mult).length + 1;
        ascii += ' '.repeat(spaceLeft) + `-${mult}\n`;
        // Draw subtraction underline
        ascii += ' '.repeat(spaceLeft) + '─'.repeat(Math.max(String(mult).length, String(currentVal).length) + 1) + '\n';
        
        // Draw remainder
        const remSpace = divOffset + i - String(rem).length + 1;
        if (i < dividendStr.length - 1) {
          ascii += ' '.repeat(remSpace) + `${rem}\n`;
        } else {
          // final remainder line
          ascii += ' '.repeat(remSpace) + `${rem} (Remainder)\n`;
        }
        currentVal = rem;
      }
    }

    // Set outputs
    layoutContainer.textContent = ascii;
    formulaOutput.textContent = `${dividend} ÷ ${divisor} = ${finalQuotient} R ${finalRemainder}`;
    
    if (finalRemainder === 0) {
      formulaOutput.textContent = `${dividend} ÷ ${divisor} = ${finalQuotient}`;
    }

    stepsList.innerHTML = stepExplanations.map(s => `<li>${s}</li>`).join('');
  }

  function showError(msg) {
    errorAlert.textContent = msg;
    errorAlert.style.display = 'block';
    window.scrollTo({ top: errorAlert.offsetTop - 100, behavior: 'smooth' });
  }

  solveBtn.addEventListener('click', handleSolve);
  
  // Initial solve
  handleSolve();
});
