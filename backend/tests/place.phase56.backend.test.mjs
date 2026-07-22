import test from "node:test";
import assert from "node:assert/strict";

import pool from "../config/db.js";
import {
  createPlace,
  getPlaceDetail,
  getPlaces,
  importPlaces,
  importPlacesCsv,
  updatePlace,
} from "../controllers/placeController.js";

function normalizeSql(sql) {
  return String(sql || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function createMockRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

function createBaseReq() {
  return {
    headers: {},
    protocol: "https",
    get(name) {
      if (String(name || "").toLowerCase() === "host") return "api.test.local";
      return "";
    },
  };
}

async function withMockedPool(handler, run) {
  const originalQuery = pool.query;
  const calls = [];
  pool.query = async (sql, params = []) => {
    const call = { sql: String(sql || ""), params: Array.isArray(params) ? params : [] };
    calls.push(call);
    return handler(call);
  };

  try {
    return await run(calls);
  } finally {
    pool.query = originalQuery;
  }
}

function findPlacesMutationCall(calls) {
  return calls.find((call) => {
    const sql = normalizeSql(call.sql);
    return (
      (sql.includes("insert into places") || sql.startsWith("update places")) &&
      sql.includes("decision_featured_score")
    );
  });
}

function assertDecisionResponseFields(row) {
  const required = [
    "decision_scenario_tags_list",
    "decision_trend_flags_list",
    "decision_moment_tags_list",
    "decision_insight_flags_list",
    "media_gallery_images",
    "effective_cover_image",
    "effective_thumbnail_image",
  ];

  for (const key of required) {
    assert.ok(Object.hasOwn(row, key), `missing field: ${key}`);
  }
}

function assertPublicResponseDoesNotLeakInternalFields(row) {
  for (const key of [
    "req_description",
    "th_description",
    "is_approved",
    "tracking_entity_type",
    "tracking_entity_id",
    "media_cover_image",
    "media_inline_images",
  ]) {
    assert.equal(key in row, false, `public response must not include ${key}`);
  }
}

function assertDecisionListValues(row, expected) {
  assert.deepEqual(row.decision_scenario_tags_list, expected.decision_scenario_tags_list);
  assert.deepEqual(row.decision_trend_flags_list, expected.decision_trend_flags_list);
  assert.deepEqual(row.decision_moment_tags_list, expected.decision_moment_tags_list);
  assert.deepEqual(row.decision_insight_flags_list, expected.decision_insight_flags_list);
}

test("phase 5-6 backend targeted coverage", async (t) => {
  await t.test("create place persists decision metadata", async () => {
    const req = {
      ...createBaseReq(),
      body: {
        category: "cafes",
        lang: "th",
        slug: "create-phase56",
        title: "Create Title",
        description: "Create Description",
        meta_title: "Create Meta",
        meta_description: "Create Meta Desc",
        image: "https://img.example/create-legacy.jpg",
        decision_featured_score: 321,
        decision_scenario_tags: "day-trip,couple",
        decision_trend_flags: "new,hot",
        decision_moment_tags: "evening,night",
        decision_insight_flags: "nearby",
        decision_cover_image: "https://img.example/create-cover.jpg",
        decision_thumbnail_image: "https://img.example/create-thumb.jpg",
      },
    };
    const res = createMockRes();

    await withMockedPool(async (call) => {
      const sql = normalizeSql(call.sql);

      if (sql.startsWith("show columns from places like")) return [[{ Field: "ok" }]];
      if (sql.includes("from places p join categories c on c.id = p.category_id")) return [[]];
      if (sql.startsWith("select id from categories where slug=? limit 1")) return [[{ id: 7 }]];
      if (sql.startsWith("select id from places where id=? limit 1")) return [[]];
      if (sql.includes("insert into places")) return [{ insertId: 101 }];
      if (sql.startsWith("select id from place_translations where place_id=? and lang=? limit 1")) return [[]];
      if (sql.includes("insert into place_translations")) return [{ insertId: 501 }];

      throw new Error(`Unexpected SQL in create test: ${call.sql}`);
    }, async (calls) => {
      await createPlace(req, res);
      assert.equal(res.statusCode, 200);
      assert.equal(res.body?.place_id, 101);

      const mutation = findPlacesMutationCall(calls);
      assert.ok(mutation, "expected places insert/update with decision fields");
      assert.equal(mutation.params[5], 321);
      assert.equal(mutation.params[6], "day-trip,couple");
      assert.equal(mutation.params[7], "new,hot");
      assert.equal(mutation.params[8], "evening,night");
      assert.equal(mutation.params[9], "nearby");
      assert.equal(mutation.params[10], "https://img.example/create-cover.jpg");
      assert.equal(mutation.params[11], "https://img.example/create-thumb.jpg");
    });
  });

  await t.test("update place persists decision metadata", async () => {
    const req = {
      ...createBaseReq(),
      params: { id: "44" },
      body: {
        lang: "th",
        title: "Updated Title",
        description: "Updated Description",
        meta_title: "Updated Meta",
        meta_description: "Updated Meta Desc",
        image: "https://img.example/update-legacy.jpg",
        decision_featured_score: 222,
        decision_scenario_tags: "family",
        decision_trend_flags: "trending",
        decision_moment_tags: "morning",
        decision_insight_flags: "planned",
        decision_cover_image: "https://img.example/update-cover.jpg",
        decision_thumbnail_image: "https://img.example/update-thumb.jpg",
      },
    };
    const res = createMockRes();

    await withMockedPool(async (call) => {
      const sql = normalizeSql(call.sql);

      if (sql.includes("from places p join categories c on c.id = p.category_id")) return [[]];
      if (sql.startsWith("select p.id, p.slug, c.slug as category from places p join categories c on c.id=p.category_id where p.id=? limit 1")) {
        return [[{ id: 44, slug: "update-phase56", category: "cafes" }]];
      }
      if (sql.startsWith("update places set image=?, is_approved=?, is_emer=?, decision_featured_score=?, decision_scenario_tags=?, decision_trend_flags=?, decision_moment_tags=?, decision_insight_flags=?, decision_cover_image=?, decision_thumbnail_image=? where id=?")) {
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith("update places set slug=coalesce(nullif(trim(slug), ''), ?) where id=?")) return [{}];
      if (sql.startsWith("select id from place_translations where place_id=? and lang=? limit 1")) return [[{ id: 88 }]];
      if (sql.startsWith("update place_translations set title=?, description=?, meta_title=?, meta_description=?")) {
        return [{}];
      }

      throw new Error(`Unexpected SQL in update test: ${call.sql}`);
    }, async (calls) => {
      await updatePlace(req, res);
      assert.equal(res.statusCode, 200);
      assert.equal(res.body?.message, "Updated");

      const mutation = findPlacesMutationCall(calls);
      assert.ok(mutation, "expected places update with decision fields");
      assert.equal(mutation.params[3], 222);
      assert.equal(mutation.params[4], "family");
      assert.equal(mutation.params[5], "trending");
      assert.equal(mutation.params[6], "morning");
      assert.equal(mutation.params[7], "planned");
      assert.equal(mutation.params[8], "https://img.example/update-cover.jpg");
      assert.equal(mutation.params[9], "https://img.example/update-thumb.jpg");
      assert.equal(mutation.params[10], 44);
    });
  });

  await t.test("JSON import preserves decision metadata", async () => {
    const req = {
      ...createBaseReq(),
      body: {
        items: [
          {
            category: "restaurants",
            lang: "th",
            slug: "import-json-phase56",
            title: "Import JSON Title",
            description: "Import JSON Description",
            meta_title: "Import JSON Meta",
            meta_description: "Import JSON Meta Desc",
            image: "https://img.example/import-json-legacy.jpg",
            decision_featured_score: 111,
            decision_scenario_tags: "budget-500",
            decision_trend_flags: "hot",
            decision_moment_tags: "evening",
            decision_insight_flags: "nearby",
            decision_cover_image: "https://img.example/import-json-cover.jpg",
            decision_thumbnail_image: "https://img.example/import-json-thumb.jpg",
          },
        ],
      },
    };
    const res = createMockRes();

    await withMockedPool(async (call) => {
      const sql = normalizeSql(call.sql);

      if (sql.startsWith("select id from categories where slug=? limit 1")) return [[{ id: 22 }]];
      if (sql.startsWith("select id from places where slug=? limit 1")) return [[]];
      if (sql.includes("insert into places")) return [{ insertId: 2233 }];
      if (sql.startsWith("select id from place_translations where place_id=? and lang=? limit 1")) return [[]];
      if (sql.includes("insert into place_translations")) return [{ insertId: 3333 }];

      throw new Error(`Unexpected SQL in import JSON test: ${call.sql}`);
    }, async (calls) => {
      await importPlaces(req, res);
      assert.equal(res.statusCode, 200);
      assert.equal(res.body?.created, 1);
      assert.equal(res.body?.rejected, 0);

      const mutation = findPlacesMutationCall(calls);
      assert.ok(mutation, "expected places insert/update with decision fields");
      assert.equal(mutation.params[3], 111);
      assert.equal(mutation.params[4], "budget-500");
      assert.equal(mutation.params[5], "hot");
      assert.equal(mutation.params[6], "evening");
      assert.equal(mutation.params[7], "nearby");
      assert.equal(mutation.params[8], "https://img.example/import-json-cover.jpg");
      assert.equal(mutation.params[9], "https://img.example/import-json-thumb.jpg");
    });
  });

  await t.test("JSON import preserves decision metadata on update path", async () => {
    const req = {
      ...createBaseReq(),
      body: {
        items: [
          {
            category: "restaurants",
            lang: "th",
            slug: "import-json-phase56-existing",
            title: "Import JSON Existing",
            description: "Import JSON Existing Description",
            meta_title: "Import JSON Existing Meta",
            meta_description: "Import JSON Existing Meta Desc",
            image: "https://img.example/import-json-existing-legacy.jpg",
            decision_featured_score: 112,
            decision_scenario_tags: "family",
            decision_trend_flags: "viral",
            decision_moment_tags: "night",
            decision_insight_flags: "planned",
            decision_cover_image: "https://img.example/import-json-existing-cover.jpg",
            decision_thumbnail_image: "https://img.example/import-json-existing-thumb.jpg",
          },
        ],
      },
    };
    const res = createMockRes();

    await withMockedPool(async (call) => {
      const sql = normalizeSql(call.sql);

      if (sql.startsWith("select id from categories where slug=? limit 1")) return [[{ id: 23 }]];
      if (sql.startsWith("select id from places where slug=? limit 1")) return [[{ id: 2234 }]];
      if (sql.startsWith("update places set category_id=?, slug=coalesce(?,slug), image=?, is_approved=0")) return [{ affectedRows: 1 }];
      if (sql.startsWith("select id from place_translations where place_id=? and lang=? limit 1")) return [[{ id: 3334 }]];
      if (sql.startsWith("update place_translations set title=?, description=?, meta_title=?, meta_description=?")) return [{}];

      throw new Error(`Unexpected SQL in import JSON update test: ${call.sql}`);
    }, async (calls) => {
      await importPlaces(req, res);
      assert.equal(res.statusCode, 200);
      assert.equal(res.body?.created, 0);
      assert.equal(res.body?.updated, 1);
      assert.equal(res.body?.rejected, 0);

      const mutation = findPlacesMutationCall(calls);
      assert.ok(mutation, "expected places update with decision fields");
      assert.equal(mutation.params[3], 112);
      assert.equal(mutation.params[4], "family");
      assert.equal(mutation.params[5], "viral");
      assert.equal(mutation.params[6], "night");
      assert.equal(mutation.params[7], "planned");
      assert.equal(mutation.params[8], "https://img.example/import-json-existing-cover.jpg");
      assert.equal(mutation.params[9], "https://img.example/import-json-existing-thumb.jpg");
      assert.equal(mutation.params[10], 2234);
    });
  });

  await t.test("CSV import preserves decision metadata", async () => {
    const csvText = [
      "category,lang,slug,title,description,meta_title,meta_description,image,decision_featured_score,decision_scenario_tags,decision_trend_flags,decision_moment_tags,decision_insight_flags,decision_cover_image,decision_thumbnail_image",
      "cafes,th,import-csv-phase56,Import CSV Title,Import CSV Description,Import CSV Meta,Import CSV Meta Desc,https://img.example/import-csv-legacy.jpg,77,couple,new,morning,planned,https://img.example/import-csv-cover.jpg,https://img.example/import-csv-thumb.jpg",
    ].join("\n");

    const req = {
      ...createBaseReq(),
      body: { csvText },
    };
    const res = createMockRes();

    await withMockedPool(async (call) => {
      const sql = normalizeSql(call.sql);

      if (sql.startsWith("select id from categories where slug=? limit 1")) return [[{ id: 31 }]];
      if (sql.startsWith("select id from places where slug=? limit 1")) return [[]];
      if (sql.includes("insert into places")) return [{ insertId: 3141 }];
      if (sql.startsWith("select id from place_translations where place_id=? and lang=? limit 1")) return [[]];
      if (sql.includes("insert into place_translations")) return [{ insertId: 4141 }];

      throw new Error(`Unexpected SQL in import CSV test: ${call.sql}`);
    }, async (calls) => {
      await importPlacesCsv(req, res);
      assert.equal(res.statusCode, 200);
      assert.equal(res.body?.created, 1);
      assert.equal(res.body?.rejected, 0);

      const mutation = findPlacesMutationCall(calls);
      assert.ok(mutation, "expected places insert/update with decision fields");
      assert.equal(mutation.params[3], 77);
      assert.equal(mutation.params[4], "couple");
      assert.equal(mutation.params[5], "new");
      assert.equal(mutation.params[6], "morning");
      assert.equal(mutation.params[7], "planned");
      assert.equal(mutation.params[8], "https://img.example/import-csv-cover.jpg");
      assert.equal(mutation.params[9], "https://img.example/import-csv-thumb.jpg");
    });
  });

  await t.test("CSV import preserves decision metadata on update path", async () => {
    const csvText = [
      "category,lang,slug,title,description,meta_title,meta_description,image,decision_featured_score,decision_scenario_tags,decision_trend_flags,decision_moment_tags,decision_insight_flags,decision_cover_image,decision_thumbnail_image",
      "cafes,th,import-csv-phase56-existing,Import CSV Existing,Import CSV Existing Description,Import CSV Existing Meta,Import CSV Existing Meta Desc,https://img.example/import-csv-existing-legacy.jpg,78,family,viral,night,planned,https://img.example/import-csv-existing-cover.jpg,https://img.example/import-csv-existing-thumb.jpg",
    ].join("\n");

    const req = {
      ...createBaseReq(),
      body: { csvText },
    };
    const res = createMockRes();

    await withMockedPool(async (call) => {
      const sql = normalizeSql(call.sql);

      if (sql.startsWith("select id from categories where slug=? limit 1")) return [[{ id: 32 }]];
      if (sql.startsWith("select id from places where slug=? limit 1")) return [[{ id: 3142 }]];
      if (sql.startsWith("update places set category_id=?, slug=coalesce(?,slug), image=?, is_approved=0")) return [{ affectedRows: 1 }];
      if (sql.startsWith("select id from place_translations where place_id=? and lang=? limit 1")) return [[{ id: 4142 }]];
      if (sql.startsWith("update place_translations set title=?, description=?, meta_title=?, meta_description=?")) return [{}];

      throw new Error(`Unexpected SQL in import CSV update test: ${call.sql}`);
    }, async (calls) => {
      await importPlacesCsv(req, res);
      assert.equal(res.statusCode, 200);
      assert.equal(res.body?.created, 0);
      assert.equal(res.body?.updated, 1);
      assert.equal(res.body?.rejected, 0);

      const mutation = findPlacesMutationCall(calls);
      assert.ok(mutation, "expected places update with decision fields");
      assert.equal(mutation.params[3], 78);
      assert.equal(mutation.params[4], "family");
      assert.equal(mutation.params[5], "viral");
      assert.equal(mutation.params[6], "night");
      assert.equal(mutation.params[7], "planned");
      assert.equal(mutation.params[8], "https://img.example/import-csv-existing-cover.jpg");
      assert.equal(mutation.params[9], "https://img.example/import-csv-existing-thumb.jpg");
      assert.equal(mutation.params[10], 3142);
    });
  });

  await t.test("getPlaces includes response shaping fields and precedence", async () => {
    const req = {
      ...createBaseReq(),
      query: { category: "cafes", lang: "th" },
    };
    const res = createMockRes();

    const placeRows = [
      {
        id: 11,
        category: "cafes",
        lang: "th",
        slug: "place-11",
        title: "P11",
        description: "Desc 11",
        req_description: "Desc 11",
        th_description: "Desc 11",
        meta_title: "MT11",
        meta_description: "MD11",
        image: "https://img.example/legacy-11.jpg",
        is_approved: 1,
        decision_featured_score: 11,
        decision_scenario_tags: "day-trip,family",
        decision_trend_flags: "hot",
        decision_moment_tags: "evening",
        decision_insight_flags: "nearby",
        decision_cover_image: "https://img.example/decision-cover-11.jpg",
        decision_thumbnail_image: "https://img.example/decision-thumb-11.jpg",
      },
      {
        id: 12,
        category: "cafes",
        lang: "th",
        slug: "place-12",
        title: "P12",
        description: "Desc 12",
        req_description: "Desc 12",
        th_description: "Desc 12",
        meta_title: "MT12",
        meta_description: "MD12",
        image: "https://img.example/legacy-12.jpg",
        is_approved: 1,
        decision_featured_score: 12,
        decision_scenario_tags: "couple",
        decision_trend_flags: "new",
        decision_moment_tags: "night",
        decision_insight_flags: "planned",
        decision_cover_image: null,
        decision_thumbnail_image: null,
      },
      {
        id: 13,
        category: "cafes",
        lang: "th",
        slug: "place-13",
        title: "P13",
        description: "Desc 13",
        req_description: "Desc 13",
        th_description: "Desc 13",
        meta_title: "MT13",
        meta_description: "MD13",
        image: "https://img.example/legacy-13.jpg",
        is_approved: 1,
        decision_featured_score: 13,
        decision_scenario_tags: "budget-500",
        decision_trend_flags: "rising",
        decision_moment_tags: "morning",
        decision_insight_flags: "planned",
        decision_cover_image: "https://img.example/decision-cover-13.jpg",
        decision_thumbnail_image: null,
      },
      {
        id: 14,
        category: "cafes",
        lang: "th",
        slug: "place-14",
        title: "P14",
        description: "Desc 14",
        req_description: "Desc 14",
        th_description: "Desc 14",
        meta_title: "MT14",
        meta_description: "MD14",
        image: "https://img.example/legacy-14.jpg",
        is_approved: 1,
        decision_featured_score: 14,
        decision_scenario_tags: "",
        decision_trend_flags: "",
        decision_moment_tags: "",
        decision_insight_flags: "",
        decision_cover_image: null,
        decision_thumbnail_image: null,
      },
    ];

    const mediaRows = [
      {
        place_id: 11,
        usage_type: "cover",
        position: 0,
        source_url: "https://img.example/media-cover-11.jpg",
        storage_disk: "external",
        file_name: null,
        storage_path: null,
      },
      {
        place_id: 11,
        usage_type: "gallery",
        position: 1,
        source_url: "https://img.example/media-gallery-11.jpg",
        storage_disk: "external",
        file_name: null,
        storage_path: null,
      },
      {
        place_id: 11,
        usage_type: "inline",
        position: 2,
        source_url: "https://img.example/media-inline-11.jpg",
        storage_disk: "external",
        file_name: null,
        storage_path: null,
      },
      {
        place_id: 12,
        usage_type: "cover",
        position: 0,
        source_url: "https://img.example/media-cover-12.jpg",
        storage_disk: "external",
        file_name: null,
        storage_path: null,
      },
      {
        place_id: 12,
        usage_type: "gallery",
        position: 1,
        source_url: "https://img.example/media-gallery-12.jpg",
        storage_disk: "external",
        file_name: null,
        storage_path: null,
      },
      {
        place_id: 12,
        usage_type: "inline",
        position: 2,
        source_url: "https://img.example/media-inline-12.jpg",
        storage_disk: "external",
        file_name: null,
        storage_path: null,
      },
    ];

    await withMockedPool(async (call) => {
      const sql = normalizeSql(call.sql);
      if (sql.includes("from places p") && sql.includes("where c.slug=?")) return [placeRows];
      if (sql.includes("from content_image_usages ciu")) return [mediaRows];
      throw new Error(`Unexpected SQL in getPlaces test: ${call.sql}`);
    }, async () => {
      await getPlaces(req, res);
      assert.equal(res.statusCode, 200);
      assert.equal(Array.isArray(res.body?.items), true);
      assert.equal(res.body.items.length, 4);

      const byId = new Map(res.body.items.map((item) => [item.id, item]));

      for (const id of [11, 12, 13, 14]) {
        assertDecisionResponseFields(byId.get(id));
        assertPublicResponseDoesNotLeakInternalFields(byId.get(id));
      }
      assertDecisionListValues(byId.get(11), {
        decision_scenario_tags_list: ["day-trip", "family"],
        decision_trend_flags_list: ["hot"],
        decision_moment_tags_list: ["evening"],
        decision_insight_flags_list: ["nearby"],
      });
      assertDecisionListValues(byId.get(12), {
        decision_scenario_tags_list: ["couple"],
        decision_trend_flags_list: ["new"],
        decision_moment_tags_list: ["night"],
        decision_insight_flags_list: ["planned"],
      });
      assert.deepEqual(byId.get(11).media_gallery_images, ["https://img.example/media-gallery-11.jpg"]);

      assert.equal(byId.get(11).effective_cover_image, "https://img.example/decision-cover-11.jpg");
      assert.equal(byId.get(11).effective_thumbnail_image, "https://img.example/decision-thumb-11.jpg");

      assert.equal(byId.get(12).effective_cover_image, "https://img.example/media-cover-12.jpg");
      assert.equal(byId.get(12).effective_thumbnail_image, "https://img.example/media-gallery-12.jpg");

      assert.equal(byId.get(13).effective_cover_image, "https://img.example/decision-cover-13.jpg");
      assert.equal(byId.get(13).effective_thumbnail_image, "https://img.example/decision-cover-13.jpg");

      assert.equal(byId.get(14).effective_cover_image, "https://img.example/legacy-14.jpg");
      assert.equal(byId.get(14).effective_thumbnail_image, "https://img.example/legacy-14.jpg");
    });
  });

  await t.test("getPlaceDetail includes response shaping fields and precedence", async () => {
    const req = {
      ...createBaseReq(),
      params: { category: "cafes", slug: "detail-phase56" },
      query: { lang: "th" },
    };
    const res = createMockRes();

    const detailRows = [
      {
        id: 21,
        category: "cafes",
        slug: "detail-phase56",
        image: "https://img.example/legacy-21.jpg",
        is_approved: 1,
        decision_featured_score: 50,
        decision_scenario_tags: "family,day-trip",
        decision_trend_flags: "hot",
        decision_moment_tags: "evening",
        decision_insight_flags: "nearby",
        decision_cover_image: null,
        decision_thumbnail_image: null,
        lang: "th",
        title: "Detail 21",
        description: "Detail description",
        req_description: "Detail description",
        th_description: "Detail description",
        meta_title: "Detail MT",
        meta_description: "Detail MD",
      },
    ];

    const mediaRows = [
      {
        place_id: 21,
        usage_type: "cover",
        position: 0,
        source_url: "https://img.example/media-cover-21.jpg",
        storage_disk: "external",
        file_name: null,
        storage_path: null,
      },
      {
        place_id: 21,
        usage_type: "gallery",
        position: 1,
        source_url: "https://img.example/media-gallery-21.jpg",
        storage_disk: "external",
        file_name: null,
        storage_path: null,
      },
      {
        place_id: 21,
        usage_type: "inline",
        position: 2,
        source_url: "https://img.example/media-inline-21.jpg",
        storage_disk: "external",
        file_name: null,
        storage_path: null,
      },
    ];

    await withMockedPool(async (call) => {
      const sql = normalizeSql(call.sql);
      if (sql.includes("from places p") && sql.includes("where c.slug=? and p.slug=?")) return [detailRows];
      if (sql.includes("from content_image_usages ciu")) return [mediaRows];
      throw new Error(`Unexpected SQL in getPlaceDetail test: ${call.sql}`);
    }, async () => {
      await getPlaceDetail(req, res);
      assert.equal(res.statusCode, 200);
      assert.ok(res.body?.item);

      const item = res.body.item;
      assertDecisionResponseFields(item);
      assertPublicResponseDoesNotLeakInternalFields(item);
      assertDecisionListValues(item, {
        decision_scenario_tags_list: ["family", "day-trip"],
        decision_trend_flags_list: ["hot"],
        decision_moment_tags_list: ["evening"],
        decision_insight_flags_list: ["nearby"],
      });
      assert.deepEqual(item.media_gallery_images, ["https://img.example/media-gallery-21.jpg"]);
      assert.equal(item.effective_cover_image, "https://img.example/media-cover-21.jpg");
      assert.equal(item.effective_thumbnail_image, "https://img.example/media-gallery-21.jpg");
      assert.equal("req_description" in item, false);
      assert.equal("th_description" in item, false);
    });
  });

  await t.test("getPlaceDetail rewrites self-hosted media paths to backend absolute urls", async () => {
    const req = {
      ...createBaseReq(),
      params: { category: "cafes", slug: "detail-local-media" },
      query: { lang: "th" },
    };
    const res = createMockRes();

    const detailRows = [
      {
        id: 22,
        category: "cafes",
        slug: "detail-local-media",
        image: "/uploads/legacy-22.jpg",
        is_approved: 1,
        decision_featured_score: 50,
        decision_scenario_tags: "family",
        decision_trend_flags: "hot",
        decision_moment_tags: "evening",
        decision_insight_flags: "nearby",
        decision_cover_image: "/uploads/published-cover-22.jpg",
        decision_thumbnail_image: "/uploads/published-thumb-22.jpg",
        lang: "th",
        title: "Detail 22",
        description: '<p>Body</p><figure><img src="/uploads/inline-22.jpg" alt="inline"></figure>',
        req_description: '<p>Body</p><figure><img src="/uploads/inline-22.jpg" alt="inline"></figure>',
        th_description: '<p>Body</p><figure><img src="/uploads/inline-22.jpg" alt="inline"></figure>',
        meta_title: "Detail MT",
        meta_description: "Detail MD",
      },
    ];

    const mediaRows = [
      {
        place_id: 22,
        usage_type: "gallery",
        position: 1,
        source_url: "",
        storage_disk: "local",
        file_name: "gallery-22.jpg",
        storage_path: "uploads/published/gallery/gallery-22.jpg",
      },
      {
        place_id: 22,
        usage_type: "inline",
        position: 2,
        source_url: "",
        storage_disk: "local",
        file_name: "inline-usage-22.jpg",
        storage_path: "uploads/published/inline/inline-usage-22.jpg",
      },
    ];

    await withMockedPool(async (call) => {
      const sql = normalizeSql(call.sql);
      if (sql.includes("from places p") && sql.includes("where c.slug=? and p.slug=?")) return [detailRows];
      if (sql.includes("from content_image_usages ciu")) return [mediaRows];
      throw new Error(`Unexpected SQL in local media detail test: ${call.sql}`);
    }, async () => {
      await getPlaceDetail(req, res);
      assert.equal(res.statusCode, 200);
      const item = res.body.item;
      assert.equal(item.image, "https://api.test.local/uploads/legacy-22.jpg");
      assert.equal(item.decision_cover_image, "https://api.test.local/uploads/published-cover-22.jpg");
      assert.equal(item.decision_thumbnail_image, "https://api.test.local/uploads/published-thumb-22.jpg");
      assert.equal(item.effective_cover_image, "https://api.test.local/uploads/published-cover-22.jpg");
      assert.equal(item.effective_thumbnail_image, "https://api.test.local/uploads/published-thumb-22.jpg");
      assert.deepEqual(item.media_gallery_images, ["https://api.test.local/uploads/published/gallery/gallery-22.jpg"]);
      assertPublicResponseDoesNotLeakInternalFields(item);
      assert.match(item.description, /https:\/\/api\.test\.local\/uploads\/inline-22\.jpg/);
    });
  });
});
