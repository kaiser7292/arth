const CryptoJS = require('crypto-js');
const fs = require('fs');

const MAGIC_HEADER = "ARTHA_BKP";
const SALT_LENGTH = 32;
const IV_LENGTH = 16;
const KEY_ITERATIONS = 600000;
const LEGACY_V2_KEY_ITERATIONS = 100000;

function arrayToHex(arr) {
  return Array.from(arr)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function hexToArray(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

function arrayToBase64(arr) {
  let binary = '';
  for (let i = 0; i < arr.length; i++) {
    binary += String.fromCharCode(arr[i]);
  }
  return Buffer.from(binary).toString('base64');
}

function base64ToArray(base64) {
  const binary = Buffer.from(base64, 'base64');
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary[i];
  }
  return bytes;
}

function deriveKey(password, saltHex, iterations = KEY_ITERATIONS) {
  const salt = CryptoJS.enc.Hex.parse(saltHex);
  const key = CryptoJS.PBKDF2(password, salt, {
    keySize: 256 / 32,
    iterations: iterations,
    hasher: CryptoJS.algo.SHA256
  });
  return key;
}

function decryptData(ciphertextBase64, key, iv) {
  const encrypted = CryptoJS.enc.Base64.parse(ciphertextBase64);
  const decrypted = CryptoJS.AES.decrypt(
    { ciphertext: encrypted },
    key,
    {
      iv: iv,
      mode: CryptoJS.mode.GCM,
      padding: CryptoJS.pad.Pkcs7
    }
  );
  return decrypted.toString(CryptoJS.enc.Utf8);
}

async function legacyDeriveKey(password, salt) {
  let data = password + arrayToHex(salt);
  for (let i = 0; i < LEGACY_V2_KEY_ITERATIONS; i++) {
    data = CryptoJS.SHA256(data).toString(CryptoJS.enc.Hex);
  }
  return CryptoJS.enc.Hex.parse(data.slice(0, 64));
}

async function legacyDecryptData(encrypted, key, iv) {
  const decrypted = new Uint8Array(encrypted.length);
  const blockSize = 32;
  let keystreamOffset = 0;
  let blockIndex = 0;

  while (keystreamOffset < encrypted.length) {
    const blockInput = arrayToHex(key) + arrayToHex(iv) + blockIndex.toString(16).padStart(8, '0');
    const blockHash = CryptoJS.SHA256(blockInput).toString(CryptoJS.enc.Hex);
    const keystreamBlock = hexToArray(blockHash);

    for (let j = 0; j < blockSize && keystreamOffset < encrypted.length; j++, keystreamOffset++) {
      decrypted[keystreamOffset] = encrypted[keystreamOffset] ^ keystreamBlock[j];
    }

    blockIndex++;
  }

  return Buffer.from(decrypted).toString('utf8');
}

async function main() {
  const filePath = '/Users/aastha./Downloads/artha-backup-2026-05-14T14-57-13.artha';
  const password = 'Artha7292';
  
  console.log('Reading backup file...');
  const fileContent = fs.readFileSync(filePath);
  console.log('File size:', fileContent.length);
  console.log('First 20 bytes (hex):', fileContent.slice(0, 20).toString('hex'));
  
  // Check if it's binary or base64 text
  const isBinary = fileContent.some(byte => byte > 127);
  console.log('Is binary:', isBinary);
  
  let fileData;
  if (isBinary) {
    // Already binary
    fileData = new Uint8Array(fileContent);
  } else {
    // Base64 text
    const base64Content = fileContent.toString('utf8');
    fileData = base64ToArray(base64Content);
  }
  
  console.log('Validating magic header...');
  const headerBytes = fileData.slice(0, MAGIC_HEADER.length);
  const header = Buffer.from(headerBytes).toString('utf8');
  
  if (header !== MAGIC_HEADER) {
    console.error('Invalid magic header:', header);
    process.exit(1);
  }
  
  console.log('Magic header valid:', header);
  
  console.log('Extracting salt, IV, and encrypted data...');
  const offset = MAGIC_HEADER.length;
  const salt = fileData.slice(offset, offset + SALT_LENGTH);
  const iv = fileData.slice(offset + SALT_LENGTH, offset + SALT_LENGTH + IV_LENGTH);
  const encrypted = fileData.slice(offset + SALT_LENGTH + IV_LENGTH);
  
  const saltHex = arrayToHex(salt);
  const ivHex = arrayToHex(iv);
  const encryptedBase64 = Buffer.from(encrypted).toString('base64');
  
  console.log('Salt:', saltHex);
  console.log('IV:', ivHex);
  console.log('Encrypted data length:', encrypted.length);
  
  console.log('\nDeriving key (600,000 iterations)...');
  let key;
  let payload;
  
  try {
    key = deriveKey(password, saltHex, KEY_ITERATIONS);
    const ivObj = CryptoJS.enc.Hex.parse(ivHex);
    console.log('Key derived successfully');
    
    console.log('\nDecrypting with AES-256-GCM...');
    payload = decryptData(encryptedBase64, key, ivObj);
    console.log('Decryption successful');
  } catch (e) {
    console.error('Decryption failed with 600k iterations, trying 100k...');
    try {
      key = deriveKey(password, saltHex, LEGACY_V2_KEY_ITERATIONS);
      const ivObj = CryptoJS.enc.Hex.parse(ivHex);
      payload = decryptData(encryptedBase64, key, ivObj);
      console.log('Decryption successful with 100k iterations (legacy V2)');
    } catch (e2) {
      console.error('Decryption failed with AES-GCM, trying legacy XOR (V1)...');
      try {
        const legacyKey = await legacyDeriveKey(password, salt);
        const ivObj = CryptoJS.enc.Hex.parse(ivHex);
        payload = await legacyDecryptData(encrypted, legacyKey, ivObj);
        console.log('Decryption successful with legacy XOR (V1)');
      } catch (e3) {
        console.error('All decryption methods failed:', e3.message);
        process.exit(1);
      }
    }
  }
  
  console.log('\nParsing JSON...');
  let parsed;
  try {
    parsed = JSON.parse(payload);
    console.log('JSON parsed successfully');
  } catch (e) {
    console.error('JSON parse failed:', e.message);
    console.error('First 100 chars of payload:', payload.substring(0, 100));
    process.exit(1);
  }
  
  console.log('\n=== Backup Metadata ===');
  console.log('Version:', parsed.metadata.version);
  console.log('App Version:', parsed.metadata.appVersion);
  console.log('Created At:', parsed.metadata.createdAt);
  console.log('Tables:', parsed.metadata.tables);
  console.log('Row Counts:', JSON.stringify(parsed.metadata.rowCounts, null, 2));
  
  console.log('\n=== Financial Accounts Sample ===');
  if (parsed.data.financial_accounts && parsed.data.financial_accounts.length > 0) {
    console.log('Total financial_accounts:', parsed.data.financial_accounts.length);
    console.log('First account:', JSON.stringify(parsed.data.financial_accounts[0], null, 2));
    
    // Check account_type values
    const accountTypes = new Set();
    parsed.data.financial_accounts.forEach(acc => {
      if (acc.account_type) accountTypes.add(acc.account_type);
    });
    console.log('\nAccount types found:', Array.from(accountTypes));
  } else {
    console.log('No financial_accounts found');
  }
  
  // Save decrypted data for inspection
  const outputPath = '/Users/aastha./Downloads/backup-decrypted.json';
  fs.writeFileSync(outputPath, JSON.stringify(parsed, null, 2));
  console.log('\nDecrypted backup saved to:', outputPath);
}

main().catch(console.error);
