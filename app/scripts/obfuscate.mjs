// Post-build obfuscation for the deployed bundle (CI only — run after
// `vite build`, before the Pages artifact is uploaded). The bundle ships to
// a public URL, so anyone can read the client source; this raises the cost
// of reverse-engineering the client (how it talks to the edge functions,
// which fields it ignores, etc.). It is a deterrent, not a security
// boundary — all real enforcement is server-side.
//
// Moderate options on purpose: aggressive settings (selfDefending,
// debugProtection, deadCodeInjection) wreck startup time and can break
// module loading; this keeps identifier renaming + string array + light
// control-flow flattening.
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import JavaScriptObfuscator from 'javascript-obfuscator';

const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const assets = path.join(dist, 'assets');

const files = (await readdir(assets)).filter((f) => f.endsWith('.js'));
if (files.length === 0) {
  console.error(`obfuscate: no .js files found in ${assets} — run vite build first`);
  process.exit(1);
}

for (const file of files) {
  const source = await readFile(path.join(assets, file), 'utf8');
  const result = JavaScriptObfuscator.obfuscate(source, {
    target: 'browser',
    module: true, // vite emits ES modules
    compact: true,
    simplify: true,
    renameGlobals: false,
    // string array: hide literal strings (edge function names, field names)
    stringArray: true,
    stringArrayThreshold: 0.75,
    stringArrayEncoding: ['base64'],
    stringArrayWrappersCount: 2,
    stringArrayWrappersType: 'function',
    // light control-flow flattening; keeps runtime fast
    controlFlowFlattening: true,
    controlFlowFlatteningThreshold: 0.4,
    // off: these break or bloat
    deadCodeInjection: false,
    selfDefending: false,
    debugProtection: false,
    splitStrings: false,
    transformObjectKeys: false,
    unicodeEscapeSequence: false,
  });
  await writeFile(path.join(assets, file), result.getObfuscatedCode());
  console.log(`obfuscated ${file} (${source.length} -> ${result.getObfuscatedCode().length} bytes)`);
}
