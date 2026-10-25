import { describe, expect, it } from 'vitest';
import { assessOrigin } from './originRisk';

describe('assessOrigin', () => {
  it('is quiet for a normal https site', () => {
    expect(assessOrigin('https://boing.finance')).toEqual({ level: 'none', warnings: [], host: 'boing.finance' });
  });
  it('flags http, ip, localhost, punycode and userinfo', () => {
    expect(assessOrigin('http://boing.finance').level).toBe('danger');
    expect(assessOrigin('https://203.0.113.9').level).toBe('caution');
    expect(assessOrigin('http://127.0.0.1:3333').level).toBe('caution');
    expect(assessOrigin('https://xn--bing-finance-9ec.com').level).toBe('danger');
    expect(assessOrigin('https://user:pw@boing.finance').level).toBe('danger');
  });
  it('treats junk as danger', () => {
    expect(assessOrigin('').level).toBe('danger');
    expect(assessOrigin('not a url').warnings[0]).toMatch(/recognizable/);
  });
});