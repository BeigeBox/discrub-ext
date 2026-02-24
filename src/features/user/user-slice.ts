import { createSlice } from "@reduxjs/toolkit";
import {
  getClientHeadersAsync,
  sendChromeMessage,
} from "../../services/chrome-service";
import { UserState } from "./user-types";
import { AppThunk } from "../../app/store";
import { User } from "../../classes/user";
import DiscordService from "../../services/discord-service";
import { setExportUserMap } from "../export/export-slice.tsx";
import { getPreFilterUsers } from "../guild/guild-slice.ts";
import {
  defaultGMOMappingData,
  getGMOMappingData,
  getUserMappingData,
} from "../../utils.ts";
import { DiscordClientHeaders } from "../../types/discord-client-headers.ts";

const initialState: UserState = {
  currentUser: null,
  token: null,
  clientHeaders: {},
  isLoading: null,
};

export const userSlice = createSlice({
  name: "user",
  initialState: initialState,
  reducers: {
    setIsLoading: (state, { payload }: { payload: boolean }): void => {
      state.isLoading = payload;
    },
    setToken: (state, { payload }: { payload: string | Maybe }): void => {
      state.token = payload;
    },
    setCurrentUser: (state, { payload }: { payload: User }): void => {
      state.currentUser = payload;
    },
    setClientHeaders: (
      state,
      { payload }: { payload: DiscordClientHeaders },
    ): void => {
      state.clientHeaders = payload;
    },
  },
});

export const { setIsLoading, setToken, setCurrentUser, setClientHeaders } =
  userSlice.actions;

/**
 * Re-fetch Discord client headers from the content script and update Redux.
 * Called periodically so that long-running operations always use a fresh
 * X-Super-Properties / build number instead of a stale snapshot.
 */
export const refreshClientHeaders = (): AppThunk => async (dispatch) => {
  const headers = await getClientHeadersAsync();
  if (headers && Object.keys(headers).length > 0) {
    dispatch(setClientHeaders(headers));
  }
};

export const getUserData = (): AppThunk => async (dispatch, getState) => {
  const { settings } = getState().app;
  dispatch(setIsLoading(true));

  // First, capture Discord's client headers from the page
  sendChromeMessage(
    "GET_CLIENT_HEADERS",
    (headers: DiscordClientHeaders | null) => {
      if (headers) {
        dispatch(setClientHeaders(headers));
      }
    },
  );

  const chromeCallback = async (userToken: string) => {
    if (userToken) {
      const { clientHeaders } = getState().user;
      const { success, data } = await new DiscordService(
        settings,
        clientHeaders,
      ).fetchUserData(userToken);
      if (success && data) {
        dispatch(setCurrentUser(data));
        dispatch(setToken(userToken));
      }
    }
    dispatch(setIsLoading(false));
  };
  return sendChromeMessage("GET_TOKEN", chromeCallback);
};

export const getUserDataManaully =
  (userToken: string): AppThunk<Promise<boolean>> =>
  async (dispatch, getState) => {
    const { settings } = getState().app;
    const { clientHeaders } = getState().user;
    if (userToken) {
      const { data, success } = await new DiscordService(
        settings,
        clientHeaders,
      ).fetchUserData(userToken);

      if (success && data) {
        dispatch(setToken(userToken));
        dispatch(setCurrentUser(data));
        return true;
      } else {
        dispatch(setToken(undefined));
        dispatch(setIsLoading(false));
        return false;
      }
    }
    return false;
  };

export const clearUserMapping =
  (userId: string): AppThunk =>
  (dispatch, getState) => {
    // Remove specified User from map
    const { userMap } = getState().export.exportMaps;
    const newUserMap = { ...userMap };
    delete newUserMap[userId];
    dispatch(setExportUserMap(newUserMap));

    // Refresh Guild Users
    const { selectedGuild } = getState().guild;
    if (selectedGuild) {
      dispatch(getPreFilterUsers(selectedGuild.id));
    }
  };

export const createUserMapping =
  (userId: string, guildId: string): AppThunk =>
  async (dispatch, getState) => {
    const { token, clientHeaders } = getState().user;
    if (!token) return;

    const { userMap } = getState().export.exportMaps;
    const newUserMap = { ...userMap };

    // Lookup User and create mapping if one does not exist
    if (!newUserMap[userId]) {
      const { success, data } = await new DiscordService(
        undefined,
        clientHeaders,
      ).getUser(token, userId);
      if (success && data) {
        newUserMap[userId] = { ...getUserMappingData(data), guilds: {} };
      }
    }

    // Lookup Guild Data and update mapping if User mapping exists but Guild data does not
    if (newUserMap[userId] && !newUserMap[userId].guilds[guildId]) {
      const { success, data } = await new DiscordService(
        undefined,
        clientHeaders,
      ).fetchGuildUser(guildId, userId, token);
      if (success && data) {
        newUserMap[userId].guilds[guildId] = { ...getGMOMappingData(data) };
      } else {
        newUserMap[userId].guilds[guildId] = { ...defaultGMOMappingData };
      }
    }

    // Add specified User to map
    dispatch(setExportUserMap(newUserMap));

    // Refresh Guild Users
    dispatch(getPreFilterUsers(guildId));
  };

export default userSlice.reducer;
