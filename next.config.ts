import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Route handlers read recorded cases, the watch, the back-test and replayed model answers from data/.
  outputFileTracingIncludes: {
    "/api/**": ["./data/cases/**", "./data/watch/**", "./data/backtest/**", "./data/eval/**", "./data/plants.json", "./data/replay/**", "./src/engines/scout/registry/**"],
    "/**": ["./data/cases/**", "./data/watch/**", "./data/backtest/**", "./data/eval/**", "./data/plants.json"],
  },
};

export default nextConfig;
