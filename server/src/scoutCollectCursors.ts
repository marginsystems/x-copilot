import { startTimeFromWithin } from "./xApi.js";

export type ScoutQueryResume = {
  cursor?: string;
  startTime: string;
  endTime: string;
};

type ScoutQueryCursorRecord = ScoutQueryResume & {
  exhausted: boolean;
};

/** Keeps each Scout query inside one stable v2 search window. */
export class ScoutCollectCursors {
  private readonly records = new Map<string, ScoutQueryCursorRecord>();

  private record(query: string): ScoutQueryCursorRecord {
    const existing = this.records.get(query);
    if (existing) return existing;

    const startTime = startTimeFromWithin("12h");
    const created: ScoutQueryCursorRecord = {
      startTime,
      endTime: new Date(Date.parse(startTime) + 11 * 60 * 60 * 1000).toISOString(),
      exhausted: false,
    };
    this.records.set(query, created);
    return created;
  }

  resume(query: string): ScoutQueryResume | undefined {
    const record = this.record(query);
    if (record.exhausted) return undefined;
    return {
      cursor: record.cursor,
      startTime: record.startTime,
      endTime: record.endTime,
    };
  }

  update(query: string, bottomCursor: string | null | undefined): void {
    const record = this.record(query);
    const cursor = bottomCursor?.trim();
    record.cursor = cursor || undefined;
    record.exhausted = !cursor;
  }

  hasAvailable(queries: string[]): boolean {
    return queries.some((query) => !this.record(query).exhausted);
  }
}
