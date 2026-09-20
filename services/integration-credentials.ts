import { getDatabase } from '@/database';
import { encryptField, decryptField } from '@/services/vault';

export async function setIntegrationCred(service: string, key: string, value: string): Promise<void> {
  const db = getDatabase();
  const valueEnc = await encryptField(value);
  await db.runAsync(
    `INSERT INTO integration_credentials (service, key, value_enc, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(service, key) DO UPDATE SET value_enc = excluded.value_enc, updated_at = excluded.updated_at`,
    [service, key, valueEnc],
  );
}

export async function getIntegrationCred(service: string, key: string): Promise<string | null> {
  const db = getDatabase();
  const row = await db.getFirstAsync<{ value_enc: string }>(
    'SELECT value_enc FROM integration_credentials WHERE service = ? AND key = ?',
    [service, key],
  );
  if (!row) return null;
  try {
    return await decryptField(row.value_enc);
  } catch {
    return null;
  }
}

export async function getAllIntegrationCreds(service: string): Promise<Record<string, string>> {
  const db = getDatabase();
  const rows = await db.getAllAsync<{ key: string; value_enc: string }>(
    'SELECT key, value_enc FROM integration_credentials WHERE service = ?',
    [service],
  );
  const result: Record<string, string> = {};
  for (const row of rows) {
    try {
      result[row.key] = await decryptField(row.value_enc);
    } catch {
      // skip rows that fail to decrypt
    }
  }
  return result;
}

export async function clearIntegrationCreds(service: string): Promise<void> {
  const db = getDatabase();
  await db.runAsync('DELETE FROM integration_credentials WHERE service = ?', [service]);
}
