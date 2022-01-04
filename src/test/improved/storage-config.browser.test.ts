import { testScenarios } from "./test-scenarios.browser.ts";
import { runStorageConfigTests } from "./storage-config.shared.ts";

for (let scenario of testScenarios) {
  runStorageConfigTests(scenario);
}
