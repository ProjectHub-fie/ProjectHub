/** Handles a shard disconnect. */
export function handleShardDisconnect(event, id) {
  console.warn(`[bot] shard ${id} disconnected (code ${event?.code ?? 'unknown'})`);
}