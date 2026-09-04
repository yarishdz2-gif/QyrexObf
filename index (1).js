{
  "name": "qyrexobf",
  "version": "2.0.0",
  "description": "Qyrexobf — advanced multi-layer JavaScript obfuscator",
  "main": "core/index.js",
  "type": "module",
  "bin": {
    "qyrexobf": "./cli/index.js"
  },
  "scripts": {
    "start": "node server.js",
    "obfuscate": "node cli/index.js",
    "test": "node test/tests.js"
  },
  "keywords": [
    "obfuscator",
    "javascript",
    "qyrexobf",
    "code-protection"
  ],
  "author": "Qyrex",
  "license": "MIT",
  "engines": {
    "node": ">=18.0.0"
  },
  "dependencies": {
    "express": "^4.21.2"
  }
}
