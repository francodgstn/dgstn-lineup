import { isVersionBelow, parseVersion, compareVersions } from '@linyup/shared';
import { decideUpdateGate } from './minVersion';

describe('version parsing + comparison (@linyup/shared)', () => {
  it('parses the shapes a package.json or a settings form can hold', () => {
    expect(parseVersion('1.2.3')).toEqual([1, 2, 3]);
    expect(parseVersion('v1.2.3')).toEqual([1, 2, 3]);
    expect(parseVersion('1.2')).toEqual([1, 2, 0]);
    expect(parseVersion('2')).toEqual([2, 0, 0]);
    expect(parseVersion(' 1.2.3-beta.1 ')).toEqual([1, 2, 3]);
    expect(parseVersion('1.2.3+42')).toEqual([1, 2, 3]);
  });

  it('rejects what is not a version', () => {
    for (const bad of ['', 'latest', '1.x', '1..2', null, undefined, 'one.two']) {
      expect(parseVersion(bad as string)).toBeNull();
    }
  });

  it('compares numerically, not lexically', () => {
    expect(compareVersions('1.10.0', '1.9.0')).toBe(1);
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
    expect(compareVersions('0.9.9', '1.0.0')).toBe(-1);
    expect(() => compareVersions('nope', '1.0.0')).toThrow();
  });

  it('isVersionBelow fails OPEN on anything it cannot read', () => {
    expect(isVersionBelow('1.0.0', '1.0.1')).toBe(true);
    expect(isVersionBelow('1.0.1', '1.0.1')).toBe(false);
    expect(isVersionBelow('1.0.0', 'typo')).toBe(false);
    expect(isVersionBelow(null, '1.0.0')).toBe(false);
    expect(isVersionBelow('1.0.0', null)).toBe(false);
  });
});

describe('decideUpdateGate — the update-required decision', () => {
  const settings = {
    min_supported_version: '1.2.0',
    update_message: 'Please update.',
    store_url_ios: 'https://apps.apple.com/app/id1',
    store_url_android: 'https://play.google.com/store/apps/details?id=com.dgstn.linyup',
  };

  it('blocks an older build and hands it the platform store link', () => {
    expect(decideUpdateGate(settings, '1.1.9', 'ios')).toEqual({
      minimum: '1.2.0',
      current: '1.1.9',
      message: 'Please update.',
      storeUrl: settings.store_url_ios,
    });
    expect(decideUpdateGate(settings, '1.0.0', 'android')?.storeUrl).toBe(settings.store_url_android);
    expect(decideUpdateGate(settings, '1.0.0', 'web')?.storeUrl).toBeNull();
  });

  it('lets the minimum and anything newer run', () => {
    expect(decideUpdateGate(settings, '1.2.0', 'ios')).toBeNull();
    expect(decideUpdateGate(settings, '2.0.0', 'ios')).toBeNull();
  });

  it('fails open: no settings, no minimum, unknown or malformed versions', () => {
    expect(decideUpdateGate(null, '0.0.1', 'ios')).toBeNull();
    expect(decideUpdateGate({ ...settings, min_supported_version: null }, '0.0.1', 'ios')).toBeNull();
    expect(decideUpdateGate({ ...settings, min_supported_version: 'soon' }, '0.0.1', 'ios')).toBeNull();
    expect(decideUpdateGate(settings, undefined, 'ios')).toBeNull();
  });
});
