const fs = require('fs');
const path = require('path');

function replaceParseMode(dir) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      replaceParseMode(fullPath);
    } else if (fullPath.endsWith('.ts')) {
      let content = fs.readFileSync(fullPath, 'utf8');
      if (content.includes("parse_mode: 'Markdown'") || content.includes('parse_mode: "Markdown"')) {
        content = content.replace(/parse_mode:\s*['"]Markdown['"]/g, "parse_mode: 'HTML'");
        fs.writeFileSync(fullPath, content);
        console.log(`Updated ${fullPath}`);
      }
    }
  }
}

replaceParseMode('src/bot/scenes');
replaceParseMode('src/bot/ui');
