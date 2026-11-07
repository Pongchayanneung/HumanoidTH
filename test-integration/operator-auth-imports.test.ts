import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

test("a fresh process imports the real auth and disabled handler graph without database configuration", () => {
  const env = { ...process.env };
  env.NODE_ENV = "test";
  for (const name of Object.keys(env)) if (name === "DATABASE_URL" || name.startsWith("OPERATOR_")) delete env[name];
  const child = spawnSync(process.execPath, ["--conditions=react-server", "--experimental-test-module-mocks", "--disable-warning=ExperimentalWarning", "--import", "tsx", "--input-type=module", "-e", `
    import assert from 'node:assert/strict';
    import {mock} from 'node:test';
    // Next navigation requires a client context under standalone react-server.
    // Do not replace any auth/storage module: this guards the actual import graph.
    mock.module('next/navigation', {namedExports:{redirect(){throw Error('Unexpected redirect')}}});
    const unavailable = {ok:false,code:'UNAVAILABLE'};
    const auth = await import('./lib/operator-auth/index.ts');
    const web = await import('./lib/operator-auth/web.ts');
    assert.deepEqual(await auth.loginOperator({email:'synthetic@example.invalid',password:'synthetic'}),unavailable);
    assert.deepEqual(await auth.readOperatorSession(),unavailable);
    assert.deepEqual(await auth.readOperatorSession('0'.repeat(64)),unavailable);
    assert.deepEqual(await auth.revokeOperatorSession('0'.repeat(64)),unavailable);
    assert.deepEqual(await web.signInOperator({email:'synthetic@example.invalid',password:'synthetic'}),unavailable);
    assert.deepEqual(await web.signOutOperator(),unavailable);
    assert.deepEqual(await web.getOperatorPrincipal(),unavailable);
    const actions = await import('./app/actions.ts');
    const poison = new Proxy({}, {get(){throw Error('Unexpected request access')}});
    assert.deepEqual(await actions.createSubmission(poison),{ok:false,code:'WORKFLOW_UNAVAILABLE'});
    const map = await import('./app/map/actions.ts');
    assert.deepEqual(await map.fetchContributionClusters(),[]);
    const {GET}=await import('./app/api/export/route.ts');
    const {POST}=await import('./app/api/ingest/[adapter]/route.ts');
    for(const result of [await GET(poison),await POST(poison,poison)]) {
      assert.equal(result.status,403);assert.deepEqual(await result.json(),{ok:false,code:'WORKFLOW_UNAVAILABLE'});
    }
  `], { cwd: process.cwd(), env, encoding: "utf8", timeout: 20_000 });
  assert.equal(child.error, undefined);
  assert.equal(child.status, 0, child.stderr || "Fresh-process imports failed");
});
