/**
 * Export Firestore m6_node_data → m6_node_data.csv
 *
 * Run from the project root:
 *   node export_m6_node_data.mjs
 *
 * Requires firebase-admin in apps/processor/node_modules.
 * Delegates to apps/processor/export_m6_node_data.mjs via child process.
 */
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const script = resolve(__dirname, 'apps/processor/export_m6_node_data.mjs');

execFileSync('node', [script], {
  cwd: resolve(__dirname, 'apps/processor'),
  stdio: 'inherit',
});
