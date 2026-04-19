// Next.js uses thrown errors for internal control flow: redirect(),
// notFound(), etc. These carry a `digest` that begins with "NEXT_". If we
// catch an error with one of those digests we must re-throw it or Next.js
// will render the wrong thing.
export function isNextControlFlowError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const digest = (error as { digest?: unknown }).digest;
  if (typeof digest !== "string") return false;
  return digest.startsWith("NEXT_");
}

export type CaughtErrorDetail = {
  name: string;
  message: string;
  digest?: string;
  stack?: string;
};

export function captureErrorDetail(error: unknown): CaughtErrorDetail {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      digest: (error as { digest?: string }).digest,
      stack: error.stack,
    };
  }
  return {
    name: typeof error,
    message: String(error),
  };
}
