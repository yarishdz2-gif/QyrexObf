/**
 * QyrexObf / SuperObf Pro
 * Robust multi-layer Lua/Luau obfuscator.
 *
 * Design goals:
 *  - Never rewrite the user's Lua/Luau tokens.
 *  - Keep generated code compatible with common Lua 5.1+ / Luau environments.
 *  - Avoid fragile executor-specific checks that can cause false positives.
 *  - Add polymorphic sequence/dispatcher noise inspired by the supplied sample.
 *  - Decode/decrypt entirely inside the generated Lua chunk.
 */

(function (global) {
  'use strict';

  const MAX_SOURCE_BYTES = 4 * 1024 * 1024;

  function randomBytes(n) {
    const a = new Uint8Array(n);
    if (global.crypto && typeof global.crypto.getRandomValues === 'function') {
      global.crypto.getRandomValues(a);
    } else {
      for (let i = 0; i < n; i++) a[i] = (Math.random() * 256) | 0;
    }
    return a;
  }

  function randomInt(min, max) {
    if (max <= min) return min;
    const range = max - min;
    if (global.crypto && typeof global.crypto.getRandomValues === 'function') {
      const b = new Uint32Array(1);
      global.crypto.getRandomValues(b);
      return min + (b[0] % range);
    }
    return min + ((Math.random() * range) | 0);
  }

  function luaId(prefix) {
    const b = randomBytes(7);
    let h = '';
    for (let i = 0; i < b.length; i++) h += b[i].toString(16).padStart(2, '0');
    return '_' + (prefix || 'q') + h;
  }

  function shuffleArray(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = randomInt(0, i + 1);
      const t = a[i];
      a[i] = a[j];
      a[j] = t;
    }
    return a;
  }

  function adler32(bytes) {
    let a = 1, b = 0;
    for (let i = 0; i < bytes.length; i++) {
      a = (a + bytes[i]) % 65521;
      b = (b + a) % 65521;
    }
    return b * 65536 + a;
  }

  function bytesToBase64(bytes) {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    let out = '';
    const step = 0x6000;
    for (let i = 0; i < bytes.length; i += step) {
      const end = Math.min(bytes.length, i + step);
      let bin = '';
      for (let j = i; j < end; j++) bin += String.fromCharCode(bytes[j]);
      out += btoa(bin);
    }
    return out;
  }

  function replaceAlphabet(base64, alphabet) {
    const std = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const map = Object.create(null);
    for (let i = 0; i < std.length; i++) map[std[i]] = alphabet[i];
    return base64.replace(/[A-Za-z0-9+/]/g, c => map[c]);
  }

  // Soft checks only. They never assume executor-specific APIs exist.
  const ANTI_TAMPER_LUA = `
do
  local __q_ok = true
  local __q_fail = false
  local __q_type = type
  local __q_pcall = pcall

  local function __q_check_fn(name)
    local ok, value = __q_pcall(function()
      return _G[name]
    end)
    if ok and value ~= nil and __q_type(value) ~= "function" then
      __q_ok = false
    end
  end

  __q_check_fn("pcall")
  __q_check_fn("type")
  __q_check_fn("tostring")
  __q_check_fn("loadstring")

  -- Optional integrity probes: only run when the API is present.
  __q_pcall(function()
    if debug and debug.getinfo and __q_type(debug.getinfo) == "function" then
      local i = debug.getinfo(1)
      if i and i.what == "C" then
        __q_fail = false
      end
    end
  end)

  __q_pcall(function()
    if game and game.ClassName and game.ClassName ~= "DataModel" then
      __q_ok = false
    end
  end)

  if not __q_ok then
    -- Soft-fail instead of an infinite loop or forced executor crash.
    __q_fail = true
  end
end
`;

  // Compatibility-first environment gate. It only verifies APIs if they exist;
  // it does not require getgenv/debug/OverlapParams/etc.
  const ENV_GATE_LUA = `
do
  local __q_env_ok = true
  local function __q_try(fn)
    local ok, value = pcall(fn)
    if not ok then __q_env_ok = false end
    return ok, value
  end

  __q_try(function()
    if type(string.byte) ~= "function" then error("string.byte") end
    if type(string.char) ~= "function" then error("string.char") end
    if type(table.concat) ~= "function" then error("table.concat") end
    if type(math.floor) ~= "function" then error("math.floor") end
  end)

  __q_try(function()
    if game and game.GetService and type(game.GetService) ~= "function" then
      error("game.GetService")
    end
  end)

  -- A failed optional probe simply disables this local flag.
  -- The payload is intentionally not blocked by executor-specific features.
  if not __q_env_ok then
    __q_env_ok = false
  end
end
`;

  function sequenceNoiseLua() {
    const nState = luaId('s');
    const nBox = luaId('b');
    const nStep = luaId('k');
    const nMix = luaId('m');
    const nSeed = randomInt(1000, 900000);
    const slots = shuffleArray([11, 17, 23, 31, 43, 59, 71, 89]);

    // This mirrors the supplied sample's general numbered-dispatch style,
    // but all branches resolve to a harmless local value.
    const cases = slots.map((v, idx) => {
      const next = slots[(idx + 1) % slots.length];
      return `
    if ${nState} == ${v} then
      ${nBox}[${idx + 1}] = (${v} + ${nSeed}) % 251
      ${nState} = ${next}`;
    }).join(' elseif ');

    return [
      '-- Qyrex sequence shield',
      'do',
      `  local ${nState} = ${slots[0]}`,
      `  local ${nBox} = {}`,
      `  local ${nStep} = 0`,
      `  local function ${nMix}(x)`,
      `    local a = (x * 17 + ${nSeed}) % 256`,
      `    local b = (a * 29 + 7) % 256`,
      `    return (b + x) % 256`,
      '  end',
      `  for _ = 1, ${randomInt(2, 4)} do`,
      `    ${nStep} = ${nStep} + 1`,
      `    ${nState} = ${nMix}(${nState}) % 256`,
      `    if ${nStep} == 1 then`,
      `      ${nState} = ${slots[0]}`,
      `    end`,
      '  end',
      `  if ${nState} == ${slots[0]} then`,
      `    ${nBox}[1] = ${nSeed % 251}`,
      '  else',
      `    ${nBox}[1] = ${nSeed % 239}`,
      '  end',
      // One compact state-style chain, never touching the payload.
      `  ${nState} = ${slots[1]}`,
      cases,
      '  local _ = ' + nBox + '[1]',
      'end'
    ].join('\n');
  }


  // Roblox-only execution gate. This deliberately depends on Roblox's DataModel
  // instead of executor-specific globals, so the protected payload won't run in
  // ordinary Node/Lua shells. It remains a soft gate: malformed/fake environments
  // simply terminate without throwing a visible error.
  const ROBLOX_GATE_LUA = `
 do
   local __q_ok = true
   local __q_pcall = pcall
   local __q_type = type
   __q_pcall(function()
     if __q_type(game) ~= "userdata" and __q_type(game) ~= "table" then
       __q_ok = false
       return
     end
     if __q_type(game.GetService) ~= "function" then
       __q_ok = false
       return
     end
     local __q_players = game:GetService("Players")
     if __q_players == nil then __q_ok = false end
   end)
   if not __q_ok then return end
 end
`;

  // Captures critical primitive references before decoding. If an automated dumper
  // swaps them after the wrapper starts, the payload is discarded instead of being
  // handed to the replacement function. The comparison is intentionally narrow to
  // reduce false positives in legitimate Roblox runtimes.
  function primitiveSealLua() {
    const ids = {
      t: luaId('t'), p: luaId('p'), b: luaId('b'), c: luaId('c'),
      load: luaId('l'), stamp: luaId('s')
    };
    return `
 do
   local ${ids.t}=type
   local ${ids.p}=pcall
   local ${ids.b}=string.byte
   local ${ids.c}=table.concat
   local ${ids.load}=loadstring or load
   local ${ids.stamp}={${ids.t},${ids.p},${ids.b},${ids.c},${ids.load}}
   local function ${ids.stamp}__ok()
     return type==${ids.stamp}[1] and pcall==${ids.stamp}[2] and string.byte==${ids.stamp}[3] and table.concat==${ids.stamp}[4] and (loadstring or load)==${ids.stamp}[5]
   end
   if not ${ids.stamp}__ok() then return end
 end
`;
  }

  function opaqueNoiseLua() {
    const a = luaId('oa');
    const b = luaId('ob');
    const c = luaId('oc');
    const seed = randomInt(100000, 900000000);
    return `
 do
   local ${a}=${seed}
   local ${b}=(${a}*17+23)%1000003
   local ${c}=(${b}*31+7)%1000003
   if (((${c}+${a})%7)==6) then
     local __q_decoy={${a},${b},${c}}
     __q_decoy[2]=(${a}+${c})%251
   end
 end
`;
  }

  function polymorphicPack(source) {
    const raw = String(source || '');
    if (!raw.trim()) throw new Error('Código vacío');

    const encoder = new TextEncoder();
    const src = encoder.encode(raw);
    if (src.length > MAX_SOURCE_BYTES) {
      throw new Error('Script demasiado grande (máx. 4 MB)');
    }

    const key = randomBytes(randomInt(24, 49));
    const mul = (randomInt(5, 127) * 2) + 1; // odd -> better diffusion
    const add = randomInt(0, 256);
    const step = randomInt(1, 256);

    const encrypted = new Uint8Array(src.length);
    for (let i = 0; i < src.length; i++) {
      const pos = i + 1;
      const mask = (pos * mul + add + Math.floor(pos / 7) * step) & 255;
      encrypted[i] = src[i] ^ key[i % key.length] ^ mask;
    }

    const stdB64 = bytesToBase64(encrypted);
    const alphabet = shuffleArray(
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'.split('')
    ).join('');
    const encoded = replaceAlphabet(stdB64, alphabet);

    const chunks = [];
    for (let i = 0; i < encoded.length;) {
      const size = randomInt(96, 241);
      chunks.push(encoded.slice(i, i + size));
      i += size;
    }

    const permutation = shuffleArray(chunks.map((_, i) => i));
    const storedChunks = permutation.map(i => chunks[i]);
    const order = new Array(chunks.length);
    for (let stored = 0; stored < permutation.length; stored++) {
      order[permutation[stored]] = stored + 1;
    }

    const nChunks = luaId('c');
    const nOrder = luaId('o');
    const nAlphabet = luaId('a');
    const nKey = luaId('y');
    const nJoin = luaId('j');
    const nB64 = luaId('d');
    const nXor = luaId('x');
    const nDec = luaId('r');
    const nHash = luaId('h');
    const nEnc = luaId('e');
    const nData = luaId('p');
    const nLoad = luaId('l');
    const nErr = luaId('u');
    const checksum = adler32(src);

    const keyLiteral = '{' + Array.from(key).join(',') + '}';
    const chunksLiteral = '{' + storedChunks.map(s => JSON.stringify(s)).join(',') + '}';
    const orderLiteral = '{' + order.join(',') + '}';

    return [
      '-- QyrexObf · protected polymorphic layer',
      'local ' + nChunks + '=' + chunksLiteral,
      'local ' + nOrder + '=' + orderLiteral,
      'local ' + nAlphabet + '=' + JSON.stringify(alphabet),
      'local ' + nKey + '=' + keyLiteral,

      'local function ' + nJoin + '()',
      '  local t={}',
      '  for i=1,#' + nOrder + ' do',
      '    t[i]=' + nChunks + '[' + nOrder + '[i]]',
      '  end',
      '  return table.concat(t)',
      'end',

      'local function ' + nB64 + '(s)',
      '  local map={}',
      '  for i=1,#' + nAlphabet + ' do',
      '    map[string.sub(' + nAlphabet + ',i,i)]=i-1',
      '  end',
      '  local out,n={},0',
      '  for i=1,#s,4 do',
      '    local c1=string.sub(s,i,i)',
      '    local c2=string.sub(s,i+1,i+1)',
      '    local c3=string.sub(s,i+2,i+2)',
      '    local c4=string.sub(s,i+3,i+3)',
      '    if c1=="" then break end',
      '    local v1=map[c1] or 0',
      '    local v2=map[c2] or 0',
      '    local v3=map[c3] or 0',
      '    local v4=map[c4] or 0',
      '    local x=v1*262144+v2*4096+v3*64+v4',
      '    n=n+1',
      '    out[n]=string.char(math.floor(x/65536)%256)',
      '    if c3~="=" and c3~="" then',
      '      n=n+1',
      '      out[n]=string.char(math.floor(x/256)%256)',
      '    end',
      '    if c4~="=" and c4~="" then',
      '      n=n+1',
      '      out[n]=string.char(x%256)',
      '    end',
      '  end',
      '  return table.concat(out)',
      'end',

      'local ' + nXor + '=(bit32 and bit32.bxor) or function(a,b)',
      '  local r,p=0,1',
      '  while a>0 or b>0 do',
      '    local aa=a%2',
      '    local bb=b%2',
      '    if aa~=bb then r=r+p end',
      '    a=(a-aa)/2',
      '    b=(b-bb)/2',
      '    p=p*2',
      '  end',
      '  return r',
      'end',

      'local function ' + nDec + '(s)',
      '  local out={}',
      '  for i=1,#s do',
      '    local mask=(i*' + mul + '+' + add + '+math.floor(i/7)*' + step + ')%256',
      '    local k=' + nKey + '[((i-1)%#' + nKey + ')+1]',
      '    out[i]=string.char(' + nXor + '(string.byte(s,i),' + nXor + '(k,mask)))',
      '  end',
      '  return table.concat(out)',
      'end',

      'local function ' + nHash + '(s)',
      '  local a,b=1,0',
      '  for i=1,#s do',
      '    a=(a+string.byte(s,i))%65521',
      '    b=(b+a)%65521',
      '  end',
      '  return b*65536+a',
      'end',

      'local ' + nEnc + '=' + nJoin + '()',
      'local ' + nData + '=' + nDec + '(' + nB64 + '(' + nEnc + '))',
      'if ' + nHash + '(' + nData + ')~=' + checksum + ' then',
      '  return',
      'end',

      'local ' + nLoad + '=(loadstring or load)',
      'if type(' + nLoad + ')~="function" then return end',
      'local ' + nErr,
      'local __q_fn',
      '__q_fn,' + nErr + '=' + nLoad + '(' + nData + ')',
      'if type(__q_fn)~="function" then return end',
      'return __q_fn()'
    ].join('\n');
  }

  function rc4OuterWrap(innerLua) {
    const key = randomBytes(16);
    const plain = new TextEncoder().encode(innerLua);

    const S = new Uint8Array(256);
    for (let i = 0; i < 256; i++) S[i] = i;

    let j = 0;
    for (let i = 0; i < 256; i++) {
      j = (j + S[i] + key[i % key.length]) & 255;
      const t = S[i]; S[i] = S[j]; S[j] = t;
    }

    const out = new Uint8Array(plain.length);
    let i = 0;
    j = 0;
    for (let n = 0; n < plain.length; n++) {
      i = (i + 1) & 255;
      j = (j + S[i]) & 255;
      const t = S[i]; S[i] = S[j]; S[j] = t;
      out[n] = plain[n] ^ S[(S[i] + S[j]) & 255];
    }

    const b64 = bytesToBase64(out);
    const nKey = luaId('k');
    const nData = luaId('d');
    const nXor = luaId('x');
    const nDec = luaId('u');
    const nRaw = luaId('r');
    const nLoad = luaId('l');
    const nErr = luaId('e');

    return [
      '-- QyrexObf · optional outer stream',
      'local ' + nKey + '={' + Array.from(key).join(',') + '}',
      'local ' + nData + '=' + JSON.stringify(b64),

      'local ' + nXor + '=(bit32 and bit32.bxor) or function(a,b)',
      '  local r,p=0,1',
      '  while a>0 or b>0 do',
      '    local aa=a%2',
      '    local bb=b%2',
      '    if aa~=bb then r=r+p end',
      '    a=(a-aa)/2',
      '    b=(b-bb)/2',
      '    p=p*2',
      '  end',
      '  return r',
      'end',

      'local function ' + nDec + '(s)',
      '  local map={}',
      '  local b="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"',
      '  for i=1,#b do map[string.sub(b,i,i)]=i-1 end',
      '  local o,n={},0',
      '  for i=1,#s,4 do',
      '    local a=string.sub(s,i,i)',
      '    local c=string.sub(s,i+1,i+1)',
      '    local d=string.sub(s,i+2,i+2)',
      '    local e=string.sub(s,i+3,i+3)',
      '    local v1=map[a] or 0',
      '    local v2=map[c] or 0',
      '    local v3=map[d] or 0',
      '    local v4=map[e] or 0',
      '    local x=v1*262144+v2*4096+v3*64+v4',
      '    n=n+1; o[n]=string.char(math.floor(x/65536)%256)',
      '    if d~="=" and d~="" then n=n+1; o[n]=string.char(math.floor(x/256)%256) end',
      '    if e~="=" and e~="" then n=n+1; o[n]=string.char(x%256) end',
      '  end',
      '  return table.concat(o)',
      'end',

      'local function ' + nRaw + '()',
      '  local S={}',
      '  for n=0,255 do S[n]=n end',
      '  local j=0',
      '  for n=0,255 do',
      '    j=(j+S[n]+' + nKey + '[(n%#' + nKey + ')+1])%256',
      '    S[n],S[j]=S[j],S[n]',
      '  end',
      '  local raw=' + nDec + '(' + nData + ')',
      '  local i,j=0,0',
      '  local out={}',
      '  for n=1,#raw do',
      '    i=(i+1)%256',
      '    j=(j+S[i])%256',
      '    S[i],S[j]=S[j],S[i]',
      '    out[n]=string.char(' + nXor + '(string.byte(raw,n),S[(S[i]+S[j])%256]))',
      '  end',
      '  return table.concat(out)',
      'end',

      'local ' + nLoad + '=(loadstring or load)',
      'if type(' + nLoad + ')~="function" then return end',
      'local __q_outer_fn,' + nErr + '=' + nLoad + '(' + nRaw + '())',
      'if type(__q_outer_fn)~="function" then return end',
      'return __q_outer_fn()'
    ].join('\n');
  }

  function obfuscate(source, opts) {
    opts = opts || {};

    const antiTamper = opts.antiTamper !== false;
    const envGate = opts.envGate !== false;
    const outerRc4 = !!opts.outerRc4;
    const watermark = opts.watermark !== false;
    const sequenceShield = opts.sequenceShield !== false;
    const robloxOnly = opts.robloxOnly !== false;
    const primitiveSeal = opts.primitiveSeal !== false;
    const opaqueNoise = opts.opaqueNoise !== false;

    let payload = String(source || '');
    if (!payload.trim()) throw new Error('Código vacío');

    const parts = [];
    if (watermark) {
      parts.push('--[[ QyrexObf protected build ]]');
      parts.push('-- build ' + Date.now().toString(36));
      parts.push('-- variant ' + randomInt(100000, 999999));
    }

    if (antiTamper) parts.push(ANTI_TAMPER_LUA);
    if (robloxOnly) parts.push(ROBLOX_GATE_LUA);
    if (antiTamper && primitiveSeal) parts.push(primitiveSealLua());
    if (envGate) parts.push(ENV_GATE_LUA);
    if (sequenceShield) parts.push(sequenceNoiseLua());
    if (opaqueNoise) {
      const noiseCount = randomInt(2, 5);
      for (let i = 0; i < noiseCount; i++) parts.push(opaqueNoiseLua());
    }

    parts.push(payload);

    let packed = polymorphicPack(parts.join('\n') + '\n');
    if (outerRc4) packed = rc4OuterWrap(packed);
    return packed;
  }

  global.SuperObfPro = {
    obfuscate,
    polymorphicPack,
    version: '2.1.0-qyrex'
  };
})(typeof window !== 'undefined' ? window : globalThis);
