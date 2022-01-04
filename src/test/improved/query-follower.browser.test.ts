import { testScenarios } from "./test-scenarios.browser.ts";
import { runQueryFollowerTests } from "./query-follower.shared.ts";

for (let scenario of testScenarios) {
  runQueryFollowerTests(scenario);
}
