import { parseErrorResponse } from "@comic-free/contracts";

type JsonParser<T> = (value: unknown) => T;

export async function requestJson<T>(
  url: string,
  parse: JsonParser<T>,
  options: RequestInit,
): Promise<T> {
  const response = await fetch(url, options);
  let value: unknown;
  try {
    value = (await response.json()) as unknown;
  } catch {
    if (!response.ok) {
      throw new Error(`Local Core returned HTTP ${response.status}.`);
    }
    throw new TypeError("Local Core returned invalid JSON.");
  }

  if (!response.ok) {
    let message: string;
    try {
      message = parseErrorResponse(value).error.message;
    } catch {
      throw new Error(`Local Core returned HTTP ${response.status}.`);
    }
    throw new Error(message);
  }
  return parse(value);
}
