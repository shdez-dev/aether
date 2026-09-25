const config = require("./lighthouserc.cjs");
module.exports = {
  ci: {
    ...config.ci,
    collect: { ...config.ci.collect, settings: { formFactor: "mobile" } },
    upload: { target: "filesystem", outputDir: "./.lighthouseci/mobile-reports" },
  },
};
