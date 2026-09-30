const fs = require('fs');
let content = fs.readFileSync('utils/emailTemplates/companyRegistration.js', 'utf8');
content = content.replace(/\\\${/g, '${');
fs.writeFileSync('utils/emailTemplates/companyRegistration.js', content);
console.log('Fixed interpolations');
