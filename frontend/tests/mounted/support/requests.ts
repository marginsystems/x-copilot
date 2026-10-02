import { act } from "@testing-library/react";
import { vi, type Mock } from "vitest";

export function stubFetch(fetchMock: Mock<typeof fetch>) {
  const inFlight: Promise<unknown>[] = [];
  const readJson = Response.prototype.json;
  vi.spyOn(Response.prototype, "json").mockImplementation(function (this: Response) {
    const body: Promise<unknown> = readJson.call(this);
    inFlight.push(body);
    return body;
  });
  vi.stubGlobal("fetch", vi.fn<typeof fetch>((input, init) => {
    const response = fetchMock(input, init);
    inFlight.push(response);
    return response;
  }));
  return {
    async settle() {
      while (inFlight.length) {
        const batch = inFlight.splice(0);
        await act(async () => { await Promise.allSettled(batch); });
      }
    },
  };
}
