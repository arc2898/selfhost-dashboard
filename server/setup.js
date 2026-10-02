/* One-time setup: creates the first admin user.
   Run with: npm run setup
*/
const readline = require('readline');
const { hasAnyUser, createUser } = require('./services/authService');

function ask(question, { hidden = false } = {}) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    if (!hidden) {
      rl.question(question, answer => { rl.close(); resolve(answer); });
      return;
    }
    // Basic masked input for the password prompt
    const stdin = process.stdin;
    process.stdout.write(question);
    let value = '';
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const onData = char => {
      char = char.toString();
      if (char === '\n' || char === '\r' || char === '\u0004') {
        stdin.setRawMode(false);
        stdin.pause();
        stdin.removeListener('data', onData);
        process.stdout.write('\n');
        rl.close();
        resolve(value);
      } else if (char === '\u0003') {
        process.exit(1);
      } else if (char === '\u007f') {
        value = value.slice(0, -1);
      } else {
        value += char;
      }
    };
    stdin.on('data', onData);
  });
}

(async () => {
  if (hasAnyUser()) {
    console.log('A user already exists. Setup has already been completed.');
    console.log('To reset, delete data/users.json and re-run "npm run setup".');
    process.exit(0);
  }
  console.log('=== Self-Hosted Dashboard: initial admin setup ===');
  const username = (await ask('Choose an admin username: ')).trim() || 'admin';
  let password = '';
  while (password.length < 8) {
    password = await ask('Choose a password (min 8 characters): ', { hidden: true });
    if (password.length < 8) console.log('Too short, try again.');
  }
  await createUser(username, password, { isAdmin: true });
  console.log(`Admin user "${username}" created. You can now run "npm start".`);
  process.exit(0);
})();
