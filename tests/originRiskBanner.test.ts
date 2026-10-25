import { describe, expect, it } from 'vitest';
import { assessOrigin } from '../src/security/originRisk';
import { renderOriginRisk } from '../src/security/originRiskBanner';
import { fakeDoc, FakeNode } from './fakeDom';

const render = (origin: string, el = new FakeNode('div')) => {
  el.classes.add('hidden');
  renderOriginRisk(fakeDoc, el as never, assessOrigin(origin));
  return el;
};
const lines = (el: FakeNode) => el.children[1]?.children.map((li) => li.textContent) ?? [];

describe('approval page origin-risk banner', () => {
  it('stays hidden and empty for a normal https site', () => {
    const el = render('https://app.example.com');
    expect(el.classes.has('hidden')).toBe(true);
    expect(el.children).toHaveLength(0);
  });

  it('shows a caution (not danger) banner for a local development app', () => {
    const el = render('http://localhost:3333');
    expect(el.classes.has('hidden')).toBe(false);
    expect(el.classes.has('risk-danger')).toBe(false);
    expect(el.children[0]!.textContent).toBe('Check this site before continuing');
    expect(lines(el).join(' ')).toContain('development app');
  });

  it('shows a danger banner listing every warning (insecure http + userinfo)', () => {
    const el = render('http://user:pw@evil.example');
    expect(el.classes.has('hidden')).toBe(false);
    expect(el.classes.has('risk-danger')).toBe(true);
    expect(el.children[0]!.textContent).toBe('Be careful: this site looks risky');
    const t = lines(el).join(' | ');
    expect(t).toContain('username or password');
    expect(t).toContain('not using a secure (https) connection');
  });

  it('flags look-alike (punycode) hosts as danger', () => {
    const el = render('https://xn--pple-43d.com');
    expect(el.classes.has('risk-danger')).toBe(true);
    expect(lines(el).join(' ')).toContain('look-alike');
  });

  it('never treats the origin or warnings as HTML (textContent only)', () => {
    const el = render('not a url <img src=x onerror=alert(1)>');
    expect(el.children[0]!.tag).toBe('strong');
    expect(el.children[1]!.tag).toBe('ul');
    expect(el.children[1]!.children.every((li) => li.tag === 'li')).toBe(true);
  });

  it('re-rendering replaces the previous content and un-hides/re-hides correctly', () => {
    const el = render('http://localhost:3333');
    expect(el.children).toHaveLength(2);
    renderOriginRisk(fakeDoc, el as never, assessOrigin('https://app.example.com'));
    expect(el.children).toHaveLength(0);
    expect(el.classes.has('hidden')).toBe(true);
    renderOriginRisk(fakeDoc, el as never, assessOrigin('http://evil.example'));
    expect(el.children).toHaveLength(2);
    expect(el.classes.has('hidden')).toBe(false);
  });
});