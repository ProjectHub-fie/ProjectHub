/**
 * Creates the message event handler.
 *
 * Keeping the promise rejection boundary here prevents one failed database
 * lookup or reply from becoming an unhandled rejection in the gateway loop.
 */
export function createMessageCreateHandler({ handleMessage }) {
  return (message) => {
    handleMessage(message).catch((error) => console.error('[bot] message handling failed:', error));
  };
}