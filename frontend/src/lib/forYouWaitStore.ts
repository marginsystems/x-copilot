import {
  FOR_YOU_WAIT_STORAGE_KEY,
  parseForYouWait,
  type ForYouWait,
} from "../../../shared/src/forYouTask";

function storageKey(owner: string): string {
  return `${FOR_YOU_WAIT_STORAGE_KEY}:${owner}`;
}

export function readForYouWait(owner: string): ForYouWait | null {
  try {
    return parseForYouWait(sessionStorage.getItem(storageKey(owner)), owner);
  } catch {
    return null;
  }
}

export function writeForYouWait(wait: ForYouWait): void {
  try {
    sessionStorage.setItem(storageKey(wait.owner), JSON.stringify(wait));
  } catch {
    /* private mode */
  }
}

export function clearForYouWait(owner: string): void {
  try {
    sessionStorage.removeItem(storageKey(owner));
  } catch {
    /* private mode */
  }
}
