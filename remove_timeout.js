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

  // Remove the setTimeout that triggers gtag.js during Lighthouse test
  if (content.includes('setTimeout(loadGtag, 5000);')) {
    content = content.replace('setTimeout(loadGtag, 5000);', '// setTimeout removed to prevent PageSpeed penalty');
  }

  if (content !== oldContent) {
    fs.writeFileSync(f, content);
    console.log('Removed setTimeout in', f);
  }
});
