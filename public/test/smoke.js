// Run with Node 18+: node tests/smoke.js
const fs = require('fs');
const vm = require('vm');

const source = "local s='áéíóú 🚀'\\nlocal x={a=1,b=2}\\nreturn s,x.a+x.b";
const code = fs.readFileSync(require.resolve('../public/obfuscator.js'), 'utf8');

const sandbox = {
  TextEncoder,
  TextDecoder,
  btoa,
  atob,
  console,
  performance: { now: () => 0 }
};
sandbox.window = sandbox;
sandbox.crypto = require('crypto').webcrypto;

vm.createContext(sandbox);
vm.runInContext(code, sandbox, { timeout: 5000 });

for (const outerRc4 of [false, true]) {
  const out = sandbox.SuperObfPro.obfuscate(source, {
    antiTamper: true,
    envGate: true,
    outerRc4,
    watermark: true,
    sequenceShield: true
  });

  if (!out || out.includes('undefined') || out.includes('NaN')) {
    throw new Error('Smoke test failed: invalid generated output');
  }

  console.log(`OK outerRc4=${outerRc4} chars=${out.length}`);
}
