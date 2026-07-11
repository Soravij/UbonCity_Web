import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { openDatabase } from '../db/client.mjs';
import { createRepository } from '../db/repository.mjs';

const testFilePath = fileURLToPath(import.meta.url);
const testsDir = path.dirname(testFilePath);
const collectorRoot = path.resolve(testsDir, '..');
const appJs = fs.readFileSync(path.join(collectorRoot, 'server', 'public', 'app.js'), 'utf8');
const serverIndexJs = fs.readFileSync(path.join(collectorRoot, 'server', 'index.mjs'), 'utf8');
const repositoryJs = fs.readFileSync(
  path.join(collectorRoot, 'db', 'repository.mjs'),
  'utf8'
);
const reviewMediaItemsSource = extractNamedFunctionSource(appJs, 'getAssignmentReviewMediaItems');

function extractNamedFunctionSource(source, name) {
  const marker = `function ${name}`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `${name} should exist`);
  const bodyStart = source.indexOf('{', start);
  assert.notEqual(bodyStart, -1, `${name} should have a body`);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`Could not extract function ${name}`);
}

function createDbContext(prefix = 'collector-assignment-round-') {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const dbPath = path.join(tempDir, 'test.sqlite');
  const schemaPath = path.join(collectorRoot, 'database', 'schema.sql');
  const db = openDatabase(dbPath, schemaPath);
  const repo = createRepository(db);

  function cleanup() {
    try {
      db.close();
    } catch {}
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  function createItem(title) {
    const created = repo.createItemWithWorkflowHead({
      type: 'place',
      category: 'attractions',
      title,
      description_raw: `${title} raw`,
      source_type: 'manual',
      source_name: 'manual',
      source_url: `https://${title.toLowerCase().replace(/\s+/g, '-')}.example.com`,
    });
    return created.item;
  }

  function createUser(suffix = 'user') {
    const email = `${suffix}-${Date.now()}-${Math.floor(Math.random() * 100000)}@local.test`;
    const result = db.prepare(`
      INSERT INTO users (email, display_name, password_hash, role)
      VALUES (?, ?, 'hash', 'user')
    `).run(email, `User ${suffix}`);
    return {
      id: Number(result.lastInsertRowid || 0),
      email,
    };
  }

  function createAssignment(itemId, assigneeUserId, assignmentKind = 'field') {
    return repo.createAssignment({
      content_item_id: itemId,
      assignee_user_id: assigneeUserId,
      assignment_kind: assignmentKind,
      state: 'assigned',
      due_at: new Date(Date.now() + 86400000).toISOString(),
    }, assigneeUserId, {
      actor_email: 'tester@local',
      actor_role: 'admin',
      reason_code: 'test_assignment_created',
    });
  }

  return { db, repo, cleanup, createItem, createUser, createAssignment };
}

const getAssignmentCurrentRoundForTest = new Function(
  `${extractNamedFunctionSource(appJs, 'getAssignmentCurrentRound')}
return getAssignmentCurrentRound;`
)();

const resolveAssignmentCurrentRoundForTest = new Function(
  `${extractNamedFunctionSource(serverIndexJs, 'resolveAssignmentCurrentRound')}
return resolveAssignmentCurrentRound;`
)();

test('assignment work active round follows canonical revision_round directly', () => {
  assert.equal(getAssignmentCurrentRoundForTest({ revision_round: 2 }), 2);
  assert.equal(getAssignmentCurrentRoundForTest({ revision_round: 1 }), 1);
  assert.equal(getAssignmentCurrentRoundForTest(null), 1);
  assert.equal(resolveAssignmentCurrentRoundForTest({ revision_round: 2 }), 2);
  assert.equal(resolveAssignmentCurrentRoundForTest({ revision_round: 1 }), 1);
  assert.equal(resolveAssignmentCurrentRoundForTest(null), 1);
});

test('assignment work round helpers no longer derive revision_round + 1', () => {
  const snippets = [
    extractNamedFunctionSource(appJs, 'getAssignmentCurrentRound'),
    extractNamedFunctionSource(serverIndexJs, 'resolveAssignmentCurrentRound'),
    extractNamedFunctionSource(repositoryJs, 'upsertAssignmentSubmissionDraft'),
    extractNamedFunctionSource(repositoryJs, 'getAssignmentSubmissionDraft'),
    extractNamedFunctionSource(repositoryJs, 'deleteAssignmentSubmissionDraft'),
  ];
  snippets.forEach((snippet) => {
    assert.equal(snippet.includes('revision_round + 1'), false);
  });
});

test('review media helper stays bundle-first and falls back to latest submission payload', () => {
  assert.equal(reviewMediaItemsSource.includes('selectAssignmentReviewMediaBundle'), false);
  assert.equal(reviewMediaItemsSource.includes('submissionRowsByAssignment'), false);
  assert.equal(reviewMediaItemsSource.includes('deliverableRowsByAssignment'), false);
  assert.equal(reviewMediaItemsSource.includes('selectedBundle'), false);

  const buildItems = new Function('state', `
    function getLatestAssignmentSubmissionRow() { return state.latestSubmission; }
    function resolveAssignmentReviewMediaUrl(item) { return String(item?.public_url || item?.url || '').trim(); }
    function summarizeAssignmentReviewMediaLabel(item, fallbackLabel) { return String(item?.label || '').trim() || fallbackLabel; }
    function getAssignmentDeliverableLabel(type) { return type === 'videos' ? 'Video' : 'Photo'; }
    ${reviewMediaItemsSource}
    return getAssignmentReviewMediaItems;
  `);

  const fromBundle = buildItems({
    assignments: {
      deliverablesBundle: {
        deliverables_by_type: {
          photos: [{ id: 1, public_url: 'https://example.test/bundle.jpg', created_at: '2026-01-01' }],
        },
      },
    },
    latestSubmission: null,
  })({ id: 29 }, 'photos');
  assert.equal(fromBundle.length, 1);
  assert.equal(fromBundle[0].url, 'https://example.test/bundle.jpg');
  assert.equal(fromBundle[0].label, 'Photo 1');

  const fromPayload = buildItems({
    assignments: {
      deliverablesBundle: {
        deliverables_by_type: {
          photos: [],
        },
      },
    },
    latestSubmission: {
      media_payload_json: {
        assets: [{ id: 7, mime_type: 'image/jpeg', public_url: 'https://example.test/payload.jpg', file_name: 'payload.jpg' }],
      },
    },
  })({ id: 29 }, 'photos');
  assert.equal(fromPayload.length, 1);
  assert.equal(fromPayload[0].url, 'https://example.test/payload.jpg');
  assert.equal(fromPayload[0].label, 'payload.jpg');
});

test('draft save load and delete use the canonical assignment revision_round', () => {
  const ctx = createDbContext();
  try {
    const item = ctx.createItem('Round Two Item');
    const user = ctx.createUser('round-two');
    const assignment = ctx.createAssignment(item.id, user.id);
    ctx.db.prepare('UPDATE content_assignments SET revision_round=? WHERE id=?').run(2, assignment.id);

    const saved = ctx.repo.upsertAssignmentSubmissionDraft({
      assignment_id: assignment.id,
      user_id: user.id,
      revision_round: 999,
      article_payload_json: { additional_text: 'canonical round 2' },
      expires_at: new Date(Date.now() + 86400000).toISOString(),
    });
    assert.equal(Number(saved.revision_round || 0), 2);

    const loaded = ctx.repo.getAssignmentSubmissionDraft(assignment.id, user.id, { revision_round: 999 });
    assert.equal(Number(loaded?.revision_round || 0), 2);

    const deleted = ctx.repo.deleteAssignmentSubmissionDraft(assignment.id, user.id, 999);
    assert.equal(deleted > 0, true);
    const afterDelete = ctx.repo.getAssignmentSubmissionDraft(assignment.id, user.id, { revision_round: 2 });
    assert.equal(afterDelete, null);
  } finally {
    ctx.cleanup();
  }
});
