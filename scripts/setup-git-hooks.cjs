// Runs on `npm install` (the "prepare" script) and points git at the shared .githooks folder,
// so every developer gets the .env push check without any manual setup.
// Never fails the install: CI/Vercel builds without a .git folder just skip it.
const { execSync } = require('child_process');

try {
  execSync('git rev-parse --is-inside-work-tree', { stdio: 'ignore' });
  execSync('git config core.hooksPath .githooks', { stdio: 'ignore' });
  console.log('✔ Git hooks enabled (.githooks)');
} catch {
  // Not a git checkout or git not installed: nothing to set up.
}
