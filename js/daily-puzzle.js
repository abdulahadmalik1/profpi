// profpi — Daily Math Puzzle script

const PUZZLES = [
  // Sunday (0)
  {
    question: `Circle + Circle = 10<br>Circle + Triangle = 12<br>Triangle × Square = 28<br><br><strong>Square = ?</strong>`,
    answer: 4,
    steps: [
      `From the first line, <code>Circle + Circle = 10</code>. Therefore, <code>Circle = 5</code>.`,
      `From the second line, <code>Circle + Triangle = 12</code>. Since Circle is 5, we get: <code>5 + Triangle = 12</code>, which means <code>Triangle = 7</code>.`,
      `From the third line, <code>Triangle × Square = 28</code>. Since Triangle is 7, we get: <code>7 × Square = 28</code>.`,
      `Divide by 7 to solve: <code>Square = 4</code>.`
    ]
  },
  // Monday (1)
  {
    question: `Find the next number in this sequence:<br><br><span style="font-family: monospace; font-size:1.5rem; letter-spacing:0.05em;">1, 4, 9, 61, 52, 63, 94, ?</span>`,
    answer: 46,
    steps: [
      `Look closely at the numbers as perfect squares of integers from 1 to 8:
       <br><code>1² = 01</code>, <code>2² = 04</code>, <code>3² = 09</code>, <code>4² = 16</code>, <code>5² = 25</code>, <code>6² = 36</code>, <code>7² = 49</code>, <code>8² = 64</code>.`,
      `Notice that the digits of each square are reversed:
       <br>01 → 1, 04 → 4, 09 → 9, 16 → 61, 25 → 52, 36 → 63, 49 → 94.`,
      `The next square is <code>8² = 64</code>. Reversing its digits gives <strong>46</strong>.`
    ]
  },
  // Tuesday (2)
  {
    question: `Find the next term in this pattern:<br><br><span style="font-family: monospace; font-size:1.5rem; letter-spacing:0.05em;">3, 5, 9, 17, 33, ?</span>`,
    answer: 65,
    steps: [
      `Look at the differences between consecutive terms:
       <br><code>5 - 3 = 2</code>
       <br><code>9 - 5 = 4</code>
       <br><code>17 - 9 = 8</code>
       <br><code>33 - 17 = 16</code>`,
      `The differences are powers of 2: 2, 4, 8, 16. The next difference must be <code>32</code>.`,
      `Add this difference to the last term: <code>33 + 32 = 65</code>.`,
      `Alternatively, the recurrence rule is <code>a_n = 2 · a_{n-1} - 1</code>: <code>2 · 33 - 1 = 65</code>.`
    ]
  },
  // Wednesday (3)
  {
    question: `If:<br>3 + 4 = 19<br>5 + 6 = 41<br><br><strong>Then: 7 + 8 = ?</strong>`,
    answer: 71,
    steps: [
      `Analyze the relationship between the inputs and output. Let the inputs be $a$ and $b$.`,
      `Look at the formula: <code>a × b + (a + b)</code>.`,
      `Check line 1: <code>3 × 4 + (3 + 4) = 12 + 7 = 19</code> (Correct).`,
      `Check line 2: <code>5 × 6 + (5 + 6) = 30 + 11 = 41</code> (Correct).`,
      `Apply formula to line 3: <code>7 × 8 + (7 + 8) = 56 + 15 = 71</code>.`
    ]
  },
  // Thursday (4)
  {
    question: `If:<br>1 = 5<br>2 = 25<br>3 = 125<br>4 = 625<br><br><strong>5 = ?</strong>`,
    answer: 1,
    steps: [
      `Read the very first line of the puzzle carefully: <code>1 = 5</code>.`,
      `In mathematics, the equality relation is symmetric: if <code>A = B</code>, then <code>B = A</code>.`,
      `Since <code>1 = 5</code>, it directly follows that <code>5 = 1</code>.`
    ]
  },
  // Friday (5)
  {
    question: `A bat and a ball cost $1.10 in total.<br>The bat costs $1.00 more than the ball.<br><br><strong>How much does the ball cost in cents?</strong>`,
    answer: 5,
    steps: [
      `Let the price of the bat be $x$ and the ball be $y$.`,
      `We have two algebraic equations:
       <br>1) <code>x + y = 1.10</code>
       <br>2) <code>x - y = 1.00</code> (bat costs 1.00 more than ball)`,
      `Substitute equation 2 into 1: <code>(y + 1.00) + y = 1.10</code>, which simplifies to <code>2y + 1.00 = 1.10</code>.`,
      `Subtract 1.00 from both sides: <code>2y = 0.10</code>, hence <code>y = 0.05</code> dollars (5 cents).`
    ]
  },
  // Saturday (6)
  {
    question: `What number should replace the question mark in this sequence?<br><br><span style="font-family: monospace; font-size:1.5rem; letter-spacing:0.05em;">3, 2, 7, 6, 11, ?</span>`,
    answer: 10,
    steps: [
      `Observe the pattern of operations between consecutive numbers:
       <br><code>3 - 1 = 2</code>
       <br><code>2 + 5 = 7</code>
       <br><code>7 - 1 = 6</code>
       <br><code>6 + 5 = 11</code>`,
      `The operations alternate between <strong>subtracting 1</strong> and <strong>adding 5</strong>.`,
      `The next operation in the loop is subtracting 1: <code>11 - 1 = 10</code>.`
    ]
  }
];

document.addEventListener('DOMContentLoaded', () => {
  const dateTitle = document.getElementById('puzzle-title-date');
  const display = document.getElementById('puzzle-display');
  const answerInput = document.getElementById('answer-input');
  const submitBtn = document.getElementById('submit-btn');
  const shareBtn = document.getElementById('share-btn');
  const expContainer = document.getElementById('explanation-container');
  const expSteps = document.getElementById('explanation-steps');
  const errorAlert = document.getElementById('error-alert');
  const successAlert = document.getElementById('success-alert');
  const successMessage = document.getElementById('success-message');
  const toast = document.getElementById('toast');

  let attempts = 0;
  let solved = false;

  // Resolve current date details
  const today = new Date();
  const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
  const formattedDate = today.toLocaleDateString('en-US', options);
  
  if (dateTitle) {
    dateTitle.textContent = `Daily Math Puzzle — ${today.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`;
  }

  // Get index based on day of week
  const dayIndex = today.getDay(); // 0 to 6
  const puzzle = PUZZLES[dayIndex];

  if (display) {
    display.innerHTML = puzzle.question;
  }

  // Check solved states in localstorage to preserve scores
  const savedSolveKey = `profpi-puzzle-solved-${today.toISOString().split('T')[0]}`;
  const savedAttemptsKey = `profpi-puzzle-attempts-${today.toISOString().split('T')[0]}`;

  if (localStorage.getItem(savedSolveKey) === 'true') {
    solved = true;
    attempts = parseInt(localStorage.getItem(savedAttemptsKey)) || 1;
    showSuccessState();
  }

  function showSuccessState() {
    successMessage.innerHTML = `<strong>Correct!</strong> You solved the puzzle in <strong>${attempts}</strong> ${attempts === 1 ? 'attempt' : 'attempts'}!`;
    successAlert.style.display = 'flex';
    submitBtn.style.display = 'none';
    answerInput.disabled = true;
    shareBtn.style.display = 'flex';
    
    // Show step solutions
    expSteps.innerHTML = puzzle.steps.map(s => `<li>${s}</li>`).join('');
    expContainer.style.display = 'block';
  }

  submitBtn.addEventListener('click', () => {
    errorAlert.style.display = 'none';
    const userVal = parseFloat(answerInput.value);

    if (isNaN(userVal)) {
      errorAlert.textContent = 'Please enter a valid numerical answer.';
      errorAlert.style.display = 'block';
      return;
    }

    attempts++;
    if (userVal === puzzle.answer) {
      solved = true;
      localStorage.setItem(savedSolveKey, 'true');
      localStorage.setItem(savedAttemptsKey, String(attempts));
      showSuccessState();
    } else {
      errorAlert.textContent = 'Incorrect answer. Keep trying!';
      errorAlert.style.display = 'block';
    }
  });

  shareBtn.addEventListener('click', () => {
    const shareText = `profpi Daily Math Puzzle 🧩 ${formattedDate}\nResult: Solved in ${attempts} ${attempts === 1 ? 'attempt' : 'attempts'}! ✅\nPlay here: https://www.profpi.com/tools/daily-puzzle/`;
    
    navigator.clipboard.writeText(shareText).then(() => {
      if (toast) {
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 2000);
      }
    });
  });
});
