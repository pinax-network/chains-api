// State for the RPC health checker, isolated so that store/queries.js can read
// the in-progress flag without importing the runner (which would create a cycle).
let rpcCheckInProgress = false;
let rpcCheckPending = false;

export function getRpcCheckInProgress() {
  return rpcCheckInProgress;
}

export function setRpcCheckInProgress(value) {
  rpcCheckInProgress = Boolean(value);
}

export function getRpcCheckPending() {
  return rpcCheckPending;
}

export function setRpcCheckPending(value) {
  rpcCheckPending = Boolean(value);
}
