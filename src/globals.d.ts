/** Compile-time flag injected by Vite `define` - true when built/served on Vercel */
declare const __VERCEL__: boolean;

/** Build identity injected by Vite `define`; the same payload is emitted as dist/version.json */
declare const __ENSO_BUILD__: {
  sha: string;
  time: string;
  source: "release" | "local" | "dev";
};
