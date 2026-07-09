export const isSafeBundlePath = (value: string): boolean =>
  value.length > 0
  && !value.startsWith('/')
  && !value.includes('\\')
  && !value.split('/').some((segment) => segment === '' || segment === '.' || segment === '..');
