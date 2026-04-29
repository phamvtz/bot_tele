const fs = require('fs');
let code = fs.readFileSync('src/bot/ui/messages.ts', 'utf8');

// Replace Markdown bold *text* with <b>text</b>
code = code.replace(/\*([^\*]+)\*/g, '<b>$1</b>');

// Replace Markdown italic _text_ with <i>text</i>
code = code.replace(/_([^_]+)_/g, '<i>$1</i>');

// Replace Markdown code \`text\` with <code>text</code>
code = code.replace(/\`([^\`\n]+)\`/g, '<code>$1</code>');

// Replace Markdown code blocks \`\`\`...\`\`\` with <pre>...</pre>
code = code.replace(/\`\`\`([^]*?)\`\`\`/g, '<pre>$1</pre>');

fs.writeFileSync('src/bot/ui/messages.ts', code);
console.log('Converted messages.ts to HTML');
