/**
 * Slack Incoming Webhook poster. Failures are logged; the sidecar never throws.
 */

const SLACK_TIMEOUT_MS = 5_000;

export async function postSlackWebhook(
  webhookUrl: string,
  text: string,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  const url = webhookUrl.trim();
  if (!url || !text.trim()) return false;
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(SLACK_TIMEOUT_MS),
    });
    return res.ok;
  } catch {
    return false;
  }
}
