import {
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  loadSettings,
  saveSettings,
  type AppSettings,
} from "../lib/settings";

export type UseSettingsDraftOptions = {
  setSettings: Dispatch<SetStateAction<AppSettings>>;
};

export function commitSettingsDraft(
  settingsDraft: AppSettings,
  deps: UseSettingsDraftOptions,
): AppSettings {
  const next = saveSettings(settingsDraft);
  deps.setSettings(next);
  return next;
}

export function useSettingsDraft(options: UseSettingsDraftOptions) {
  const [settingsDraft, setSettingsDraft] = useState<AppSettings>(() =>
    loadSettings(),
  );
  const [settingsStatus, setSettingsStatus] = useState("");

  function resetSettingsDraft(settings: AppSettings) {
    setSettingsDraft(settings);
    setSettingsStatus("");
  }

  function onSaveSettings() {
    const next = commitSettingsDraft(settingsDraft, options);
    setSettingsDraft(next);
    setSettingsStatus("Saved — filters apply to the next Scout.");
  }

  return {
    settingsDraft,
    setSettingsDraft,
    settingsStatus,
    resetSettingsDraft,
    onSaveSettings,
  };
}
