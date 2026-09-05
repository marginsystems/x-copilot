import {
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import {
  keepPlainTextThread,
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
  sourceThreadsRef?: MutableRefObject<ThreadCard[] | null>;
};

export function useSettingsDraft({
  setSettings,
  setThreads,
  sourceThreadsRef,
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
      (sourceThreadsRef?.current ?? prev).filter(
        (thread) =>
          !threadHasExcludedTag(thread, next.excludedTags) &&
          !threadHasExcludedAuthor(thread, next.excludedAccounts) &&
          keepPlainTextThread(thread, next),
      ),
    );
    setSettingsStatus(
      "Saved — filters apply to Approach now and the next Scout.",
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
