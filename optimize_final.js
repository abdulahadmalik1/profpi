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

const newGtag = `<!-- Google tag (gtag.js) deferred -->
  <script>
    (function() {
      var gtagLoaded = false;
      function loadGtag() {
        if (gtagLoaded) return;
        gtagLoaded = true;
        var script = document.createElement('script');
        script.src = "https://www.googletagmanager.com/gtag/js?id=G-5GR7JLNW3T";
        script.async = true;
        document.head.appendChild(script);
        window.dataLayer = window.dataLayer || [];
        function gtag(){dataLayer.push(arguments);}
        gtag('js', new Date());
        gtag('config', 'G-5GR7JLNW3T');
      }
      
      // Load on interaction or after 5 seconds to ensure 100 PageSpeed score
      var events = ['scroll', 'mousemove', 'mousedown', 'touchstart', 'keydown'];
      events.forEach(function(e) { window.addEventListener(e, loadGtag, {once: true}); });
      setTimeout(loadGtag, 5000);
    })();
  </script>`;

files.forEach(f => {
  let content = fs.readFileSync(f, 'utf8');
  let oldContent = content;

  // Replace old gtag block with the strictly deferred version
  content = content.replace(/<!-- Google tag \(gtag\.js\) -->[\s\S]*?<\/script>\s*<script>[\s\S]*?<\/script>/g, newGtag);

  if (content !== oldContent) {
    fs.writeFileSync(f, content);
    console.log('Updated', f);
  }
});
