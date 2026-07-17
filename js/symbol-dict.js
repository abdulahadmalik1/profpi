// profpi — Symbol Dictionary & LaTeX Generator script

const SYMBOLS_DATA = [
  { symbol: 'Σ', slug: 'sigma', name: 'Sigma', category: 'Greek', latex: '\\sum', desc: 'Summation of a sequence', example: '\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}' },
  { symbol: '∫', slug: 'integral', name: 'Integral', category: 'Calculus', latex: '\\int', desc: 'Integration/area under curve', example: '\\int x^2 \\, dx = \\frac{x^3}{3} + C' },
  { symbol: 'θ', slug: 'theta', name: 'Theta', category: 'Greek', latex: '\\theta', desc: 'Representing an unknown angle', example: '\\sin(\\theta) = \\frac{\\text{opposite}}{\\text{hypotenuse}}' },
  { symbol: 'π', slug: 'pi', name: 'Pi', category: 'Greek', latex: '\\pi', desc: 'Ratio of circumference to diameter', example: 'A = \\pi r^2' },
  { symbol: '∞', slug: 'infinity', name: 'Infinity', category: 'Arithmetic', latex: '\\infty', desc: 'Boundless/limitless quantity', example: '\\lim_{x \\to \\infty} \\frac{1}{x} = 0' },
  { symbol: 'Δ', slug: 'delta', name: 'Delta', category: 'Greek', latex: '\\Delta', desc: 'Change or difference', example: '\\Delta y / \\Delta x' },
  { symbol: '∂', slug: 'partial', name: 'Partial Derivative', category: 'Calculus', latex: '\\partial', desc: 'Partial differentiation', example: '\\frac{\\partial f}{\\partial x}' },
  { symbol: '≈', slug: 'approx', name: 'Approximately Equal', category: 'Arithmetic', latex: '\\approx', desc: 'Relatively close to equal', example: '\\pi \\approx 3.14159' },
  { symbol: '∀', slug: 'forall', name: 'For All', category: 'Logic', latex: '\\forall', desc: 'Universal quantifier', example: '\\forall x \\in \\mathbb{R}, x^2 \\ge 0' },
  { symbol: '∃', slug: 'exists', name: 'There Exists', category: 'Logic', latex: '\\exists', desc: 'Existential quantifier', example: '\\exists x \\text{ s.t. } x - 5 = 0' },
  { symbol: '∈', slug: 'element', name: 'Element of', category: 'Set Theory', latex: '\\in', desc: 'Membership in a set', example: '5 \\in \\mathbb{Z}' },
  { symbol: '∉', slug: 'notelement', name: 'Not an Element of', category: 'Set Theory', latex: '\\notin', desc: 'Non-membership in a set', example: '\\pi \\notin \\mathbb{Q}' },
  { symbol: '⊂', slug: 'subset', name: 'Subset of', category: 'Set Theory', latex: '\\subset', desc: 'Proper subset relation', example: '\\mathbb{N} \\subset \\mathbb{Z}' },
  { symbol: '∪', slug: 'union', name: 'Union', category: 'Set Theory', latex: '\\cup', desc: 'Collection of elements in either set', example: 'A \\cup B' },
  { symbol: '∩', slug: 'intersection', name: 'Intersection', category: 'Set Theory', latex: '\\cap', desc: 'Common elements of sets', example: 'A \\cap B' }
];

document.addEventListener('DOMContentLoaded', () => {
  const grid = document.getElementById('symbols-grid');
  const searchInput = document.getElementById('search-input');
  const chips = document.querySelectorAll('.filter-chip');
  const toast = document.getElementById('toast');
  const playgroundInput = document.getElementById('playground-input');
  const playgroundPreview = document.getElementById('playground-preview');

  let activeCategory = 'all';
  let katexLoaded = false;
  let isLoadingKatex = false;

  // 1. Render function
  function renderSymbols() {
    if (!grid) return;
    const query = searchInput.value.toLowerCase().trim();
    
    const filtered = SYMBOLS_DATA.filter(s => {
      const matchCat = activeCategory === 'all' || s.category === activeCategory;
      const matchQuery = !query || 
                         s.name.toLowerCase().includes(query) || 
                         s.symbol.includes(query) || 
                         s.latex.toLowerCase().includes(query);
      return matchCat && matchQuery;
    });

    grid.innerHTML = filtered.map(s => `
      <div class="symbol-card">
        <a href="/tools/symbol-dictionary/${s.slug}/" style="text-decoration:none; color:inherit;">
          <div class="symbol-category">${s.category}</div>
          <div class="symbol-glyph">${s.symbol}</div>
          <div class="symbol-name">${s.name}</div>
        </a>
        <div class="symbol-actions">
          <button class="btn-copy copy-unicode" data-copy="${s.symbol}" title="Copy symbol character">Copy</button>
          <button class="btn-copy copy-latex" data-copy="${s.latex}" title="Copy LaTeX code">LaTeX</button>
        </div>
      </div>
    `).join('');

    // Bind copy actions
    grid.querySelectorAll('.copy-unicode, .copy-latex').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const text = btn.getAttribute('data-copy');
        navigator.clipboard.writeText(text).then(() => {
          showToast(`Copied "${text}"!`);
        });
      });
    });
  }

  // 2. Toast alerts
  function showToast(message) {
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('show');
    setTimeout(() => {
      toast.classList.remove('show');
    }, 2000);
  }

  // 3. Search and filtering events
  if (searchInput) {
    searchInput.addEventListener('input', renderSymbols);
  }

  chips.forEach(chip => {
    chip.addEventListener('click', () => {
      chips.forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      activeCategory = chip.getAttribute('data-category');
      renderSymbols();
    });
  });

  // Render initial list
  renderSymbols();

  // 4. Lazy-load KaTeX
  function lazyLoadKatex(callback) {
    if (katexLoaded) {
      if (callback) callback();
      return;
    }
    if (isLoadingKatex) {
      // already loading, wait and retry
      setTimeout(() => lazyLoadKatex(callback), 100);
      return;
    }
    isLoadingKatex = true;

    // Load styles
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://cdn.jsdelivr.net/npm/katex@0.16.8/dist/katex.min.css';
    document.head.appendChild(link);

    // Load script
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/katex@0.16.8/dist/katex.min.js';
    script.defer = true;
    script.onload = () => {
      katexLoaded = true;
      isLoadingKatex = false;
      if (callback) callback();
    };
    document.head.appendChild(script);
  }

  // 5. Playground Live Rendering
  function renderPlayground() {
    const text = playgroundInput.value.trim();
    if (!text) {
      playgroundPreview.innerHTML = '<span style="color: var(--text-muted); font-size: 0.95rem;">Live rendered preview will appear here...</span>';
      return;
    }

    lazyLoadKatex(() => {
      try {
        window.katex.render(text, playgroundPreview, {
          throwOnError: false,
          displayMode: true
        });
      } catch (err) {
        playgroundPreview.innerHTML = `<span style="color: var(--danger); font-size: 0.9rem;">Error: ${err.message}</span>`;
      }
    });
  }

  if (playgroundInput) {
    // Start loading KaTeX as soon as they click/focus the input box
    playgroundInput.addEventListener('focus', () => lazyLoadKatex());
    playgroundInput.addEventListener('input', renderPlayground);
  }
});
