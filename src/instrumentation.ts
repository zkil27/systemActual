import { registerOTel } from "@vercel/otel";
import type { Instrumentation } from "next";

export function register() {
  registerOTel({ serviceName: process.env.VERCEL_PROJECT_NAME || "kyna-ops" });
}

/**
 * Server errors from pages and API routes go to the developer error log
 * (Developer › Errors), because Vercel Hobby keeps runtime logs for 1 hour.
 */
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const { recordError, errorText } = await import("@/lib/dev/errors");
    const { message, stack } = errorText(err);
    await recordError({
      source: "server",
      message: `${message}${context.routeType ? ` [${context.routeType}]` : ""}`,
      stack,
      route: request.path,
      userAgent: typeof request.headers["user-agent"] === "string" ? request.headers["user-agent"] : null,
    });
  } catch {
    // Never let error logging throw from the error hook.
  }
};
