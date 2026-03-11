import { User } from "../../classes/user";
import { DiscordClientHeaders } from "../../types/discord-client-headers";

export type UserState = {
  currentUser: User | Maybe;
  token: string | Maybe;
  clientHeaders: DiscordClientHeaders;
  isLoading: boolean | Maybe;
};
