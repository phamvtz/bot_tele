const fs = require('fs');
let code = fs.readFileSync('src/bot/ui/emojis.ts', 'utf8');
code = code.replace(/:\s*'([^']+)',/g, ":    p('$1'),");
fs.writeFileSync('src/bot/ui/emojis.ts', code);
