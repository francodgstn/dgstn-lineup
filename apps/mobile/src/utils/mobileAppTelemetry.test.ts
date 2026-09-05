import { buildMobileAppTelemetry } from './mobileAppTelemetry';

describe('buildMobileAppTelemetry', () => {
  it('carries exactly the keys the self-update rules arm admits', () => {
    const telemetry = buildMobileAppTelemetry('1.0.0', {
      runtimeVersion: '1.0.0',
      channel: 'production',
      isEmbeddedLaunch: false,
      updateId: 'abc-123',
    });

    expect(Object.keys(telemetry).sort()).toEqual(
      ['ota_channel', 'ota_is_embedded', 'ota_runtime_version', 'ota_update_id', 'version'].sort()
    );
    expect(telemetry).toEqual({
      version: '1.0.0',
      ota_runtime_version: '1.0.0',
      ota_channel: 'production',
      ota_is_embedded: false,
      ota_update_id: 'abc-123',
    });
  });

  it('omits `version` entirely when the app version is unknown — an undefined value would make updateDoc reject the whole write', () => {
    const telemetry = buildMobileAppTelemetry(undefined, {
      runtimeVersion: null,
      channel: null,
      isEmbeddedLaunch: true,
      updateId: null,
    });
    expect(telemetry).not.toHaveProperty('version');
    expect(Object.values(telemetry)).not.toContain(undefined);
  });

  it('passes through nulls (embedded launch, no OTA applied yet) rather than inventing values', () => {
    const telemetry = buildMobileAppTelemetry(undefined, {
      runtimeVersion: null,
      channel: null,
      isEmbeddedLaunch: true,
      updateId: null,
    });

    expect(telemetry.ota_runtime_version).toBeNull();
    expect(telemetry.ota_channel).toBeNull();
    expect(telemetry.ota_is_embedded).toBe(true);
    expect(telemetry.ota_update_id).toBeNull();
  });
});
