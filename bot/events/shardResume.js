/** Handles a shard resuming after a reconnect. */
export function handleShardResume(id, replayed) {
  console.log(`[bot] shard ${id} resumed (${replayed} events replayed)`);
}