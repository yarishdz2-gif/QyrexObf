/**
 * SUPER OBFUSCATOR PRO
 * Multi-layer Lua/Luau packer for browser (GitHub Pages compatible)
 *
 * Layers:
 *  1. Anti-tamper + Env Gate (BESTANTITAMPER + Qrex + Sandbox patterns)
 *  2. Polymorphic XOR + position mask + shuffled Base64 + chunk permutation + Adler32
 *  3. Optional outer RC4-style stream wrap
 *  4. Integrity + decoy fail paths
 *
 * Does NOT rewrite Luau tokens → high executor compatibility.
 */

(function (global) {
  'use strict';

  // ---------- RNG (Web Crypto preferred) ----------
  function randomBytes(n) {
    const a = new Uint8Array(n);
    if (global.crypto && global.crypto.getRandomValues) {
      global.crypto.getRandomValues(a);
    } else {
      for (let i = 0; i < n; i++) a[i] = (Math.random() * 256) | 0;
    }
    return a;
  }

  function randomInt(min, max) {
    // [min, max)
    const range = max - min;
    if (global.crypto && global.crypto.getRandomValues) {
      const buf = new Uint32Array(1);
      global.crypto.getRandomValues(buf);
      return min + (buf[0] % range);
    }
    return min + ((Math.random() * range) | 0);
  }

  function shuffleChars(s) {
    const a = String(s).split('');
    for (let i = a.length - 1; i > 0; i--) {
      const j = randomInt(0, i + 1);
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a.join('');
  }

  function luaId() {
    const b = randomBytes(6);
    let h = '';
    for (let i = 0; i < b.length; i++) h += b[i].toString(16).padStart(2, '0');
    return '_' + h;
  }

  function adler32(buf) {
    let a = 1, b = 0;
    for (let i = 0; i < buf.length; i++) {
      a = (a + buf[i]) % 65521;
      b = (b + a) % 65521;
    }
    return b * 65536 + a;
  }

  // ---------- Layer 1: Anti-tamper + Env Gate ----------
  const ANTI_TAMPER_LUA = `--[[ SuperObf Pro · Anti-Tamper ]]
local __so_ok = true
local function __so_fail(c)
  __so_ok = false
  pcall(function() error("[SO] " .. tostring(c), 0) end)
end

do
  local _ENV = (getfenv and getfenv(0)) or _G
  local rawget, pcall, type, tostring = rawget, pcall, type, tostring
  local clock = (os and os.clock) or tick or function() return 0 end

  -- hooks on critical builtins
  for _, name in ipairs({"print","loadstring","load","setmetatable","pairs","ipairs","rawget","pcall"}) do
    local f = rawget(_ENV, name) or rawget(_G, name)
    if f then
      if type(f) ~= "function" then __so_fail("H-type") end
      local s = tostring(f)
      if not (string.find(s, "builtin") or string.find(s, "0x") or string.find(s, "function")) then
        __so_fail("H-repr")
      end
    end
  end

  -- getgenv / debug integrity (executor context)
  if getgenv then
    local ok, genv = pcall(getgenv)
    if not ok or type(genv) ~= "table" then __so_fail("genv") end
    local mt = getmetatable(genv)
    if mt and (mt.__index or mt.__newindex or mt.__metatable) then __so_fail("genv-mt") end
    if debug and debug.getinfo then
      local info = debug.getinfo(getgenv)
      if not info or info.what ~= "C" then __so_fail("genv-info") end
    end
  end

  -- DataModel
  if game and game.ClassName ~= "DataModel" then __so_fail("dm") end

  -- light latency check
  local t0 = clock()
  for i = 1, 80 do end
  if (clock() - t0) > 0.35 then __so_fail("lat") end
end

if not __so_ok then
  while true do end
end
`;

  const ENV_GATE_LUA = `--[[ SuperObf Pro · Env Gate ]]
local function __soEnvGate()
  local _ok = true
  local function fail() _ok = false end

  do
    local a = true
    local b = getgenv
    local c = debug
    local d = c and c.getinfo
    local e = c and (c.getupvalue or c.getupvalues)
    local f = getmetatable
    local g = iscclosure
    if not b or not d then
      a = false
    else
      local h = b()
      if f(h) and (f(h).__index or f(h).__newindex or f(h).__metatable) then a = false end
      local k = d(b)
      if not k or k.what ~= "C" or k.source ~= "=[C]" then a = false end
      if g and not g(b) then a = false end
      if e then
        local l, m = pcall(e, b, 1)
        if l and m ~= nil then a = false end
      end
      local x = "_t"
      h[x] = 1
      if rawget(h, x) ~= 1 then a = false end
      h[x] = nil
    end
    if not a then fail() end
  end

  do
    local success = pcall(function()
      local c = Instance.new("TerrainRegion")
      assert(typeof(c) == "Instance")
      assert(c.ClassName == "TerrainRegion")
      assert(c:IsA("TerrainRegion"))
      local part = Instance.new("Part")
      local _ = part.Position
      part:Destroy()
    end)
    if not success then fail() end
  end

  do
    if game.ClassName ~= "DataModel" then fail() end
  end

  do
    local w = workspace
    local a = Instance.new("Part")
    local b = Instance.new("Part")
    a.Anchored = true; b.Anchored = true
    a.CFrame = CFrame.new(0,0,0); b.CFrame = CFrame.new(0,0,0)
    a.Parent = w; b.Parent = w
    local q = OverlapParams.new()
    q.IncludeInstances = {a, b}
    local x = w:GetPartBoundsInBox(CFrame.new(), Vector3.new(4,4,4), q)
    q.ExcludeInstances = {b}
    local y = w:GetPartBoundsInBox(CFrame.new(), Vector3.new(4,4,4), q)
    q.IncludeInstances = {}
    local z = w:GetPartBoundsInBox(CFrame.new(), Vector3.new(4,4,4), q)
    local function has(t, inst)
      for _, v in t do if v == inst then return true end end
      return false
    end
    local ok = has(x,a) and has(x,b) and has(y,a) and not has(y,b) and #z == 0
    a:Destroy(); b:Destroy()
    if not ok then fail() end
  end

  if not _ok then error("dtc bro") end
end
__soEnvGate()
`;

  // ---------- Layer 2: Polymorphic packer (core) ----------
  function polymorphicPack(code) {
    const raw = String(code || '');
    if (!raw) return '-- empty';
    const encoder = new TextEncoder();
    const src = encoder.encode(raw);
    if (src.length > 2_000_000) throw new Error('Script demasiado grande (máx. 2 MB)');

    const key = randomBytes(randomInt(19, 41));
    const mul = randomInt(5, 126) * 2 + 1;
    const add = randomInt(0, 256);
    const step = randomInt(1, 256);
    const encrypted = new Uint8Array(src.length);

    for (let i = 0; i < src.length; i++) {
      const pos = i + 1;
      const mask = (pos * mul + add + Math.floor(pos / 7) * step) & 0xff;
      encrypted[i] = src[i] ^ key[i % key.length] ^ mask;
    }

    let binary = '';
    for (let i = 0; i < encrypted.length; i++) binary += String.fromCharCode(encrypted[i]);
    const stdB64 = btoa(binary);

    const stdAlphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const alphabet = shuffleChars(stdAlphabet);
    const translate = {};
    for (let i = 0; i < stdAlphabet.length; i++) translate[stdAlphabet[i]] = alphabet[i];
    const encoded = stdB64.replace(/[A-Za-z0-9+/]/g, c => translate[c]);

    const chunks = [];
    let off = 0;
    while (off < encoded.length) {
      const size = randomInt(96, 225);
      chunks.push(encoded.slice(off, off + size));
      off += size;
    }

    const perm = chunks.map((_, i) => i);
    for (let i = perm.length - 1; i > 0; i--) {
      const j = randomInt(0, i + 1);
      const t = perm[i]; perm[i] = perm[j]; perm[j] = t;
    }
    const storedChunks = perm.map(i => chunks[i]);
    const order = new Array(chunks.length);
    perm.forEach((orig, stored) => { order[orig] = stored + 1; });

    const nChunks = luaId(), nOrder = luaId(), nAlphabet = luaId(), nKey = luaId();
    const nJoin = luaId(), nB64 = luaId(), nXor = luaId(), nDecrypt = luaId();
    const nAdler = luaId(), nEnc = luaId(), nData = luaId(), nFn = luaId(), nErr = luaId();

    const keyLiteral = '{' + Array.from(key).join(',') + '}';
    const chunksLiteral = '{' + storedChunks.map(c => JSON.stringify(c)).join(',') + '}';
    const orderLiteral = '{' + order.join(',') + '}';
    const checksum = adler32(src);

    const lines = [
      '-- SuperObf Pro · polymorphic compatibility pack',
      'local ' + nChunks + '=' + chunksLiteral,
      'local ' + nOrder + '=' + orderLiteral,
      'local ' + nAlphabet + '=' + JSON.stringify(alphabet),
      'local ' + nKey + '=' + keyLiteral,
      'local function ' + nJoin + '()',
      '  local o={}',
      '  for i=1,#' + nOrder + ' do o[i]=' + nChunks + '[' + nOrder + '[i]] end',
      '  return table.concat(o)',
      'end',
      'local function ' + nB64 + '(s)',
      '  local m={}',
      '  for i=1,#' + nAlphabet + ' do m[string.sub(' + nAlphabet + ',i,i)]=i-1 end',
      '  local o,n={},0',
      '  for i=1,#s,4 do',
      '    local a=string.sub(s,i,i)',
      '    local b=string.sub(s,i+1,i+1)',
      '    local c=string.sub(s,i+2,i+2)',
      '    local d=string.sub(s,i+3,i+3)',
      '    local v1=m[a] or 0; local v2=m[b] or 0; local v3=m[c] or 0; local v4=m[d] or 0',
      '    local x=v1*262144+v2*4096+v3*64+v4',
      '    n=n+1; o[n]=string.char(math.floor(x/65536)%256)',
      '    if c~="=" and c~="" then n=n+1; o[n]=string.char(math.floor(x/256)%256) end',
      '    if d~="=" and d~="" then n=n+1; o[n]=string.char(x%256) end',
      '  end',
      '  return table.concat(o)',
      'end',
      'local ' + nXor + '=(bit32 and bit32.bxor) or function(a,b)',
      '  local r,p=0,1',
      '  while a>0 or b>0 do',
      '    local aa=a%2; local bb=b%2',
      '    if aa~=bb then r=r+p end',
      '    a=(a-aa)/2; b=(b-bb)/2; p=p*2',
      '  end',
      '  return r',
      'end',
      'local function ' + nDecrypt + '(s)',
      '  local o={}',
      '  for i=1,#s do',
      '    local mask=(i*' + mul + '+' + add + '+math.floor(i/7)*' + step + ')%256',
      '    local k=' + nKey + '[((i-1)%#' + nKey + ')+1]',
      '    o[i]=string.char(' + nXor + '(string.byte(s,i),' + nXor + '(k,mask)))',
      '  end',
      '  return table.concat(o)',
      'end',
      'local function ' + nAdler + '(s)',
      '  local a,b=1,0',
      '  for i=1,#s do a=(a+string.byte(s,i))%65521; b=(b+a)%65521 end',
      '  return b*65536+a',
      'end',
      'local ' + nEnc + '=' + nJoin + '()',
      'local ' + nData + '=' + nDecrypt + '(' + nB64 + '(' + nEnc + '))',
      'if ' + nAdler + '(' + nData + ')~=' + checksum + ' then error("protected payload integrity failure") end',
      'local ' + nFn + ',' + nErr + '=(loadstring or load)(' + nData + ')',
      'if type(' + nFn + ')~="function" then error(' + nErr + ' or "protected compile failure") end',
      'return ' + nFn + '()'
    ];

    return lines.join('\n');
  }

  // ---------- Layer 3: Outer RC4-style stream (optional) ----------
  function rc4OuterWrap(innerLua) {
    const key = randomBytes(16);
    const encoder = new TextEncoder();
    const plain = encoder.encode(innerLua);
    const S = new Uint8Array(256);
    for (let i = 0; i < 256; i++) S[i] = i;
    let j = 0;
    for (let i = 0; i < 256; i++) {
      j = (j + S[i] + key[i % key.length]) & 255;
      const t = S[i]; S[i] = S[j]; S[j] = t;
    }
    const out = new Uint8Array(plain.length);
    let i = 0; j = 0;
    for (let n = 0; n < plain.length; n++) {
      i = (i + 1) & 255;
      j = (j + S[i]) & 255;
      const t = S[i]; S[i] = S[j]; S[j] = t;
      out[n] = plain[n] ^ S[(S[i] + S[j]) & 255];
    }

    let bin = '';
    for (let n = 0; n < out.length; n++) bin += String.fromCharCode(out[n]);
    const b64 = btoa(bin);

    const nKey = luaId(), nData = luaId(), nS = luaId(), nI = luaId(), nJ = luaId();
    const nDec = luaId(), nFn = luaId(), nErr = luaId(), nXor = luaId();

    const keyLit = '{' + Array.from(key).join(',') + '}';

    return [
      '-- SuperObf Pro · outer stream',
      'local ' + nKey + '=' + keyLit,
      'local ' + nData + '=' + JSON.stringify(b64),
      'local ' + nXor + '=(bit32 and bit32.bxor) or function(a,b) local r,p=0,1 while a>0 or b>0 do local aa=a%2;local bb=b%2;if aa~=bb then r=r+p end;a=(a-aa)/2;b=(b-bb)/2;p=p*2 end return r end',
      'local function ' + nDec + '()',
      '  local S={}',
      '  for i=0,255 do S[i]=i end',
      '  local j=0',
      '  for i=0,255 do j=(j+S[i]+' + nKey + '[(i%#' + nKey + ')+1])%256; S[i],S[j]=S[j],S[i] end',
      '  local raw=game and (function() local HttpService=game:GetService("HttpService") return HttpService:Base64Decode(' + nData + ') end)() or (function()',
      '    local b="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"',
      '    local m={}; for i=1,#b do m[string.sub(b,i,i)]=i-1 end',
      '    local o,n={},0; local s=' + nData,
      '    for i=1,#s,4 do',
      '      local a=string.sub(s,i,i); local c=string.sub(s,i+1,i+1); local d=string.sub(s,i+2,i+2); local e=string.sub(s,i+3,i+3)',
      '      local v1=m[a] or 0; local v2=m[c] or 0; local v3=m[d] or 0; local v4=m[e] or 0',
      '      local x=v1*262144+v2*4096+v3*64+v4',
      '      n=n+1; o[n]=string.char(math.floor(x/65536)%256)',
      '      if d~="=" and d~="" then n=n+1; o[n]=string.char(math.floor(x/256)%256) end',
      '      if e~="=" and e~="" then n=n+1; o[n]=string.char(x%256) end',
      '    end',
      '    return table.concat(o)',
      '  end)()',
      '  local i,j=0,0',
      '  local out={}',
      '  for n=1,#raw do',
      '    i=(i+1)%256; j=(j+S[i])%256; S[i],S[j]=S[j],S[i]',
      '    out[n]=string.char(' + nXor + '(string.byte(raw,n), S[(S[i]+S[j])%256]))',
      '  end',
      '  return table.concat(out)',
      'end',
      'local ' + nFn + ',' + nErr + '=(loadstring or load)(' + nDec + '())',
      'if type(' + nFn + ')~="function" then error(' + nErr + ' or "outer decode fail") end',
      'return ' + nFn + '()'
    ].join('\n');
  }

  // ---------- Public API ----------
  /**
   * @param {string} source
   * @param {object} opts
   * @param {boolean} [opts.antiTamper=true]
   * @param {boolean} [opts.envGate=true]
   * @param {boolean} [opts.outerRc4=false]
   * @param {boolean} [opts.watermark=true]
   */
  function obfuscate(source, opts) {
    opts = opts || {};
    const antiTamper = opts.antiTamper !== false;
    const envGate = opts.envGate !== false;
    const outerRc4 = !!opts.outerRc4;
    const watermark = opts.watermark !== false;

    let payload = String(source || '');
    if (!payload.trim()) throw new Error('Código vacío');

    const header = [];
    if (watermark) {
      header.push('--[[ SuperObf Pro · multi-layer ]]');
      header.push('-- build ' + Date.now().toString(36));
    }
    if (antiTamper) header.push(ANTI_TAMPER_LUA);
    if (envGate) header.push(ENV_GATE_LUA);

    const combined = header.join('\n') + '\n' + payload;
    let packed = polymorphicPack(combined);

    if (outerRc4) {
      packed = rc4OuterWrap(packed);
    }

    return packed;
  }

  global.SuperObfPro = {
    obfuscate: obfuscate,
    polymorphicPack: polymorphicPack,
    version: '1.0.0-pro'
  };
})(typeof window !== 'undefined' ? window : globalThis);
