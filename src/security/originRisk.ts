/** Heuristics that turn a dApp origin into plain-language warnings on approval prompts. Never blocks; informs. */

export type OriginRisk = { level: 'none' | 'caution' | 'danger'; warnings: string[]; host: string };

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

export function assessOrigin(origin: string): OriginRisk {
  const warnings: string[] = [];
  let level: OriginRisk['level'] = 'none';
  const raise = (l: 'caution' | 'danger') => {
    if (l === 'danger' || level === 'none') level = l;
  };
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return { level: 'danger', warnings: ['This request did not come from a recognizable website address.'], host: origin };
  }
  const host = url.hostname.toLowerCase();
  const local = LOCAL_HOSTS.has(host) || host.endsWith('.localhost');

  if (url.username || url.password) {
    warnings.push('The address contains a username or password, a common trick to disguise the real site.');
    raise('danger');
  }
  if (url.protocol !== 'https:' && !local) {
    warnings.push('This site is not using a secure (https) connection.');
    raise('danger');
  }
  if (local) {
    warnings.push('This request comes from a site running on your own computer (a development app).');
    raise('caution');
  } else if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith('[')) {
    warnings.push('This site is a raw IP address, not a normal website name.');
    raise('caution');
  }
  if (host.split('.').some((label) => label.startsWith('xn--'))) {
    warnings.push('The site name uses look-alike international characters. Check the spelling carefully.');
    raise('danger');
  } else if (/[^\x00-\x7f]/.test(host)) {
    warnings.push('The site name contains non-English characters that can imitate a trusted site.');
    raise('danger');
  }
  return { level, warnings, host };
}