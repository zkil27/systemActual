import { SpanStatusCode, trace } from "@opentelemetry/api";
import { currentRecorder, stepName } from "@/lib/dev/tick-context";

const tracer = trace.getTracer("kyna-ops");

export function withSpan<T>(name: string, fn: () => Promise<T>): Promise<T> {
  return tracer.startActiveSpan(name, async (span) => {
    const started = Date.now();
    let failure: string | undefined;
    try {
      return await fn();
    } catch (err) {
      failure = err instanceof Error ? err.message : String(err);
      span.recordException(err instanceof Error ? err : new Error(String(err)));
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: failure,
      });
      throw err;
    } finally {
      span.end();
      // Inside a worker tick, also keep the step's time for the Developer screen.
      currentRecorder()?.step(stepName(name), Date.now() - started, failure);
    }
  });
}
