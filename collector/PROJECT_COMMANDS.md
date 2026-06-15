# Collector Project Commands

```text
cd collector
npm.cmd install
npm.cmd run start
npm.cmd run backend:ready
npm.cmd run backend:health
npm.cmd run backend:status
npm.cmd run backend:restart
npm.cmd run backend:stop
npm.cmd run backend:smoke
npm.cmd run backend:smoke:local-auth
npm.cmd run backend:smoke:lifecycle-authority:live
npm.cmd run backend:smoke:transport-workflow:live
npm.cmd run backend:smoke:article-flow-e2e
npm.cmd run backend:smoke:article-revision-loop
npm.cmd run backend:smoke:article-preview-sanitization
npm.cmd run build-export
npm.cmd run db:init
npm.cmd run test:token
node --check collector\server\index.mjs
node --check collector\db\repository.mjs
node --test collector\tests\field-pack.repository.test.mjs
node --test collector\tests\requested-check-ui.behavior.test.mjs
node --test collector\tests\requested-check-return-form.behavior.test.mjs
node --test collector\tests\article-workspace-field-return-evidence.behavior.test.mjs
node --test collector\tests\article-submit-readiness.behavior.test.mjs
```
