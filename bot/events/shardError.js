/** Handles an error reported by a shard. */
export function handleShardError(error, id, { redactToken }) {
  console.error(`[bot] shard ${id} error:`, redactToken(error?.message));
}