import {
  onOriginalPosted,
  onReplyMarked,
  setForkChoice,
} from "../../src/lib/deskBeats.js";
import { getPlatformDb } from "./db.js";
import { utcDayKey } from "./gamificationXp.js";

type StoredDeskBeats = ReturnType<typeof onReplyMarked>;

type DeskBeatsRow = {
  scoutReplyDone: number;
  organicReplyDone: number;
  forkChoice: "original" | "reply" | null;
  forkDone: number;
};

function emptyStoredBeats(): StoredDeskBeats {
  return {
    scoutReplyDone: false,
    organicReplyDone: false,
    forkChoice: null,
    forkDone: false,
  };
}

export function getDeskBeats(opts: {
  userId: string;
  nowMs?: number;
}): StoredDeskBeats {
  const dayUtc = utcDayKey(opts.nowMs ?? Date.now());
  const row = getPlatformDb()
    .prepare(
      `SELECT
         scout_reply_done AS scoutReplyDone,
         organic_reply_done AS organicReplyDone,
         fork_choice AS forkChoice,
         fork_done AS forkDone
       FROM desk_beats
       WHERE user_id = ? AND day_utc = ?`,
    )
    .get(opts.userId, dayUtc) as DeskBeatsRow | undefined;
  if (!row) return emptyStoredBeats();
  return {
    scoutReplyDone: row.scoutReplyDone === 1,
    organicReplyDone: row.organicReplyDone === 1,
    forkChoice: row.forkChoice,
    forkDone: row.forkDone === 1,
  };
}

function advanceDeskBeats(opts: {
  userId: string;
  nowMs?: number;
  advance: (beats: StoredDeskBeats) => StoredDeskBeats;
}): StoredDeskBeats {
  const nowMs = opts.nowMs ?? Date.now();
  const dayUtc = utcDayKey(nowMs);
  const db = getPlatformDb();
  return db.transaction(() => {
    const next = opts.advance(getDeskBeats({ userId: opts.userId, nowMs }));
    db.prepare(
      `INSERT INTO desk_beats (
         user_id, day_utc, scout_reply_done, organic_reply_done,
         fork_choice, fork_done, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, day_utc) DO UPDATE SET
         scout_reply_done = excluded.scout_reply_done,
         organic_reply_done = excluded.organic_reply_done,
         fork_choice = excluded.fork_choice,
         fork_done = excluded.fork_done,
         updated_at = excluded.updated_at`,
    ).run(
      opts.userId,
      dayUtc,
      next.scoutReplyDone ? 1 : 0,
      next.organicReplyDone ? 1 : 0,
      next.forkChoice,
      next.forkDone ? 1 : 0,
      new Date(nowMs).toISOString(),
    );
    return next;
  })();
}

export function recordDeskReplyMarked(opts: {
  userId: string;
  nowMs?: number;
}): StoredDeskBeats {
  return advanceDeskBeats({ ...opts, advance: onReplyMarked });
}

export function recordDeskOriginalPosted(opts: {
  userId: string;
  nowMs?: number;
}): StoredDeskBeats {
  return advanceDeskBeats({ ...opts, advance: onOriginalPosted });
}

export function chooseDeskFork(opts: {
  userId: string;
  forkChoice: "original" | "reply";
  nowMs?: number;
}): StoredDeskBeats {
  return advanceDeskBeats({
    ...opts,
    advance: (beats) => setForkChoice(beats, opts.forkChoice),
  });
}
