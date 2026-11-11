import { spawnSync } from 'node:child_process';
const target = process.argv[2];
if (!['hosting', 'rules'].includes(target)) throw new Error('Usage: node scripts/firebase-cli.mjs <hosting|rules>');
const project = String(process.env.FIREBASE_PROJECT_ID || '').trim();
if (!project || project === 'your-project-id') {
  console.error('Set FIREBASE_PROJECT_ID to your own Firebase project before deployment.');
  process.exit(2);
}
const args = ['firebase-tools@15.35.0', 'deploy', '--project', project, '--non-interactive'];
args.splice(2, 0, '--only', target === 'rules' ? 'firestore:rules' : 'hosting');
const command = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const result = spawnSync(command, args, { stdio: 'inherit', shell: false });
process.exit(result.status ?? 1);
