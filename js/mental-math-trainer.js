// profpi — Mental Math Speed Trainer script

document.addEventListener('DOMContentLoaded', () => {
  const opSelect = document.getElementById('op-drill-select');
  const diffSelect = document.getElementById('diff-drill-select');
  const startBtn = document.getElementById('start-game-btn');
  const stopBtn = document.getElementById('stop-game-btn');
  
  const timeBadge = document.getElementById('stat-time');
  const scoreBadge = document.getElementById('stat-score');
  const streakBadge = document.getElementById('stat-streak');

  const welcomeView = document.getElementById('game-welcome-view');
  const activeView = document.getElementById('game-active-view');
  const gameOverView = document.getElementById('game-over-view');

  const eqDisplay = document.getElementById('equation-display');
  const ansInput = document.getElementById('game-answer-input');

  const summaryScore = document.getElementById('summary-score');
  const summaryAccuracy = document.getElementById('summary-accuracy');
  const summaryStreak = document.getElementById('summary-streak');
  const wrongSection = document.getElementById('summary-wrong-section');
  const wrongList = document.getElementById('summary-wrong-list');

  let score = 0;
  let streak = 0;
  let maxStreak = 0;
  let secondsLeft = 60;
  
  let totalQuestions = 0;
  let correctQuestions = 0;
  let wrongAnswersLog = []; // items of { question, correct, user }
  
  let gameInterval = null;
  let isGameActive = false;
  let currentCorrectAnswer = 0;

  function getRandomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  // Generate equations depending on difficulty
  function generateEquation() {
    const diff = diffSelect.value;
    const rawOp = opSelect.value;
    
    // Pick active operator
    const ops = ['+', '-', '*', '/'];
    const op = rawOp === 'mixed' ? ops[Math.floor(Math.random() * 4)] : rawOp;

    let minNum = 1;
    let maxNum = 10;
    
    if (diff === 'medium') {
      minNum = 5; maxNum = 40;
    } else if (diff === 'hard') {
      minNum = 10; maxNum = 90;
    }

    let num1, num2;
    let eqText = '';

    if (op === '+') {
      num1 = getRandomInt(minNum, maxNum);
      num2 = getRandomInt(minNum, maxNum);
      currentCorrectAnswer = num1 + num2;
      eqText = `${num1} + ${num2}`;
    } else if (op === '-') {
      num1 = getRandomInt(minNum, maxNum);
      num2 = getRandomInt(minNum, num1); // Positive answers only
      currentCorrectAnswer = num1 - num2;
      eqText = `${num1} - ${num2}`;
    } else if (op === '*') {
      // Lower bounds for multiplication
      const multMax = diff === 'easy' ? 10 : diff === 'medium' ? 15 : 25;
      num1 = getRandomInt(minNum, multMax);
      num2 = getRandomInt(1, 10);
      currentCorrectAnswer = num1 * num2;
      eqText = `${num1} &times; ${num2}`;
    } else if (op === '/') {
      // Solve division by multiplying first (prevents decimal answers)
      const divMax = diff === 'easy' ? 10 : diff === 'medium' ? 12 : 20;
      num2 = getRandomInt(2, 10); // Divisor
      const quotient = getRandomInt(1, divMax); // Target Quotient
      num1 = num2 * quotient; // Dividend
      currentCorrectAnswer = quotient;
      eqText = `${num1} &divide; ${num2}`;
    }

    eqDisplay.innerHTML = eqText;
    ansInput.value = '';
    ansInput.focus();
  }

  function handleStart() {
    isGameActive = true;
    score = 0;
    streak = 0;
    maxStreak = 0;
    secondsLeft = 60;
    totalQuestions = 0;
    correctQuestions = 0;
    wrongAnswersLog = [];

    timeBadge.textContent = '60';
    scoreBadge.textContent = '0';
    streakBadge.textContent = '0';

    welcomeView.style.display = 'none';
    gameOverView.style.display = 'none';
    activeView.style.display = 'block';

    ansInput.disabled = false;
    startBtn.disabled = true;
    stopBtn.disabled = false;

    opSelect.disabled = true;
    diffSelect.disabled = true;

    generateEquation();

    gameInterval = setInterval(() => {
      secondsLeft--;
      timeBadge.textContent = String(secondsLeft);

      if (secondsLeft <= 0) {
        handleEnd();
      }
    }, 1000);
  }

  function handleEnd() {
    clearInterval(gameInterval);
    isGameActive = false;
    
    ansInput.disabled = true;
    startBtn.disabled = false;
    stopBtn.disabled = true;
    
    opSelect.disabled = false;
    diffSelect.disabled = false;

    activeView.style.display = 'none';

    // Summary calculations
    const accuracy = totalQuestions > 0 ? Math.round((correctQuestions / totalQuestions) * 100) : 100;
    summaryScore.textContent = String(score);
    summaryAccuracy.textContent = `${accuracy}%`;
    summaryStreak.textContent = String(maxStreak);

    // List incorrect questions
    if (wrongAnswersLog.length > 0) {
      wrongList.innerHTML = wrongAnswersLog.map(item => `
        <li>
          <span>${item.question} = <strong>${item.correct}</strong></span> 
          (You answered <code>${item.user}</code>)
        </li>
      `).join('');
      wrongSection.style.display = 'block';
    } else {
      wrongSection.style.display = 'none';
    }

    gameOverView.style.display = 'block';
  }

  function handleAnswerSubmit() {
    if (!isGameActive) return;

    const userVal = parseInt(ansInput.value);
    if (isNaN(userVal)) return;

    totalQuestions++;
    
    const cardEl = document.querySelector('.trainer-flashcard');
    const prevBg = cardEl.style.background;

    if (userVal === currentCorrectAnswer) {
      correctQuestions++;
      streak++;
      if (streak > maxStreak) maxStreak = streak;

      // Score weight (increases with streak)
      const multiplier = Math.floor(streak / 5) + 1;
      score += 10 * multiplier;

      scoreBadge.textContent = String(score);
      streakBadge.textContent = String(streak);

      // Flash green effect
      cardEl.style.background = 'rgba(16, 185, 129, 0.15)';
      setTimeout(() => cardEl.style.background = prevBg, 150);

      generateEquation();
    } else {
      // Record error log
      const rawPromptText = eqDisplay.innerHTML.replace('&times;', '×').replace('&divide;', '÷');
      wrongAnswersLog.push({
        question: rawPromptText,
        correct: currentCorrectAnswer,
        user: userVal
      });

      streak = 0;
      streakBadge.textContent = '0';

      // Flash red effect
      cardEl.style.background = 'rgba(239, 68, 68, 0.15)';
      setTimeout(() => cardEl.style.background = prevBg, 150);

      generateEquation();
    }
  }

  ansInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      handleAnswerSubmit();
    }
  });

  startBtn.addEventListener('click', handleStart);
  stopBtn.addEventListener('click', () => {
    handleEnd();
    welcomeView.style.display = 'block';
    gameOverView.style.display = 'none';
  });
});
