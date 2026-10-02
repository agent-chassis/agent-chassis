

import { withTestFixture } from "./helpers/test-fixture.mjs";

export async function withTempDir(fn) {
  await withTestFixture(async ({ rootPath }) => {
    await fn(rootPath);
  }, { prefix: "wiki-bootstrap-test-" });
}
