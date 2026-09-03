import { SESSION_MIRROR_TYPE } from './sessionMirror';

describe('SESSION_MIRROR_TYPE', () => {
  it('is "session" — never "doc_type", which the sync writer does not write', () => {
    expect(SESSION_MIRROR_TYPE).toBe('session');
  });
});
