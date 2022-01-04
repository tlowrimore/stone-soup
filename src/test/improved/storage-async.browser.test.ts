import { testScenarios } from "./test-scenarios.browser.ts";
import { runStorageAsyncTests } from "./storage-async.shared.ts";

for (let scenario of testScenarios) {
  runStorageAsyncTests(scenario);
}
