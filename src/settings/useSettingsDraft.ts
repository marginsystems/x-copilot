import { useState, type Dispatch, type SetStateAction } from "react";
import {
  loadSettings,
  saveSettings,
  threadHasExcludedTag,
  type AppSettings,
} from "../lib/settings";
import { threadHasExcludedAuthor } from "../desk/threadHelpers";
import type { ThreadCard } from "../desk/types";

type UseSettingsDraftOptions = {
  setSettings: Dispatch<SetStateAction<AppSettings>>;
  setThreads: Dispatch<SetStateAction<ThreadCard[]>>;
};

export function useSettingsDraft({
  setSettings,
  setThreads,
}: UseSettingsDraftOptions) {
  const [settingsDraft, setSettingsDraft] = useState<AppSettings>(() =>
    loadSettings(),
  );
  const [settingsStatus, setSettingsStatus] = useState("");

  function resetSettingsDraft(settings: AppSettings) {
    setSettingsDraft(settings);
    setSettingsStatus("");
  }

  function onSaveSettings() {
    const next = saveSettings(settingsDraft);
    setSettings(next);
    setSettingsDraft(next);
    setThreads((prev) =>
      prev.filter(
        (thread) =>
          !threadHasExcludedTag(thread, next.excludedTags) &&
          !threadHasExcludedAuthor(thread, next.excludedAccounts),
      ),
    );
    setSettingsStatus(
      "Saved — filters apply to For You now and the next Scout.",
    );
  }

  return {
    settingsDraft,
    setSettingsDraft,
    settingsStatus,
    resetSettingsDraft,
    onSaveSettings,
  };
}
