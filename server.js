const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname)));

function generateRandomName(length = 10) {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let result = '_';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

function obfuscateLuau(sourceCode) {
    // Encriptación de cadenas de texto mediante XOR y arreglos de bytes
    let obfuscated = sourceCode.replace(/"([^"\\]*(\\.[^"\\]*)*)"|'([^'\\]*(\\.[^'\\]*)*)'/g, (match) => {
        const content = match.slice(1, -1);
        if (content.length === 0) return '""';
        
        const key = Math.floor(Math.random() * 200) + 1;
        const bytes = Array.from(content).map(c => c.charCodeAt(0) ^ key);
        
        const funcName = generateRandomName(6);
        const arrayVar = generateRandomName(6);
        const strVar = generateRandomName(6);
        const idxVar = generateRandomName(6);
        
        return `(function() local ${arrayVar}={${bytes.join(',')}} local ${strVar}="" for ${idxVar}=1,#${arrayVar} do ${strVar}=${strVar}..string.char(bit32.bxor(${arrayVar}[${idxVar}], ${key})) end return ${strVar} end)()`;
    });

    // Ofuscación de estructura y aislamiento del entorno de ejecución
    const envVar = generateRandomName(8);
    const mainFunc = generateRandomName(8);
    const bitLib = generateRandomName(8);

    const wrappedCode = `
local ${envVar} = getfenv and getfenv() or _ENV
local ${bitLib} = bit32 or bit or {bxor = function(a,b) return a end}
local function ${mainFunc}()
    ${obfuscated}
end
${mainFunc}()
`.trim();

    return wrappedCode;
}

app.post('/api/obfuscate', (req, res) => {
    const { script } = req.body;
    if (!script || typeof script !== 'string') {
        return res.status(400).json({ error: 'Se requiere un script válido en formato de texto.' });
    }

    try {
        const result = obfuscateLuau(script);
        res.json({ obfuscatedScript: result });
    } catch (err) {
        res.status(500).json({ error: 'Error durante el proceso de ofuscación.' });
    }
});

app.listen(PORT, () => {
    console.log(`Servidor de ofuscación iniciado en http://localhost:${PORT}`);
});
