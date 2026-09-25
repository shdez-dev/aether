module.exports = {
  ci: {
    collect: { url: ["http://127.0.0.1:3100/"], numberOfRuns: 3, settings: { preset: "desktop" }, startServerCommand: "pnpm start --hostname 127.0.0.1 --port 3100", startServerReadyPattern: "Ready" },
    assert: { assertions: {
      "categories:performance": ["error", { minScore: .9 }],
      "categories:accessibility": ["error", { minScore: .95 }],
      "categories:best-practices": ["error", { minScore: .9 }],
      "categories:seo": ["error", { minScore: .95 }],
      "largest-contentful-paint": ["error", { maxNumericValue: 2500 }],
      "cumulative-layout-shift": ["error", { maxNumericValue: .1 }],
    } },
    upload: { target: "filesystem", outputDir: "./.lighthouseci/reports" },
  },
};
