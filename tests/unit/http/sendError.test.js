import { describe, it, expect, vi } from 'vitest';
import { sendError } from '../../../src/http/util/sendError.js';

function createReply() {
  const reply = {};
  reply.code = vi.fn().mockReturnValue(reply);
  reply.send = vi.fn().mockReturnValue(reply);
  return reply;
}

describe('sendError', () => {
  it('sets the status code and JSON error body', () => {
    const reply = createReply();
    sendError(reply, 400, 'Invalid chain ID');

    expect(reply.code).toHaveBeenCalledWith(400);
    expect(reply.send).toHaveBeenCalledWith({ error: 'Invalid chain ID' });
  });

  it('returns the reply so handlers can return it directly', () => {
    const reply = createReply();
    const result = sendError(reply, 503, 'unavailable');
    expect(result).toBe(reply);
  });
});
