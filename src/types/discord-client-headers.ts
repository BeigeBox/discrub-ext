/**
 * Headers captured from Discord's own web client requests.
 * These are intercepted from the page context so that our API calls
 * match what the real Discord client sends.
 */
export type DiscordClientHeaders = {
  "x-super-properties"?: string;
  "x-discord-locale"?: string;
  "x-discord-timezone"?: string;
  "x-debug-options"?: string;
};
