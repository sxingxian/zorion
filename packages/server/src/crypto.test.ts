import { describe, expect, it } from 'vitest';
import { seal, unseal } from './crypto';

describe('TOTP_KEY formats', () => {
  it('opens with a base64 key of 32 bytes', async () => {
    const key = btoa('0123456789abcdef0123456789abcdef');
    expect(await unseal(await seal('JBSWY3DPEHPK3PXP', key), key)).toBe('JBSWY3DPEHPK3PXP');
  });

  it('opens with a long password-manager string', async () => {
    const key = 'pR7#vL2q!Zx9mT4wK8sN3bH6yF1cJ5dG0aE';
    expect(await unseal(await seal('JBSWY3DPEHPK3PXP', key), key)).toBe('JBSWY3DPEHPK3PXP');
  });

  it('does not open with a different key', async () => {
    const sealed = await seal('JBSWY3DPEHPK3PXP', 'a'.repeat(40));
    await expect(unseal(sealed, 'b'.repeat(40))).rejects.toThrow();
  });

  it('refuses a short key', async () => {
    await expect(seal('JBSWY3DPEHPK3PXP', 'too-short')).rejects.toThrow('at least 32');
  });
});
