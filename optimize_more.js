const fs = require('fs');
const path = require('path');

function walk(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(function(file) {
    file = path.join(dir, file);
    const stat = fs.statSync(file);
    if (stat && stat.isDirectory() && !file.includes('.git') && !file.includes('node_modules')) {
      results = results.concat(walk(file));
    } else if (file.endsWith('.html')) {
      results.push(file);
    }
  });
  return results;
}

const files = walk('.');

files.forEach(f => {
  let content = fs.readFileSync(f, 'utf8');
  let oldContent = content;

  // 1. Replace remaining logo.png?v=2 with logo.webp
  content = content.replace(/\/assets\/images\/logo\.png\?v=2/g, '/assets/images/logo.webp');

  // 2. Defer Google Analytics
  const oldGtag = `<script async src="https://www.googletagmanager.com/gtag/js?id=G-5GR7JLNW3T"></script>
  <script>
    window.dataLayer = window.dataLayer || [];
    function gtag() { dataLayer.push(arguments); }
    gtag('js', new Date());

    gtag('config', 'G-5GR7JLNW3T');
  </script>`;

  const newGtag = `<script>
    // Defer Google Analytics for 100% PageSpeed
    setTimeout(function() {
      var script = document.createElement('script');
      script.src = "https://www.googletagmanager.com/gtag/js?id=G-5GR7JLNW3T";
      document.head.appendChild(script);
      
      window.dataLayer = window.dataLayer || [];
      function gtag() { dataLayer.push(arguments); }
      gtag('js', new Date());
      gtag('config', 'G-5GR7JLNW3T');
    }, 3500);
  </script>`;

  // Some files might have slightly different indentation, use regex for safety
  const gtagRegex = /<script async src="https:\/\/www\.googletagmanager\.com\/gtag\/js\?id=G-5GR7JLNW3T"><\/script>\s*<script>\s*window\.dataLayer = window\.dataLayer \|\| \[\];\s*function gtag\(\) { dataLayer\.push\(arguments\); }\s*gtag\('js', new Date\(\)\);\s*gtag\('config', 'G-5GR7JLNW3T'\);\s*<\/script>/g;

  content = content.replace(gtagRegex, newGtag);

  if (content !== oldContent) {
    fs.writeFileSync(f, content);
    console.log('Updated', f);
  }
});
