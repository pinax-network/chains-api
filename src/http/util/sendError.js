export function sendError(reply, code, message) {
  return reply.code(code).send({ error: message });
}
