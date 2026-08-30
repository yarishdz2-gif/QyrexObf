/**
 * Qyrex polymorphic compatibility packer
 * Reconstruido del original (sin mejoras).
 * Adaptado a browser (Web Crypto + Math.random fallback).
 */

function randomBytes(n) {
  const arr = new Uint8Array(n);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(arr);
  } else {
    for (let i = 0; i < n; i++) arr[i] = Math.floor(Math.random() * 256);
  }
  return arr;
}

function randomInt(min, max) {
  // max exclusive, like crypto.randomInt
  const range = max - min;
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return min + (buf[0] % range);
  }
  return min + Math.floor(Math.random() * range);
}

function _shuffleChars(value) {
  const a = String(value).split('');
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(0, i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.join('');
}

function _luaId() {
  const bytes = randomBytes(6);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return '_' + hex;
}

function _adler32(buf) {
  let a = 1;
  let b = 0;
  for (let i = 0; i < buf.length; i++) {
    a = (a + buf[i]) % 65521;
    b = (b + a) % 65521;
  }
  return b * 65536 + a;
}

const ENV_GATE_LUA = `--[[ Qrex Env Logger + anti-steal ]]
local function __qrexEnvGate()
  local _ok = true
  local function fail() _ok = false end

  -- 1) getgenv / debug
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

  -- 2) TerrainRegion
  do
    local success = pcall(function()
      local c = Instance.new("TerrainRegion")
      assert(typeof(c) == "Instance")
      assert(c.ClassName == "TerrainRegion")
      assert(c:IsA("TerrainRegion"))
      assert(c:IsA("Instance"))
      local workspaceTerrain = workspace:FindFirstChildOfClass("Terrain")
      if workspaceTerrain then
        local ok, region = pcall(function()
          return workspaceTerrain:CopyRegion(Region3.new(Vector3.new(0,0,0), Vector3.new(4,4,4)))
        end)
        if ok and region then
          assert(typeof(region) == "TerrainRegion")
          assert(region.ClassName == "TerrainRegion")
          local size = region.Size
          assert(typeof(size) == "Vector3int16")
        end
      end
      local part = Instance.new("Part")
      local _ = part.Position
      part:Destroy()
    end)
    if not success then fail() end
  end

  -- 3) DataModel check (NO infinite loop - that bricks legit users)
  do
    if game.ClassName ~= "DataModel" then fail() end
  end

  -- 4) OverlapParams
  do
    local w = workspace
    local a = Instance.new("Part")
    local b = Instance.new("Part")
    a.Anchored = true
    b.Anchored = true
    a.CFrame = CFrame.new(0,0,0)
    b.CFrame = CFrame.new(0,0,0)
    a.Parent = w
    b.Parent = w
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

  -- 5) TweenService
  do
    local ok = pcall(function()
      local ts = game:GetService("TweenService")
      local obj = Instance.new("NumberValue")
      obj.Value = 0
      obj.Parent = workspace
      local tween = ts:Create(obj, TweenInfo.new(1, Enum.EasingStyle.Linear, Enum.EasingDirection.In), {Value = 1})
      tween:Play()
      task.wait(0.5)
      local mid = obj.Value
      if mid <= 0 or mid >= 1 or mid < 0.3 or mid > 0.7 then error("dtc") end
      tween.Completed:Wait()
      if obj.Value ~= 1 then error("dtc") end
      obj:Destroy()
    end)
    if not ok then fail() end
  end

  if not _ok then
    error("dtc bro")
  end
end
__qrexEnvGate()
`;

/**
 * Compatibility-first polymorphic packer.
 * Reconstruido del original.
 */
function localObfuscate(code) {
  const raw = String(code || '');
  if (!raw) return '-- empty';
  const byteLen = new TextEncoder().encode(raw).length;
  if (byteLen > 2000000) {
    throw new Error('Script demasiado grande para ofuscar (máx. 2 MB)');
  }

  const encoder = new TextEncoder();
  const src = encoder.encode(raw);

  const keyLen = randomInt(19, 41);
  const key = randomBytes(keyLen);
  const mul = randomInt(5, 126) * 2 + 1; // odd, 11..251
  const add = randomInt(0, 256);
  const step = randomInt(1, 256);
  const encrypted = new Uint8Array(src.length);

  for (let i = 0; i < src.length; i++) {
    const pos = i + 1; // Lua is 1-based
    const mask = (pos * mul + add + Math.floor(pos / 7) * step) & 0xff;
    encrypted[i] = src[i] ^ key[i % key.length] ^ mask;
  }

  // base64 estándar del encrypted
  let binary = '';
  for (let i = 0; i < encrypted.length; i++) {
    binary += String.fromCharCode(encrypted[i]);
  }
  const stdB64 = btoa(binary);

  const stdAlphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const alphabet = _shuffleChars(stdAlphabet);
  const translate = {};
  for (let i = 0; i < stdAlphabet.length; i++) {
    translate[stdAlphabet[i]] = alphabet[i];
  }
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
    [perm[i], perm[j]] = [perm[j], perm[i]];
  }
  const storedChunks = perm.map(i => chunks[i]);
  const order = new Array(chunks.length);
  perm.forEach((originalIndex, storedIndex) => {
    order[originalIndex] = storedIndex + 1;
  });

  const nChunks = _luaId();
  const nOrder = _luaId();
  const nAlphabet = _luaId();
  const nKey = _luaId();
  const nJoin = _luaId();
  const nB64 = _luaId();
  const nXor = _luaId();
  const nDecrypt = _luaId();
  const nAdler = _luaId();
  const nEnc = _luaId();
  const nData = _luaId();
  const nFn = _luaId();
  const nErr = _luaId();

  const keyLiteral = '{' + Array.from(key).join(',') + '}';
  const chunksLiteral = '{' + storedChunks.map(c => JSON.stringify(c)).join(',') + '}';
  const orderLiteral = '{' + order.join(',') + '}';
  const checksum = _adler32(src);

  const lines = [
    '-- Qyrex polymorphic compatibility pack',
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

function wrapWithEnvLogger(source) {
  return ENV_GATE_LUA + '\n' + String(source || '');
}

// API pública para la UI
window.QyrexObfuscator = {
  obfuscate: function (code, opts) {
    opts = opts || {};
    let src = String(code || '');
    if (opts.envGate !== false) {
      src = wrapWithEnvLogger(src);
    }
    return localObfuscate(src);
  },
  localObfuscate: localObfuscate,
  ENV_GATE_LUA: ENV_GATE_LUA
};
