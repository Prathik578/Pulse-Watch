import { lookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import ipaddr from "ipaddr.js";

type FailureCategory =
  | "timeout"
  | "dns"
  | "connection"
  | "tls"
  | "http_status"
  | "restricted_address"
  | "invalid_url"
  | "unknown";

export type CheckOutcome = {
  state: "up" | "down";
  httpStatus: number | null;
  latencyMs: number | null;
  errorCategory: FailureCategory | null;
  errorMessage: string | null;
};

type PinnedAddress = {
  address: string;
  family: 4 | 6;
};

type RequestResult = {
  statusCode: number;
  location?: string;
};

class CheckFailure extends Error {
  constructor(
    readonly category: FailureCategory,
    message: string,
  ) {
    super(message);
  }
}

const BLOCKED_HOSTNAMES = new Set([
  "metadata",
  "metadata.google.internal",
  "metadata.amazonaws.com",
  "instance-data",
]);
const MAX_REDIRECTS = 5;

export async function validateMonitorUrl(rawUrl: string): Promise<string> {
  const parsed = parseHttpUrl(rawUrl);
  const hostname = normalizeHostname(parsed.hostname);

  if (
    BLOCKED_HOSTNAMES.has(hostname) ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal")
  ) {
    throw new CheckFailure(
      "restricted_address",
      "This hostname is not allowed for monitoring.",
    );
  }

  if (isIP(hostname)) {
    if (!isPublicAddress(hostname)) {
      throw new CheckFailure(
        "restricted_address",
        "Private and reserved IP addresses cannot be monitored.",
      );
    }
    return parsed.toString();
  }

  try {
    await resolvePublicAddress(hostname);
  } catch (error) {
    if (error instanceof CheckFailure && error.category === "dns") {
      // A currently unreachable hostname can still be monitored for DNS recovery.
      return parsed.toString();
    }
    throw error;
  }

  return parsed.toString();
}

export async function checkEndpoint(
  rawUrl: string,
  method: "GET" | "HEAD",
  timeoutMs: number,
  expectedStatusCodes: number[],
): Promise<CheckOutcome> {
  const startedAt = performance.now();
  let url: URL;

  try {
    url = parseHttpUrl(rawUrl);

    for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
      const hostname = normalizeHostname(url.hostname);
      const address = await resolvePublicAddress(hostname);
      const response = await requestPinned(url, address, method, timeoutMs);

      if (
        [301, 302, 303, 307, 308].includes(response.statusCode) &&
        response.location
      ) {
        if (redirect === MAX_REDIRECTS) {
          throw new CheckFailure(
            "connection",
            "The endpoint redirected too many times.",
          );
        }

        try {
          url = new URL(response.location, url);
        } catch {
          throw new CheckFailure(
            "invalid_url",
            "The endpoint returned an invalid redirect.",
          );
        }
        parseHttpUrl(url.toString());
        continue;
      }

      const latencyMs = Math.max(0, Math.round(performance.now() - startedAt));
      const up = expectedStatusCodes.includes(response.statusCode);
      return {
        state: up ? "up" : "down",
        httpStatus: response.statusCode,
        latencyMs,
        errorCategory: up ? null : "http_status",
        errorMessage: up
          ? null
          : `Unexpected HTTP status ${response.statusCode}.`,
      };
    }
  } catch (error) {
    const category =
      error instanceof CheckFailure ? error.category : classifyNetworkError(error);
    const errorMessage =
      error instanceof CheckFailure
        ? error.message
        : categoryMessage(category);
    return {
      state: "down",
      httpStatus: null,
      latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
      errorCategory: category,
      errorMessage,
    };
  }

  return {
    state: "down",
    httpStatus: null,
    latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
    errorCategory: "unknown",
    errorMessage: "The endpoint could not be checked.",
  };
}

function parseHttpUrl(rawUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new CheckFailure("invalid_url", "Enter a valid HTTP or HTTPS URL.");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new CheckFailure(
      "invalid_url",
      "Only HTTP and HTTPS endpoints are supported.",
    );
  }
  if (parsed.username || parsed.password) {
    throw new CheckFailure(
      "invalid_url",
      "URLs containing embedded credentials are not allowed.",
    );
  }

  const hostname = normalizeHostname(parsed.hostname);
  if (!hostname) {
    throw new CheckFailure("invalid_url", "The endpoint needs a hostname.");
  }
  if (
    BLOCKED_HOSTNAMES.has(hostname) ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal")
  ) {
    throw new CheckFailure(
      "restricted_address",
      "This hostname is not allowed for monitoring.",
    );
  }

  return parsed;
}

function normalizeHostname(hostname: string): string {
  return hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
}

async function resolvePublicAddress(hostname: string): Promise<PinnedAddress> {
  if (isIP(hostname)) {
    if (!isPublicAddress(hostname)) {
      throw new CheckFailure(
        "restricted_address",
        "Private and reserved IP addresses cannot be monitored.",
      );
    }
    return { address: hostname, family: isIP(hostname) as 4 | 6 };
  }

  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new CheckFailure("dns", "The endpoint hostname could not be resolved.");
  }

  if (addresses.length === 0) {
    throw new CheckFailure("dns", "The endpoint hostname has no IP addresses.");
  }
  if (addresses.some(({ address }) => !isPublicAddress(address))) {
    throw new CheckFailure(
      "restricted_address",
      "The endpoint resolves to a private or reserved IP address.",
    );
  }

  const selected = addresses[0];
  return { address: selected.address, family: selected.family as 4 | 6 };
}

function isPublicAddress(address: string): boolean {
  try {
    return ipaddr.process(address).range() === "unicast";
  } catch {
    return false;
  }
}

function requestPinned(
  url: URL,
  address: PinnedAddress,
  method: "GET" | "HEAD",
  timeoutMs: number,
): Promise<RequestResult> {
  const client = url.protocol === "https:" ? https : http;

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (result: RequestResult): void => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const request = client.request(
      url,
      {
        method,
        headers: {
          "user-agent": "PulseWatch/1.0",
          accept: "*/*",
          connection: "close",
        },
        lookup: (_hostname, _options, callback) => {
          callback(null, address.address, address.family);
        },
      },
      (response) => {
        const result: RequestResult = {
          statusCode: response.statusCode ?? 0,
          location: response.headers.location,
        };
        response.on("error", () => undefined);
        response.destroy();
        finish(result);
      },
    );

    const timer = setTimeout(() => {
      request.destroy(Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }));
    }, timeoutMs);
    request.on("error", (error) => {
      clearTimeout(timer);
      if (!settled) reject(error);
    });
    request.on("close", () => clearTimeout(timer));
    request.end();
  });
}

function classifyNetworkError(error: unknown): FailureCategory {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String(error.code)
      : "";
  if (code === "ETIMEDOUT" || code === "ESOCKETTIMEDOUT") return "timeout";
  if (code.startsWith("ERR_TLS") || code.startsWith("CERT_")) return "tls";
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return "dns";
  if (
    ["ECONNREFUSED", "ECONNRESET", "EHOSTUNREACH", "ENETUNREACH"].includes(
      code,
    )
  ) {
    return "connection";
  }
  return "unknown";
}

function categoryMessage(category: FailureCategory): string {
  switch (category) {
    case "timeout":
      return "The endpoint timed out.";
    case "dns":
      return "The endpoint hostname could not be resolved.";
    case "connection":
      return "A connection to the endpoint could not be established.";
    case "tls":
      return "The endpoint's TLS certificate or handshake could not be verified.";
    case "restricted_address":
      return "The endpoint resolves to a restricted network address.";
    case "invalid_url":
      return "The endpoint URL is invalid.";
    case "http_status":
      return "The endpoint returned an unexpected HTTP status.";
    default:
      return "The endpoint could not be checked.";
  }
}
